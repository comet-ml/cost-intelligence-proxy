type Fragment = Record<string, unknown>

export type Harness = 'claude_code' | 'codex'

// The caller makes the $.env.get and $.fs.read calls: validate follows `$` only within one file.
export type PolicyIo = {
  homeEnv: () => Promise<string | undefined>
  cipxHomeEnv: () => Promise<string | undefined>
  readFile: (path: string) => Promise<string>
}

const isFragment = (v: unknown): v is Fragment => typeof v === 'object' && v !== null && !Array.isArray(v)

// Like the cipx daemon, expands a leading ~ in CIPX_HOME against HOME.
export const cipxHome = async (io: PolicyIo): Promise<string | undefined> => {
  const home = await io.homeEnv()
  const override = await io.cipxHomeEnv()
  if (override) {
    if (override !== '~' && !override.startsWith('~/')) return override
    return home ? home + override.slice(1) : undefined
  }
  return home ? `${home}/.opik-cipx` : undefined
}

// The cipx daemon writes {etag, settings}; older files hold the bare settings map.
export const readPolicy = async (io: PolicyIo): Promise<Fragment | undefined> => {
  const home = await cipxHome(io)
  if (home === undefined) return undefined
  try {
    const file: unknown = JSON.parse(await io.readFile(`${home}/policy-state.json`))
    if (!isFragment(file)) return undefined
    return isFragment(file.settings) ? file.settings : file
  } catch {
    return undefined
  }
}

export const adaptiveSetting = async (io: PolicyIo, harness: Harness, name: string): Promise<Fragment | undefined> => {
  let node: unknown = await readPolicy(io)
  for (const key of ['cipx', 'adaptive_settings', harness, name]) {
    if (!isFragment(node)) return undefined
    node = node[key]
  }
  return isFragment(node) ? node : undefined
}

// Like the cipx daemon, only a real, non-blank string counts, so 1800 never reads as "18:00".
export const stringKnob = (fragment: Fragment, key: string): string | undefined => {
  const v = fragment[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}
