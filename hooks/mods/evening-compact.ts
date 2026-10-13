import type { EngineInterface, Register, Timer } from 'claude-code'

import { resolveCacheTtl } from './lib/cc-cache-ttl'
import { adaptiveSetting, stringKnob, type PolicyIo } from './lib/cipx-policy'

// Fires ahead of cipx's first 1h-tier keepalive at 55m12s, while the cache is still alive.
const LEAD_MS = 10 * 60_000
// The fire time is for a 1h cache; the TTL check at arm and fire time enforces it.
const CACHE_TTL_MS = 60 * 60_000
// Below this the summary costs more than re-caching would.
const MIN_CONTEXT_TOKENS = 30_000

const policyIo = ($: EngineInterface): PolicyIo => ({
  homeEnv: () => $.env.get('HOME'),
  cipxHomeEnv: () => $.env.get('CIPX_HOME'),
  readFile: (path) => $.fs.read(path),
})

const cacheTtl = async ($: EngineInterface) => {
  const { context, rateLimits } = await $.session.usage()
  const resolved = resolveCacheTtl({
    // Claude Code's own env vars, not cipx's: each turns prompt caching off (globally or per model family).
    // The session's model is unknown here, so any of them means no cache worth compacting ahead of.
    disableEnvs: [
      await $.env.get('DISABLE_PROMPT_CACHING'),
      await $.env.get('DISABLE_PROMPT_CACHING_HAIKU'),
      await $.env.get('DISABLE_PROMPT_CACHING_SONNET'),
      await $.env.get('DISABLE_PROMPT_CACHING_OPUS'),
      await $.env.get('DISABLE_PROMPT_CACHING_FABLE'),
      await $.env.get('DISABLE_PROMPT_CACHING_MYTHOS'),
    ],
    forceFiveMinuteEnv: await $.env.get('FORCE_PROMPT_CACHING_5M'),
    ttlEnv: await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
    ttlSetting: (await $.settings.read()).promptCacheTtl,
    oneHourEnv: await $.env.get('ENABLE_PROMPT_CACHING_1H'),
    rateLimits,
  })
  return { ...resolved, context }
}

const skipText = ({ ttl, reason }: { ttl: string; reason: string }) => `evening-compact: skipped (prompt cache is ${ttl}: ${reason})`

type Window = { start: number; end: number }

// Same as the cipx daemon's parser: "9:5" is 09:05, "18:00:00" is rejected.
const parseHHMM = (key: string, v: string) => {
  const text = v.trim()
  const colon = text.indexOf(':')
  if (colon < 0) throw new Error(`${key}: "${v}" is not HH:MM`)
  const int = (n: string) => (/^[+-]?\d+$/.test(n) ? Number(n) : NaN)
  const hours = int(text.slice(0, colon))
  const mins = int(text.slice(colon + 1))
  if (!(hours >= 0 && hours <= 23 && mins >= 0 && mins <= 59)) throw new Error(`${key}: "${v}" is not a local time of day`)
  return hours * 60 + mins
}

// undefined when the org has not set a window; throws when it has but the value is unusable.
const parseWindow = (setting: Record<string, unknown> | undefined): Window | undefined => {
  if (!setting || (!('window_start' in setting) && !('window_end' in setting))) return undefined
  const startText = stringKnob(setting, 'window_start') ?? ''
  const start = parseHHMM('window_start', startText)
  const end = parseHHMM('window_end', stringKnob(setting, 'window_end') ?? '')
  if (start === end) throw new Error(`window_start and window_end are both ${startText}, which is no window at all`)
  return { start, end }
}

const contains = ({ start, end }: Window, ms: number) => {
  const d = new Date(ms)
  const m = d.getHours() * 60 + d.getMinutes()
  return start < end ? m >= start && m < end : m >= start || m < end
}

const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const registerEveningCompact: Register = (on) => {
  let pending: Timer | undefined

  const cancel = () => {
    pending?.cancel()
    pending = undefined
  }

  let turns = 0

  on('turn.start', ($, e, next) => {
    turns++
    cancel()
    $.ui.status(undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    cancel()
    const turn = turns
    try {
      const armTtl = await cacheTtl($)
      if (armTtl.ttl !== '1h') {
        $.ui.log(skipText(armTtl), { to: 'debug' })
        return result
      }
    } catch (err) {
      $.ui.log(`evening-compact: not armed (${String(err)})`)
      return result
    }
    // A turn that began while we resolved owns the timer.
    if (turn !== turns) return result
    pending = $.clock.after(CACHE_TTL_MS - LEAD_MS, async () => {
      pending = undefined
      try {
        const now = await $.clock.now()

        let window: Window | undefined
        try {
          window = parseWindow(await adaptiveSetting(policyIo($), 'claude_code', 'session_compact'))
        } catch (err) {
          $.ui.log(`evening-compact: session_compact window ignored (${err instanceof Error ? err.message : String(err)})`)
          return
        }
        if (!window || !contains(window, now)) return

        const fire = await cacheTtl($)
        if (fire.ttl !== '1h') {
          $.ui.log(skipText(fire), { to: 'debug' })
          return
        }
        if ((fire.context.tokens ?? 0) < MIN_CONTEXT_TOKENS) return

        const compacted = await $.session.compact()
        if ('skip' in compacted && compacted.skip !== undefined) {
          $.ui.log(`evening-compact: skipped (${compacted.skip})`)
          return
        }
        // The person is away by construction, so a toast alone would go unseen.
        $.ui.log(`Comet compacted this session at ${clockTime(now)} while it was idle.`)
        $.ui.status(`Compacted by Comet at ${clockTime(now)}`)
      } catch (err) {
        // compact rejects when a turn started in the meantime; that turn rearms us.
        $.ui.log(`evening-compact: not compacted (${String(err)})`)
      }
    })
    return result
  })
}
