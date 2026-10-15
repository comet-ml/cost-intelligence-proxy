import type { EngineInterface, Register, Timer } from 'claude-code'

import { cipxHome, minutesOfDay, sessionCompact, type DaemonIo } from './lib/cipx-daemon'
import { modLog, type ModLogIo } from './lib/mod-log'

const MOD = 'evening-compact'
// Fires ahead of cipx's first 1h-tier keepalive at 55m12s, while the cache is still alive.
const LEAD_MS = 10 * 60_000
// Idle time at which a 1h prompt cache expires; the daemon says whether the session has one.
const CACHE_TTL_MS = 60 * 60_000
// Below this the summary costs more than re-caching would.
const MIN_CONTEXT_TOKENS = 30_000

const daemonIo = ($: EngineInterface): DaemonIo => ({
  homeEnv: () => $.env.get('HOME'),
  cipxHomeEnv: () => $.env.get('CIPX_HOME'),
  readFile: (path) => $.fs.read(path),
  fetch: (url) => $.http.fetch(url),
})

const logIo = ($: EngineInterface): ModLogIo => ({
  home: () => cipxHome(daemonIo($)),
  exists: (path) => $.fs.exists(path),
  readFile: (path) => $.fs.read(path),
  writeFile: (path, text) => $.fs.write(path, text),
  now: () => $.clock.now(),
  fallback: (line) => $.ui.log(line, { to: 'debug' }),
})

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

const inWindow = (start: string, end: string, ms: number) => {
  const d = new Date(ms)
  const m = d.getHours() * 60 + d.getMinutes()
  const [from, to] = [minutesOfDay(start)!, minutesOfDay(end)!]
  return from < to ? m >= from && m < to : m >= from || m < to
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

  on('turn.start', (_$, e, next) => {
    turns++
    cancel()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const turn = turns
    const result = await next(e)
    // A turn that began while the engine finished this one owns the timer.
    if (e.agentId !== undefined || turn !== turns) return result

    cancel()
    pending = $.clock.after(CACHE_TTL_MS - LEAD_MS, async () => {
      pending = undefined
      let sessionId = 'unknown'
      const log = (text: string) => modLog(logIo($), MOD, sessionId, text)
      try {
        sessionId = await $.session.id()
        const now = await $.clock.now()

        let answer
        try {
          answer = await sessionCompact(daemonIo($), sessionId)
        } catch (err) {
          await log(`not checked (cipx daemon: ${message(err)})`)
          return
        }
        if (!answer.enabled) return

        const { windowStart, windowEnd, cacheTtl } = answer
        if (!inWindow(windowStart, windowEnd, now)) return await log(`skipped (outside window ${windowStart}–${windowEnd})`)
        if (cacheTtl !== '1h') return await log(`skipped (prompt cache is ${cacheTtl})`)
        const tokens = (await $.session.usage()).context.tokens ?? 0
        if (tokens < MIN_CONTEXT_TOKENS) return await log(`skipped (context ${tokens} tokens)`)

        const compacted = await $.session.compact()
        if ('skip' in compacted && compacted.skip !== undefined) return await log(`skipped (${compacted.skip})`)
        await log('compacted')
        // The person is away by construction, so a toast alone would go unseen.
        $.ui.log(`Comet compacted this session at ${clockTime(now)} while it was idle.`)
      } catch (err) {
        // compact rejects when a turn started in the meantime; that turn rearms us.
        await log(`failed (${message(err)})`)
      }
    })
    return result
  })
}
