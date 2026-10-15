export type SessionCompactAnswer =
  | { enabled: false }
  // cacheTtl is the daemon's raw string ("1h", "5m", "unknown", or whatever a newer daemon says), for the log line.
  | { enabled: true; windowStart: string; windowEnd: string; startMinutes: number; endMinutes: number; cacheTtl: string }

// The caller makes the $.env.get, $.fs.read and $.http.fetch calls: validate follows `$` only within one file.
export type DaemonIo = {
  homeEnv: () => Promise<string | undefined>
  cipxHomeEnv: () => Promise<string | undefined>
  readFile: (path: string) => Promise<string>
  fetch: (url: string) => Promise<{ status: number; ok: boolean; text: string }>
}

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Like the cipx daemon, expands a leading ~ in CIPX_HOME against HOME.
export const cipxHome = async (io: Pick<DaemonIo, 'homeEnv' | 'cipxHomeEnv'>): Promise<string | undefined> => {
  const home = await io.homeEnv()
  const override = await io.cipxHomeEnv()
  if (override) {
    if (override !== '~' && !override.startsWith('~/')) return override
    return home ? home + override.slice(1) : undefined
  }
  return home ? `${home}/.opik-cipx` : undefined
}

const asPort = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 65536 ? v : undefined)

const portFrom = async (io: DaemonIo, path: string, key: string) => {
  try {
    const file: unknown = JSON.parse(await io.readFile(path))
    return isObject(file) ? asPort(file[key]) : undefined
  } catch {
    return undefined
  }
}

// Same order as the daemon's own hook: state.json, then ports.json. The daemon picks its port, so there is no default.
export const adminPort = async (io: DaemonIo): Promise<number> => {
  const home = await cipxHome(io)
  if (home === undefined) throw new Error('no cipx home: neither CIPX_HOME nor HOME is set')
  const port = (await portFrom(io, `${home}/state.json`, 'admin_port')) ?? (await portFrom(io, `${home}/ports.json`, 'admin'))
  if (port === undefined) throw new Error(`no admin port in ${home}/state.json or ${home}/ports.json (daemon not running?)`)
  return port
}

// The daemon normalises window bounds, so anything but zero-padded HH:MM is a contract break.
const minutesOfDay = (hhmm: string): number | undefined => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return undefined
  const hours = Number(m[1])
  const mins = Number(m[2])
  return hours <= 23 && mins <= 59 ? hours * 60 + mins : undefined
}

const parseAnswer = (body: unknown): SessionCompactAnswer => {
  if (!isObject(body) || typeof body.enabled !== 'boolean') throw new Error('malformed response: no boolean "enabled"')
  if (!body.enabled) return { enabled: false }
  const { window_start: start, window_end: end } = body
  const startMinutes = typeof start === 'string' ? minutesOfDay(start) : undefined
  const endMinutes = typeof end === 'string' ? minutesOfDay(end) : undefined
  if (typeof start !== 'string' || typeof end !== 'string' || startMinutes === undefined || endMinutes === undefined) {
    throw new Error('malformed response: window_start/window_end are not HH:MM')
  }
  if (startMinutes === endMinutes) throw new Error('malformed response: window_start equals window_end')
  const cacheTtl = typeof body.cache_ttl === 'string' && body.cache_ttl !== '' ? body.cache_ttl : 'unknown'
  return { enabled: true, windowStart: start, windowEnd: end, startMinutes, endMinutes, cacheTtl }
}

export const sessionCompact = async (io: DaemonIo, sessionId: string): Promise<SessionCompactAnswer> => {
  const port = await adminPort(io)
  const url = `http://127.0.0.1:${port}/mods/session_compact?session_id=${encodeURIComponent(sessionId)}`
  let res: Awaited<ReturnType<DaemonIo['fetch']>>
  try {
    res = await io.fetch(url)
  } catch (err) {
    throw new Error(`unreachable on port ${port}: ${message(err)}`)
  }
  if (!res.ok) {
    const hint = res.status === 404 ? ' (a daemon older than this endpoint)' : ''
    throw new Error(`HTTP ${res.status} from /mods/session_compact${hint}`)
  }
  let body: unknown
  try {
    body = JSON.parse(res.text)
  } catch {
    throw new Error('malformed response: not JSON')
  }
  return parseAnswer(body)
}
