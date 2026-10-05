import type { Register, Timer } from 'claude-code'

const WINDOW_START_HOUR = 17
const LEAD_MS = 60_000
// Below this the summary costs more than re-caching would.
const MIN_CONTEXT_TOKENS = 30_000

const isInWindow = (ms: number) => new Date(ms).getHours() >= WINDOW_START_HOUR
const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const register: Register = (on, options) => {
  const ttlMs = options.cacheTtl === '5m' ? 5 * 60_000 : 60 * 60_000
  let pending: Timer | undefined

  const cancel = () => {
    pending?.cancel()
    pending = undefined
  }

  on('turn.start', ($, e, next) => {
    cancel()
    $.ui.status(undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    cancel()
    pending = $.clock.after(ttlMs - LEAD_MS, async () => {
      pending = undefined
      const now = await $.clock.now()
      if (!isInWindow(now)) return

      const { context } = await $.session.usage()
      if ((context.tokens ?? 0) < MIN_CONTEXT_TOKENS) return

      try {
        const compacted = await $.session.compact()
        if ('skip' in compacted && compacted.skip !== undefined) {
          $.ui.log(`evening-compact: skipped (${compacted.skip})`)
          return
        }
        // The person is away by construction, so a toast alone would go unseen.
        $.ui.log(`Comet compacted this session at ${clockTime(now)}, just before its prompt cache expired.`)
        $.ui.status(`Compacted by Comet at ${clockTime(now)}`)
      } catch (err) {
        // Rejects when a turn started in the meantime; that turn rearms us.
        $.ui.log(`evening-compact: not compacted (${String(err)})`)
      }
    })
    return result
  })
}
