import { describe, expect, test } from 'claude-code/testing'

import { modLog, type ModLogIo } from '../hooks/mods/lib/mod-log'

const LOG = '/home/u/.opik-cipx/logs/mods.log'
const T0 = Date.UTC(2026, 9, 3, 18, 50, 7, 123)

const memory = (initial?: string, options: { slow?: boolean; failWrite?: boolean } = {}) => {
  const files: Record<string, string> = initial === undefined ? {} : { [LOG]: initial }
  const fallback: string[] = []
  const io: ModLogIo = {
    home: async () => '/home/u/.opik-cipx',
    exists: async (path) => path in files,
    readFile: async (path) => files[path] ?? '',
    writeFile: async (path, text) => {
      if (options.failWrite) throw new Error('EACCES')
      files[path] = text
    },
    now: async () => T0,
    fallback: (line) => fallback.push(line),
  }
  // A slow read widens the read-modify-write window an unserialised writer would lose lines in.
  if (options.slow) {
    const read = io.readFile
    io.readFile = async (path) => {
      const text = await read(path)
      await Promise.resolve()
      await Promise.resolve()
      return text
    }
  }
  return { io, files, fallback }
}

describe('modLog', () => {
  test('appends one line per event as "<UTC ISO> <mod> session=<id>: <text>", creating the file when missing', async () => {
    const { io, files } = memory()
    await modLog(io, 'evening-compact', 's1', 'compacted')
    await modLog(io, 'evening-compact', 's1', 'skipped (context 5 tokens)')
    expect(files[LOG], 'mods.log').toBe(
      '2026-10-03T18:50:07.123Z evening-compact session=s1: compacted\n' +
        '2026-10-03T18:50:07.123Z evening-compact session=s1: skipped (context 5 tokens)\n',
    )
  })

  test('keeps one event on one line by stripping CR and LF from the text', async () => {
    const { io, files } = memory()
    await modLog(io, 'm', 's1', 'failed (a\r\nb\nc\rd)')
    const lines = (files[LOG] ?? '').split('\n')
    expect(lines.length, `lines in ${JSON.stringify(files[LOG])}`).toBe(2)
    expect(lines[0] ?? '').toContain('failed (a b c d)')
  })

  test('does not lose lines when many writes start at once', async () => {
    const { io, files } = memory('', { slow: true })
    await Promise.all(Array.from({ length: 20 }, (_, i) => modLog(io, 'm', 's1', `event ${i}`)))
    const texts = (files[LOG] ?? '').split('\n').filter(Boolean).map((l) => l.split(': ').pop())
    expect(texts, 'every concurrent event, in call order').toEqual(Array.from({ length: 20 }, (_, i) => `event ${i}`))
  })

  test('over 1 MiB, drops the oldest lines at a line boundary and keeps the newest', async () => {
    const old = Array.from({ length: 12_000 }, (_, i) => `2026-01-01T00:00:00.000Z m session=s: old ${String(i).padStart(6, '0')} ${'x'.repeat(80)}\n`).join('')
    expect(old.length, 'fixture size').toBeGreaterThan(1024 * 1024)
    const { io, files } = memory(old)
    await modLog(io, 'm', 's1', 'newest')
    const out = files[LOG] ?? ''
    const lines = out.split('\n').slice(0, -1)
    expect(out.length, 'trimmed size').toBeLessThanOrEqual(1024 * 1024 / 2 + 200)
    expect(lines.every((l) => l.startsWith('2026-')), 'every kept line is whole, not cut mid-line').toBe(true)
    expect(lines.at(-1), 'newest line kept').toContain('session=s1: newest')
    expect(lines.at(-2), 'line before the new one is the last old one').toContain('old 011999')
    expect(out, 'oldest lines dropped').not.toContain('old 000000')
  })

  test('falls back to the injected sink with the full line when the write fails', async () => {
    const { io, fallback } = memory(undefined, { failWrite: true })
    await modLog(io, 'm', 's1', 'compacted')
    expect(fallback, 'fallback lines').toEqual(['2026-10-03T18:50:07.123Z m session=s1: compacted'])
  })

  test('falls back when the existing file cannot be read, rather than overwriting it', async () => {
    const { io, files, fallback } = memory('precious\n')
    io.readFile = async () => {
      throw new Error('EIO')
    }
    await modLog(io, 'm', 's1', 'compacted')
    expect(files[LOG], 'mods.log').toBe('precious\n')
    expect(fallback.length, 'fallback lines').toBe(1)
  })

  test('falls back, without a timestamp, when the clock cannot be read', async () => {
    const { io, files, fallback } = memory()
    io.now = async () => {
      throw new Error('clock down')
    }
    await modLog(io, 'm', 's1', 'compacted')
    expect({ file: files[LOG], fallback }, 'log file and fallback lines').toEqual({ file: undefined, fallback: ['m session=s1: compacted'] })
  })

  test('keeps logging after a failed write', async () => {
    const { io, files } = memory(undefined, { failWrite: true })
    await modLog(io, 'm', 's1', 'first')
    io.writeFile = async (path, text) => {
      files[path] = text
    }
    await modLog(io, 'm', 's1', 'second')
    expect(files[LOG], 'mods.log').toContain('second')
  })
})
