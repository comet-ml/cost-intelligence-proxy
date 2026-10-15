const MAX_CHARS = 1024 * 1024
const MAX_TEXT = 2000

// The caller makes the $.fs and $.clock calls: validate follows `$` only within one file.
export type ModLogIo = {
  // The cipx home dir; undefined means no log file, so the line goes to the fallback.
  home: () => Promise<string | undefined>
  exists: (path: string) => Promise<boolean>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, text: string) => Promise<void>
  now: () => Promise<number>
  fallback: (line: string) => void
}

// $.fs.write replaces the whole file, so an append is read + write; one chain keeps them from interleaving.
let chain: Promise<void> = Promise.resolve()

const trim = (content: string) => {
  if (content.length <= MAX_CHARS) return content
  const cut = content.indexOf('\n', content.length - MAX_CHARS / 2)
  return cut < 0 ? '' : content.slice(cut + 1)
}

const append = async (io: ModLogIo, mod: string, sessionId: string, text: string) => {
  const flat = text.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT)
  let line = `${mod} session=${sessionId}: ${flat}`
  try {
    line = `${new Date(await io.now()).toISOString()} ${line}`
    const home = await io.home()
    if (home === undefined) throw new Error('no cipx home')
    const path = `${home}/logs/mods.log`
    // A failed read must not pass for an empty file, or the write would wipe the log.
    const existing = (await io.exists(path)) ? await io.readFile(path) : ''
    await io.writeFile(path, trim(`${existing}${line}\n`))
  } catch {
    io.fallback(line)
  }
}

export const modLog = (io: ModLogIo, mod: string, sessionId: string, text: string): Promise<void> => {
  chain = chain.then(() => append(io, mod, sessionId, text)).catch(() => {})
  return chain
}
