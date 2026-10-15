import { describe, expect, test } from 'claude-code/testing'

import { adminPort, sessionCompact, type DaemonIo } from '../hooks/mods/lib/cipx-daemon'

type Fake = { env?: Record<string, string>; files?: Record<string, string>; res?: { status: number; text: string } | Error }

const io = ({ env = { HOME: '/home/u' }, files = {}, res = { status: 200, text: '{"enabled":false}' } }: Fake = {}) => {
  const urls: string[] = []
  const daemon: DaemonIo = {
    homeEnv: async () => env.HOME,
    cipxHomeEnv: async () => env.CIPX_HOME,
    readFile: async (path) => {
      if (files[path] === undefined) throw new Error(`ENOENT ${path}`)
      return files[path]
    },
    fetch: async (url) => {
      urls.push(url)
      if (res instanceof Error) throw res
      return { ...res, ok: res.status >= 200 && res.status < 300 }
    },
  }
  return { daemon, urls }
}

const STATE = '/home/u/.opik-cipx/state.json'
const PORTS = '/home/u/.opik-cipx/ports.json'

describe('adminPort', () => {
  const cases: { name: string; fake: Fake; port: number }[] = [
    { name: 'reads admin_port from state.json', fake: { files: { [STATE]: '{"admin_port":9911}' } }, port: 9911 },
    { name: 'prefers state.json over ports.json', fake: { files: { [STATE]: '{"admin_port":9911}', [PORTS]: '{"admin":9922}' } }, port: 9911 },
    { name: 'falls back to ports.json when state.json is missing', fake: { files: { [PORTS]: '{"admin":9922}' } }, port: 9922 },
    { name: 'falls back to ports.json when state.json is not JSON', fake: { files: { [STATE]: '{"admin_po', [PORTS]: '{"admin":9922}' } }, port: 9922 },
    { name: 'falls back to ports.json when state.json has no usable port', fake: { files: { [STATE]: '{"admin_port":"9911"}', [PORTS]: '{"admin":9922}' } }, port: 9922 },
    { name: 'follows CIPX_HOME over the default home', fake: { env: { HOME: '/home/u', CIPX_HOME: '/srv/cipx' }, files: { '/srv/cipx/state.json': '{"admin_port":9933}', [STATE]: '{"admin_port":9911}' } }, port: 9933 },
    { name: 'expands a leading ~ in CIPX_HOME against HOME', fake: { env: { HOME: '/home/u', CIPX_HOME: '~/.opik-cipx-mac' }, files: { '/home/u/.opik-cipx-mac/state.json': '{"admin_port":9944}' } }, port: 9944 },
  ]

  for (const c of cases) {
    test(c.name, async () => {
      expect(await adminPort(io(c.fake).daemon), 'admin port').toBe(c.port)
    })
  }

  test('rejects, naming both files, when neither holds a port', async () => {
    await expect(adminPort(io({ files: { [PORTS]: '{"admin":0}' } }).daemon)).rejects.toThrow('state.json or /home/u/.opik-cipx/ports.json')
  })

  test('rejects when no home can be found', async () => {
    await expect(adminPort(io({ env: {} }).daemon)).rejects.toThrow('no cipx home')
  })
})

describe('sessionCompact', () => {
  const files = { [STATE]: '{"admin_port":9911}' }
  const ask = (res: Fake['res']) => sessionCompact(io({ files, res }).daemon, 's1')

  test('asks the daemon on the discovered port with the session id escaped', async () => {
    const { daemon, urls } = io({ files })
    await sessionCompact(daemon, 'a b&c')
    expect(urls, 'requested URLs').toEqual(['http://127.0.0.1:9911/mods/session_compact?session_id=a%20b%26c'])
  })

  test('parses an enabled answer', async () => {
    const text = '{"enabled":true,"window_start":"17:00","window_end":"23:00","cache_ttl":"1h"}'
    expect(await ask({ status: 200, text })).toEqual({ enabled: true, windowStart: '17:00', windowEnd: '23:00', startMinutes: 1020, endMinutes: 1380, cacheTtl: '1h' })
  })

  test('parses a disabled answer, with or without a reason', async () => {
    expect(await ask({ status: 200, text: '{"enabled":false}' })).toEqual({ enabled: false })
    expect(await ask({ status: 200, text: '{"enabled":false,"reason":"window invalid"}' })).toEqual({ enabled: false })
  })

  const ttlCases = [
    { name: 'an unrecognised cache_ttl, verbatim for the log', cacheTtl: '"2h"', want: '2h' },
    { name: 'an empty cache_ttl', cacheTtl: '""', want: 'unknown' },
    { name: 'a missing cache_ttl', cacheTtl: undefined, want: 'unknown' },
    { name: 'a non-string cache_ttl', cacheTtl: '3600', want: 'unknown' },
    { name: '5m', cacheTtl: '"5m"', want: '5m' },
  ]
  for (const c of ttlCases) {
    test(`reads ${c.name} as ${c.want}`, async () => {
      const ttl = c.cacheTtl === undefined ? '' : `,"cache_ttl":${c.cacheTtl}`
      const got = await ask({ status: 200, text: `{"enabled":true,"window_start":"17:00","window_end":"23:00"${ttl}}` })
      expect(got.enabled && got.cacheTtl, 'cacheTtl').toBe(c.want)
    })
  }

  const errorCases: { name: string; res: Fake['res']; message: string }[] = [
    { name: 'a daemon that predates the endpoint (404)', res: { status: 404, text: 'not found' }, message: 'HTTP 404' },
    { name: 'a 400', res: { status: 400, text: 'missing session_id' }, message: 'HTTP 400' },
    { name: 'a body that is not JSON', res: { status: 200, text: '<html>' }, message: 'not JSON' },
    { name: 'a body without enabled', res: { status: 200, text: '{"window_start":"17:00"}' }, message: 'no boolean "enabled"' },
    { name: 'a JSON array', res: { status: 200, text: '[]' }, message: 'no boolean "enabled"' },
    { name: 'an enabled answer with a malformed window', res: { status: 200, text: '{"enabled":true,"window_start":"5pm","window_end":"23:00"}' }, message: 'not HH:MM' },
    { name: 'an enabled answer with an out-of-range hour', res: { status: 200, text: '{"enabled":true,"window_start":"17:00","window_end":"24:00"}' }, message: 'not HH:MM' },
    { name: 'an enabled answer with an empty window', res: { status: 200, text: '{"enabled":true,"window_start":"09:00","window_end":"09:00"}' }, message: 'equals' },
    { name: 'an unreachable daemon', res: new Error('connection refused'), message: 'unreachable on port 9911: connection refused' },
  ]
  for (const c of errorCases) {
    test(`rejects with a descriptive error on ${c.name}`, async () => {
      await expect(ask(c.res)).rejects.toThrow(c.message)
    })
  }
})
