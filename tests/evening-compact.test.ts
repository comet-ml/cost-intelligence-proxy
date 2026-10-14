import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

const HOUR = 60 * 60_000
const at = (hour: number, minute = 0) => new Date(2026, 9, 3, hour, minute).getTime()

const policyFile = '/home/u/.opik-cipx/policy-state.json'
const policyFor = (sessionCompact: unknown) =>
  JSON.stringify({ etag: 'e1', settings: { cipx: { adaptive_settings: { claude_code: { session_compact: sessionCompact } } } } })
const EVENING = { window_start: '17:00', window_end: '00:00' }

type Faults = { compactSkip?: string; usageFails?: 'arm' | 'fire' }
const SUBSCRIPTION: SessionRateLimit[] = [{ kind: 'five_hour', percentUsed: 20 }]

type Options = {
  contextTokens?: number
  policy?: string | null
  env?: Record<string, string>
  settings?: Record<string, unknown>
  rateLimits?: SessionRateLimit[]
  faults?: Faults
}

const harness = (on: On, now: number, options: Options = {}) => {
  const { contextTokens = 120_000, env = {}, settings = {}, faults = {} } = options
  let currentPolicy = 'policy' in options ? options.policy! : policyFor(EVENING)
  let currentRateLimits = options.rateLimits ?? SUBSCRIPTION
  const home = { env: { HOME: '/home/u', ...env }, file: env.CIPX_HOME ? `${env.CIPX_HOME}/policy-state.json` : policyFile }
  mock.env(on, home.env)
  on('settings.read', () => ({ value: settings }))
  on('fs.read', (_$, e) => {
    if (e.path !== home.file || currentPolicy === null) throw new Error(`ENOENT ${e.path}`)
    return { value: currentPolicy }
  })
  const clock = mock.clock(on, { now })
  const compactions: number[] = []
  on('session.usage', () => {
    if (faults.usageFails === (clock.now() > now ? 'fire' : 'arm')) throw new Error('usage unavailable')
    return { value: { startedAt: 0, context: { tokens: contextTokens, window: 200_000 }, rateLimits: currentRateLimits } }
  })
  on('session.compact', () => {
    compactions.push(clock.now() - now)
    if (faults.compactSkip !== undefined) return { skip: faults.compactSkip }
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }
  })
  const notices: string[] = []
  const debugLines: string[] = []
  on('ui.log', (_$, e) => {
    ;(e.to === 'debug' ? debugLines : notices).push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    notices.push(`status: ${e.text ?? '(cleared)'}`)
    return { value: undefined }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return { clock, compactions, notices, debugLines, setPolicy: (p: string | null) => { currentPolicy = p }, setRateLimits: (r: SessionRateLimit[]) => { currentRateLimits = r } }
}

const finishTurn = ($: Engine, turnId: string, agentId?: string) =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer', agentId })

describe('evening-compact', () => {
  const windowCases = [
    { name: 'compacts inside the window', start: at(18), window: { window_start: '17:00', window_end: '20:00' }, compacts: true },
    { name: 'compacts at the exact opening minute', start: at(18), window: { window_start: '18:50', window_end: '20:00' }, compacts: true },
    { name: 'leaves a session alone before the window opens', start: at(18), window: { window_start: '19:00', window_end: '22:00' }, compacts: false },
    { name: 'leaves a session alone at the exact closing minute', start: at(18), window: { window_start: '17:00', window_end: '18:50' }, compacts: false },
    { name: 'compacts before midnight in a window that wraps past it', start: at(23), window: { window_start: '22:00', window_end: '02:00' }, compacts: true },
    { name: 'compacts after midnight in a window that wraps past it', start: at(23, 30), window: { window_start: '22:00', window_end: '02:00' }, compacts: true },
    { name: 'accepts single-digit hours and minutes, as the daemon does', start: at(18), window: { window_start: '9:5', window_end: '20:0' }, compacts: true },
    { name: 'stays off when the policy has no session_compact section', start: at(18), policy: JSON.stringify({ settings: { cipx: { adaptive_settings: { claude_code: {} } } } }), compacts: false },
    { name: 'stays off, silently, when the section sets neither bound', start: at(18), window: {}, compacts: false },
    { name: 'stays off when there is no policy file', start: at(18), policy: null, compacts: false },
    { name: 'ignores a window with an unparseable bound, and says so', start: at(18), window: { window_start: 'evening', window_end: '20:00' }, compacts: false, logs: true },
    { name: 'ignores a window with a seconds field, and says so', start: at(18), window: { window_start: '17:00:00', window_end: '20:00' }, compacts: false, logs: true },
    { name: 'ignores a window with an out-of-range hour, and says so', start: at(18), window: { window_start: '17:00', window_end: '24:00' }, compacts: false, logs: true },
    { name: 'ignores a window whose bound is a number, and says so', start: at(18), window: { window_start: 1700, window_end: '20:00' }, compacts: false, logs: true },
    { name: 'ignores a window with only one bound, and says so', start: at(18), window: { window_start: '17:00' }, compacts: false, logs: true },
    { name: 'ignores a window whose bounds are equal, and says so', start: at(18), window: { window_start: '9:00', window_end: '09:00' }, compacts: false, logs: true },
  ]

  for (const c of windowCases) {
    test(`policy window: ${c.name}`, async ($, on) => {
      const policy = 'policy' in c ? c.policy : policyFor(c.window)
      const { clock, compactions, notices } = harness(on, c.start, { policy })
      await finishTurn($, 't1')
      await clock.advance(HOUR)

      expect(compactions.length, 'compactions').toBe(c.compacts ? 1 : 0)
      expect(notices.filter((n) => n.includes('window ignored')).length, 'window-ignored log lines').toBe(c.logs ? 1 : 0)
    })
  }

  const cases = [
    { name: 'compacts an idle evening session ahead of the first keepalive on a 1h cache', start: at(18), tokens: 120_000, compactsAt: HOUR - 10 * 60_000 },
    { name: 'compacts when the turn ended before 17:00 but expiry lands after it', start: at(16, 30), tokens: 120_000, compactsAt: HOUR - 10 * 60_000 },
    { name: 'leaves a session alone when expiry lands before 17:00', start: at(15), tokens: 120_000, compactsAt: undefined },
    { name: 'leaves a small session alone, where re-caching is cheaper than a summary', start: at(18), tokens: 10_000, compactsAt: undefined },
  ]

  for (const c of cases) {
    test(c.name, async ($, on) => {
      const { clock, compactions } = harness(on, c.start, { contextTokens: c.tokens })
      await finishTurn($, 't1')

      await clock.advance(HOUR - 10 * 60_000 - 1)
      expect(compactions).toEqual([])
      await clock.advance(2 * HOUR)
      expect(compactions).toEqual(c.compactsAt === undefined ? [] : [c.compactsAt])
    })
  }

  const ttlCases: { name: string; options: Options; compacts: boolean; debug?: string }[] = [
    { name: 'no readings is API-key-like, so 5m', options: { rateLimits: [] }, compacts: false, debug: '5m' },
    { name: 'CLAUDE_CODE_PROMPT_CACHE_TTL=1h with no readings', options: { rateLimits: [], env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' } }, compacts: true },
    { name: 'promptCacheTtl setting 1h with no readings', options: { rateLimits: [], settings: { promptCacheTtl: '1h' } }, compacts: true },
    { name: 'ENABLE_PROMPT_CACHING_1H with no readings', options: { rateLimits: [], env: { ENABLE_PROMPT_CACHING_1H: '1' } }, compacts: true },
    { name: 'FORCE_PROMPT_CACHING_5M on a subscription', options: { env: { FORCE_PROMPT_CACHING_5M: '1' } }, compacts: false, debug: 'FORCE_PROMPT_CACHING_5M' },
    { name: 'DISABLE_PROMPT_CACHING on a subscription', options: { env: { DISABLE_PROMPT_CACHING: '1' } }, compacts: false, debug: 'DISABLE_PROMPT_CACHING' },
  ]

  for (const c of ttlCases) {
    test(`prompt cache TTL: ${c.name}`, async ($, on) => {
      const { clock, compactions, debugLines, notices } = harness(on, at(18), c.options)
      await finishTurn($, 't1')
      await clock.advance(HOUR)

      expect(compactions.length, `compactions (transcript ${JSON.stringify(notices)}, debug ${JSON.stringify(debugLines)})`).toBe(c.compacts ? 1 : 0)
      if (c.debug === undefined) expect(debugLines, 'debug lines').toEqual([])
      else expect(debugLines.length > 0 && debugLines.every((l) => l.includes(c.debug!)), `every debug skip line should name ${c.debug}: ${JSON.stringify(debugLines)}`).toBe(true)
      expect(notices.filter((n) => n.includes('evening-compact')), 'transcript evening-compact lines').toEqual([])
    })
  }

  test('prompt cache TTL: a 5m cache when the turn ended is not compacted even if the fire time reads 1h', async ($, on) => {
    const { clock, compactions, debugLines, setRateLimits } = harness(on, at(18), { rateLimits: [{ kind: 'five_hour', percentUsed: 100 }] })
    await finishTurn($, 't1')
    setRateLimits(SUBSCRIPTION)
    await clock.advance(HOUR)
    expect(compactions.length, `compactions (debug ${JSON.stringify(debugLines)})`).toBe(0)
    expect(debugLines.filter((l) => l.includes('5m')).length, `arm-time skip in ${JSON.stringify(debugLines)}`).toBe(1)
  })

  test('prompt cache TTL: a cache that flipped to 5m after arming is not compacted', async ($, on) => {
    const { clock, compactions, debugLines, setRateLimits } = harness(on, at(18))
    await finishTurn($, 't1')
    setRateLimits([{ kind: 'five_hour', percentUsed: 100 }])
    await clock.advance(HOUR)
    expect(compactions.length, `compactions (debug ${JSON.stringify(debugLines)})`).toBe(0)
  })

  test('prompt cache TTL: a 5m session stays silent at fire time when the policy is off', async ($, on) => {
    const { clock, compactions, debugLines, notices } = harness(on, at(18), { rateLimits: [], policy: null })
    await finishTurn($, 't1')
    const armed = debugLines.length
    await clock.advance(HOUR)
    expect(compactions.length, 'compactions').toBe(0)
    expect(debugLines.slice(armed), 'debug lines logged at fire time').toEqual([])
    expect(notices, 'transcript lines').toEqual([])
  })

  test('logs, instead of breaking the turn, when the arm-time usage read fails, and arms nothing', async ($, on) => {
    const { clock, compactions, notices } = harness(on, at(18), { faults: { usageFails: 'arm' } })
    await finishTurn($, 't1')
    await clock.advance(HOUR)
    expect(compactions.length, 'compactions').toBe(0)
    expect(notices.filter((n) => n.startsWith('evening-compact: not armed')).length, `"not armed" lines in ${JSON.stringify(notices)}`).toBe(1)
  })

  test('reads the policy at fire time, so a change after arming applies', async ($, on) => {
    const noSection = JSON.stringify({ settings: { cipx: { adaptive_settings: { claude_code: {} } } } })
    const { clock, compactions, setPolicy } = harness(on, at(18), { policy: noSection })
    await finishTurn($, 't1')
    setPolicy(policyFor(EVENING))
    await clock.advance(HOUR)
    expect(compactions.length, 'compactions').toBe(1)
  })

  test('a subagent turn arms nothing', async ($, on) => {
    const { clock, compactions } = harness(on, at(18))
    await finishTurn($, 'a1', 'agent-1')
    await clock.advance(2 * HOUR)
    expect(compactions, 'compactions').toEqual([])
  })

  const faultCases = [
    { name: 'logs a skipped compaction',faults: { compactSkip: 'hook blocked it' }, logged: 'evening-compact: skipped (hook blocked it)' },
    { name: 'logs, instead of throwing, when the usage read fails', faults: { usageFails: 'fire' as const }, logged: 'evening-compact: not compacted' },
  ]

  for (const c of faultCases) {
    test(c.name, async ($, on) => {
      const { clock, notices } = harness(on, at(18), { faults: c.faults })
      await finishTurn($, 't1')
      await clock.advance(HOUR)

      expect(notices.filter((n) => n.startsWith(c.logged)).length, `"${c.logged}" log lines in ${JSON.stringify(notices)}`).toBe(1)
    })
  }

  test('reads the policy from CIPX_HOME when it is set', async ($, on) => {
    const { clock, compactions } = harness(on, at(18), { env: { CIPX_HOME: '/srv/cipx' } })
    await finishTurn($, 't1')
    await clock.advance(HOUR)
    expect(compactions.length, 'compactions').toBe(1)
  })

  test('tells the person Comet compacted the session in the transcript only', async ($, on) => {
    const { clock, notices } = harness(on, at(18))
    await finishTurn($, 't1')
    await clock.advance(HOUR)
    expect(notices).toEqual(['Comet compacted this session at 18:50 while it was idle.'])
  })

  test('a new turn before expiry cancels the pending compaction and rearms on its end', async ($, on) => {
    const { clock, compactions } = harness(on, at(20))
    await finishTurn($, 't1')
    await clock.advance(30 * 60_000)
    await $.turn.start({ text: 'back again', turnId: 't2' })
    await clock.advance(HOUR)
    expect(compactions).toEqual([])

    await finishTurn($, 't2')
    await clock.advance(HOUR)
    expect(compactions).toEqual([30 * 60_000 + 2 * HOUR - 10 * 60_000])
  })
})
