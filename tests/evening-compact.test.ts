import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const MIN = 60_000
const HOUR = 60 * MIN
const FIRE_AFTER = HOUR - 10 * MIN
const at = (hour: number, minute = 0) => new Date(2026, 9, 3, hour, minute).getTime()

const HOME = '/home/u/.opik-cipx'
const MODS_LOG = `${HOME}/logs/mods.log`
const SESSION = 'sess-1'
const EVENING = { enabled: true, window_start: '17:00', window_end: '23:00', cache_ttl: '1h' }

type Options = {
  // What the daemon answers; a string is sent as the raw body, 'unreachable' is a refused connection.
  daemon?: object | string | 'unreachable'
  status?: number
  // An undefined value removes a default file.
  files?: Record<string, string | undefined>
  env?: Record<string, string>
  contextTokens?: number | null
  compact?: { skip: string } | 'throws'
  failLogWrite?: boolean
  idFails?: boolean
  // Mock-clock milliseconds a hook takes to answer, to hold a call open while the test acts.
  delays?: { fetch?: number; compact?: number; complete?: number }
}

const harness = (on: On, now: number, options: Options = {}) => {
  const { contextTokens = 120_000, status = 200, failLogWrite = false, delays = {} } = options
  const daemon = options.daemon ?? EVENING
  const files: Record<string, string> = {}
  for (const [path, text] of Object.entries({ [`${HOME}/state.json`]: '{"admin_port":9911}', ...options.files })) {
    if (text !== undefined) files[path] = text
  }
  mock.env(on, { HOME: '/home/u', ...options.env })
  const clock = mock.clock(on, { now })
  const requests: string[] = []
  if (!options.idFails) on('session.id', () => ({ value: SESSION }))
  on('fs.exists', (_$, e) => ({ value: e.path in files }))
  on('fs.read', (_$, e) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] }
  })
  on('fs.write', (_$, e) => {
    if (failLogWrite && e.path === MODS_LOG) throw new Error('EACCES')
    files[e.path] = e.text
    return { value: undefined }
  })
  // A hook that throws is skipped, leaving the call with no implementation: the way to make it reject.
  if (daemon !== 'unreachable') on('http.fetch', async (_$, e) => {
    requests.push(e.url)
    if (delays.fetch) await clock.sleep(delays.fetch)
    const text = typeof daemon === 'string' ? daemon : JSON.stringify(daemon)
    return { value: { status, ok: status >= 200 && status < 300, headers: {}, text } }
  })
  const compactions: number[] = []
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: contextTokens ?? undefined, window: 200_000 }, rateLimits: [] } }))
  if (options.compact !== 'throws') on('session.compact', async () => {
    compactions.push(clock.now() - now)
    if (delays.compact) await clock.sleep(delays.compact)
    if (options.compact) return options.compact
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }
  })
  const transcript: string[] = []
  const debug: string[] = []
  on('ui.log', (_$, e) => {
    ;(e.to === 'debug' ? debug : transcript).push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => {
    if (delays.complete) await clock.sleep(delays.complete)
    return { text: e.answer }
  })
  // mods.log lines without their timestamp, so assertions read as "<mod> session=<id>: <text>".
  const modsLog = () => (files[MODS_LOG] ?? '').split('\n').filter(Boolean).map((l) => l.replace(/^\S+ /, ''))
  return { clock, compactions, transcript, debug, requests, modsLog, files }
}

const finishTurn = ($: Engine, turnId: string, agentId?: string) =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer', agentId })

const line = (text: string) => `evening-compact session=${SESSION}: ${text}`

describe('evening-compact', () => {
  test('compacts an idle session in the window on a 1h cache, at 50m and not before, and reports it once', async ($, on) => {
    const { clock, compactions, transcript, modsLog, requests } = harness(on, at(18))
    await finishTurn($, 't1')

    await clock.advance(FIRE_AFTER - 1)
    expect(compactions, 'compaction before the 50m mark').toEqual([])
    expect(requests, 'daemon asked before the 50m mark').toEqual([])

    await clock.advance(2 * HOUR)
    expect(compactions, 'compaction times (ms after the turn ended)').toEqual([FIRE_AFTER])
    expect(transcript, 'transcript lines: exactly the success line').toEqual(['Comet compacted this session at 18:50 while it was idle.'])
    expect(modsLog(), 'mods.log lines').toEqual([line('compacted')])
    expect(requests, 'daemon requests').toEqual([`http://127.0.0.1:9911/mods/session_compact?session_id=${SESSION}`])
  })

  test('compacts at exactly 30k context tokens', async ($, on) => {
    const { clock, compactions } = harness(on, at(18), { contextTokens: 30_000 })
    await finishTurn($, 't1')
    await clock.advance(HOUR)
    expect(compactions.length, 'compactions at the 30k boundary').toBe(1)
  })

  const skipCases: { name: string; options: Options; logged: string; compacts?: boolean }[] = [
    { name: 'a 5m cache', options: { daemon: { ...EVENING, cache_ttl: '5m' } }, logged: 'skipped (prompt cache is 5m)' },
    { name: 'a cache TTL the daemon has not observed', options: { daemon: { ...EVENING, cache_ttl: 'unknown' } }, logged: 'skipped (prompt cache is unknown)' },
    { name: 'a cache TTL value the mod does not know, named as the daemon sent it', options: { daemon: { ...EVENING, cache_ttl: '2h' } }, logged: 'skipped (prompt cache is 2h)' },
    { name: 'a small context', options: { contextTokens: 10_000 }, logged: 'skipped (context 10000 tokens)' },
    { name: 'a context size the engine cannot report', options: { contextTokens: null }, logged: 'skipped (context unknown)' },
    { name: 'a fire time outside the window', options: { daemon: { ...EVENING, window_start: '19:00', window_end: '22:00' } }, logged: 'skipped (outside window 19:00–22:00)' },
    { name: 'a refused compaction', options: { compact: { skip: 'hook blocked it' } }, logged: 'skipped (hook blocked it)', compacts: true },
  ]

  for (const c of skipCases) {
    test(`logs once to mods.log and tells the transcript nothing on ${c.name}`, async ($, on) => {
      const { clock, compactions, transcript, modsLog } = harness(on, at(18), c.options)
      await finishTurn($, 't1')
      await clock.advance(HOUR)

      expect(modsLog(), 'mods.log lines').toEqual([line(c.logged)])
      expect(transcript, 'transcript lines (only a successful compaction may write there)').toEqual([])
      expect(compactions.length, 'compactions attempted').toBe(c.compacts ? 1 : 0)
    })
  }

  test('logs "failed" and tells the transcript nothing when the compaction throws', async ($, on) => {
    const { clock, transcript, modsLog } = harness(on, at(18), { compact: 'throws' })
    await finishTurn($, 't1')
    await clock.advance(HOUR)
    expect(modsLog().map((l) => l.slice(0, line('failed (').length)), 'mods.log lines').toEqual([line('failed (')])
    expect(transcript, 'transcript lines').toEqual([])
  })

  for (const daemon of [{ enabled: false }, { enabled: false, reason: 'window invalid' }]) {
    test(`stays completely silent when the daemon answers ${JSON.stringify(daemon)}`, async ($, on) => {
      const { clock, compactions, transcript, debug, files } = harness(on, at(18), { daemon })
      await finishTurn($, 't1')
      await clock.advance(HOUR)
      expect({ compactions: compactions.length, transcript, debug, logFile: files[MODS_LOG] }, 'side effects').toEqual({
        compactions: 0,
        transcript: [],
        debug: [],
        logFile: undefined,
      })
    })
  }

  const daemonDown: { name: string; options: Options; logged: string }[] = [
    { name: 'unreachable', options: { daemon: 'unreachable' }, logged: 'unreachable on port 9911' },
    { name: 'older than the endpoint (404)', options: { daemon: 'not found', status: 404 }, logged: 'HTTP 404' },
    { name: 'answering something that is not JSON', options: { daemon: '<html>' }, logged: 'not JSON' },
    { name: 'not running (neither state.json nor ports.json exists)', options: { files: { [`${HOME}/state.json`]: undefined } }, logged: 'no admin port' },
    { name: 'missing from a state.json that holds no port (and no ports.json)', options: { files: { [`${HOME}/state.json`]: '{}' } }, logged: 'no admin port' },
  ]

  for (const c of daemonDown) {
    test(`does not compact and logs one "not checked" line when the daemon is ${c.name}`, async ($, on) => {
      const { clock, compactions, transcript, modsLog } = harness(on, at(18), c.options)
      await finishTurn($, 't1')
      await clock.advance(HOUR)

      expect(compactions.length, 'compactions without a daemon answer').toBe(0)
      const lines = modsLog()
      expect(lines.length, `mods.log lines: ${JSON.stringify(lines)}`).toBe(1)
      expect(lines[0].startsWith(line('not checked (cipx daemon: ')) && lines[0].includes(c.logged), `"not checked" line naming ${c.logged}: ${lines[0]}`).toBe(true)
      expect(transcript, 'transcript lines').toEqual([])
    })
  }

  const windowCases: { name: string; endedAt: number; start: string; end: string; compacts: boolean }[] = [
    { name: 'inside a window', endedAt: at(18), start: '17:00', end: '20:00', compacts: true },
    { name: 'at the exact opening minute (start is inclusive)', endedAt: at(17, 10), start: '18:00', end: '20:00', compacts: true },
    { name: 'a minute before the window opens', endedAt: at(17, 9), start: '18:00', end: '20:00', compacts: false },
    { name: 'at the exact closing minute (end is exclusive)', endedAt: at(18, 10), start: '17:00', end: '19:00', compacts: false },
    { name: 'a minute before the window closes', endedAt: at(18, 9), start: '17:00', end: '19:00', compacts: true },
    { name: 'before midnight in a window that wraps past it', endedAt: at(23), start: '22:00', end: '02:00', compacts: true },
    { name: 'after midnight in a window that wraps past it', endedAt: at(23, 30), start: '22:00', end: '02:00', compacts: true },
    { name: 'outside a window that wraps past midnight', endedAt: at(14), start: '22:00', end: '02:00', compacts: false },
    { name: 'at the closing minute of a window that wraps past midnight', endedAt: at(1, 10), start: '22:00', end: '02:00', compacts: false },
  ]

  for (const c of windowCases) {
    test(`window ${c.start}-${c.end}: ${c.compacts ? 'compacts' : 'skips'} ${c.name}`, async ($, on) => {
      const { clock, compactions, modsLog } = harness(on, c.endedAt, { daemon: { ...EVENING, window_start: c.start, window_end: c.end } })
      await finishTurn($, 't1')
      await clock.advance(HOUR)

      expect(compactions.length, `compactions (fire time is 50m after the turn; mods.log ${JSON.stringify(modsLog())})`).toBe(c.compacts ? 1 : 0)
    })
  }

  test('a new turn before the mark cancels the pending compaction and rearms on its end', async ($, on) => {
    const { clock, compactions, requests } = harness(on, at(20))
    await finishTurn($, 't1')
    await clock.advance(30 * MIN)
    await $.turn.start({ text: 'back again', turnId: 't2' })
    await clock.advance(HOUR)
    expect({ compactions, requests }, 'work done while the second turn is still running').toEqual({ compactions: [], requests: [] })

    await finishTurn($, 't2')
    await clock.advance(HOUR)
    expect(compactions, 'compaction times (ms after the first turn)').toEqual([30 * MIN + HOUR + FIRE_AFTER])
  })

  test('a subagent turn arms nothing', async ($, on) => {
    const { clock, compactions, requests } = harness(on, at(18))
    await finishTurn($, 'a1', 'agent-1')
    await clock.advance(2 * HOUR)
    expect({ compactions, requests }, 'work armed by a subagent turn').toEqual({ compactions: [], requests: [] })
  })

  test('a turn that begins while the engine finishes turn.complete arms nothing', async ($, on) => {
    const { clock, compactions, requests } = harness(on, at(18), { delays: { complete: 1000 } })
    const finishing = finishTurn($, 't1')
    await $.turn.start({ text: 'queued prompt', turnId: 't2' })
    await clock.advance(1000)
    await finishing
    await clock.advance(2 * HOUR)
    expect({ compactions, requests }, 'work armed by a turn.complete that a new turn overtook').toEqual({ compactions: [], requests: [] })
  })

  test('does not compact, and says so, when a turn begins while the daemon is being asked', async ($, on) => {
    const { clock, compactions, transcript, modsLog } = harness(on, at(18), { delays: { fetch: 3000 } })
    await finishTurn($, 't1')
    await clock.advance(FIRE_AFTER)
    await $.turn.start({ text: 'back', turnId: 't2' })
    await clock.advance(3000)

    expect(compactions.length, 'compactions after the person came back').toBe(0)
    expect(modsLog(), 'mods.log lines').toEqual([line('skipped (session resumed)')])
    expect(transcript, 'transcript lines').toEqual([])
  })

  test('keeps the transcript quiet when a turn begins during the compaction itself', async ($, on) => {
    const { clock, compactions, transcript, modsLog } = harness(on, at(18), { delays: { compact: 3000 } })
    await finishTurn($, 't1')
    await clock.advance(FIRE_AFTER)
    await $.turn.start({ text: 'back', turnId: 't2' })
    await clock.advance(3000)

    expect(compactions.length, 'compactions').toBe(1)
    expect(modsLog(), 'mods.log lines').toEqual([line('compacted')])
    expect(transcript, 'transcript says "while it was idle" about a session that was not').toEqual([])
  })

  test('a subagent turn starting while the session is idle does not cancel the compaction', async ($, on) => {
    const { clock, compactions } = harness(on, at(18))
    await finishTurn($, 't1')
    await clock.advance(30 * MIN)
    await $.turn.start({ text: 'background work', turnId: 'a1', agentId: 'agent-1' })
    await clock.advance(HOUR)
    expect(compactions, 'compaction times (ms after the turn ended)').toEqual([FIRE_AFTER])
  })

  test('gives up on a daemon that does not answer in time and logs "timed out"', async ($, on) => {
    const { clock, compactions, transcript, modsLog } = harness(on, at(18), { delays: { fetch: 30_000 } })
    await finishTurn($, 't1')
    await clock.advance(FIRE_AFTER + 5000)
    expect(modsLog(), 'mods.log lines at the 5s mark').toEqual([line('not checked (cipx daemon: timed out)')])

    await clock.advance(HOUR)
    expect({ compactions: compactions.length, transcript, lines: modsLog().length }, 'effects once the late answer arrives').toEqual({ compactions: 0, transcript: [], lines: 1 })
  })

  test('logs "failed" under session=unknown when the session id cannot be read', async ($, on) => {
    const { clock, compactions, modsLog } = harness(on, at(18), { idFails: true })
    await finishTurn($, 't1')
    await clock.advance(HOUR)
    const lines = modsLog()
    expect(compactions.length, 'compactions').toBe(0)
    expect(lines.length === 1 && lines[0].startsWith('evening-compact session=unknown: failed ('), `mods.log lines: ${JSON.stringify(lines)}`).toBe(true)
  })

  test('reads the daemon port from CIPX_HOME when it is set', async ($, on) => {
    const { clock, compactions, requests } = harness(on, at(18), {
      env: { CIPX_HOME: '/srv/cipx' },
      files: { '/srv/cipx/state.json': '{"admin_port":9933}' },
    })
    await finishTurn($, 't1')
    await clock.advance(HOUR)
    expect(requests, 'daemon requests').toEqual([`http://127.0.0.1:9933/mods/session_compact?session_id=${SESSION}`])
    expect(compactions.length, 'compactions').toBe(1)
  })

  test('falls back to the debug log, still compacting and reporting, when mods.log cannot be written', async ($, on) => {
    const { clock, compactions, transcript, debug } = harness(on, at(18), { failLogWrite: true })
    await finishTurn($, 't1')
    await clock.advance(HOUR)

    expect(compactions.length, 'compactions').toBe(1)
    expect(transcript, 'transcript lines').toEqual(['Comet compacted this session at 18:50 while it was idle.'])
    expect(debug.length, `debug lines: ${JSON.stringify(debug)}`).toBe(1)
    expect(debug[0].endsWith(line('compacted')), `debug line carries the full log line: ${debug[0]}`).toBe(true)
  })
})
