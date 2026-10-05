import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOUR = 60 * 60_000
const at = (hour: number, minute = 0) => new Date(2026, 9, 3, hour, minute).getTime()

const harness = (on: On, now: number, contextTokens: number) => {
  const clock = mock.clock(on, { now })
  const compactions: number[] = []
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: contextTokens, window: 200_000 }, rateLimits: [] } }))
  on('session.compact', () => {
    compactions.push(clock.now() - now)
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }
  })
  const notices: string[] = []
  on('ui.log', (_$, e) => {
    notices.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    notices.push(`status: ${e.text ?? '(cleared)'}`)
    return { value: undefined }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return { clock, compactions, notices }
}

const finishTurn = ($: Engine, turnId: string) =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer' })

describe('evening-compact', () => {
  const cases = [
    { name: 'compacts an idle evening session just before a 1h cache expires', start: at(18), tokens: 120_000, compactsAt: HOUR - 60_000 },
    { name: 'compacts when the turn ended before 17:00 but expiry lands after it', start: at(16, 30), tokens: 120_000, compactsAt: HOUR - 60_000 },
    { name: 'leaves a session alone when expiry lands before 17:00', start: at(15), tokens: 120_000, compactsAt: undefined },
    { name: 'leaves a small session alone, where re-caching is cheaper than a summary', start: at(18), tokens: 10_000, compactsAt: undefined },
  ]

  for (const c of cases) {
    test(c.name, async ($, on) => {
      const { clock, compactions } = harness(on, c.start, c.tokens)
      await finishTurn($, 't1')

      await clock.advance(HOUR - 60_000 - 1)
      expect(compactions).toEqual([])
      await clock.advance(2 * HOUR)
      expect(compactions).toEqual(c.compactsAt === undefined ? [] : [c.compactsAt])
    })
  }

  test('tells the person Comet compacted the session, and clears the status on their next turn', async ($, on) => {
    const { clock, notices } = harness(on, at(18), 120_000)
    await finishTurn($, 't1')
    await clock.advance(HOUR)
    expect(notices).toEqual([
      'Comet compacted this session at 18:59, just before its prompt cache expired.',
      'status: Compacted by Comet at 18:59',
    ])

    await $.turn.start({ text: 'back', turnId: 't2' })
    expect(notices.at(-1)).toBe('status: (cleared)')
  })

  test('a new turn before expiry cancels the pending compaction and rearms on its end', async ($, on) => {
    const { clock, compactions } = harness(on, at(20), 120_000)
    await finishTurn($, 't1')
    await clock.advance(30 * 60_000)
    await $.turn.start({ text: 'back again', turnId: 't2' })
    await clock.advance(HOUR)
    expect(compactions).toEqual([])

    await finishTurn($, 't2')
    await clock.advance(HOUR)
    expect(compactions).toEqual([30 * 60_000 + 2 * HOUR - 60_000])
  })

  test('a 5m cache compacts four minutes after the last turn', { options: { cacheTtl: '5m' } }, async ($, on) => {
    const { clock, compactions } = harness(on, at(21), 120_000)
    await finishTurn($, 't1')
    await clock.advance(4 * 60_000 - 1)
    expect(compactions).toEqual([])
    await clock.advance(1)
    expect(compactions).toEqual([4 * 60_000])
  })
})
