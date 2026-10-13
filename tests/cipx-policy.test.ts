import { describe, expect, test } from 'claude-code/testing'

import { adaptiveSetting, stringKnob } from '../hooks/mods/lib/cipx-policy'

const WINDOW = { window_start: '17:00', window_end: '00:00' }
const settings = (claudeCode: unknown) => ({ cipx: { adaptive_settings: { claude_code: claudeCode } } })
const DEFAULT_FILE = '/home/u/.opik-cipx/policy-state.json'

const lookup = (env: Record<string, string>, files: Record<string, string>) =>
  adaptiveSetting(
    {
      homeEnv: async () => env.HOME,
      cipxHomeEnv: async () => env.CIPX_HOME,
      readFile: async (path) => {
        const text = files[path]
        if (text === undefined) throw new Error(`ENOENT ${path}`)
        return text
      },
    },
    'claude_code',
    'session_compact',
  )

describe('adaptiveSetting', () => {
  const cases: { name: string; env?: Record<string, string>; files: Record<string, string>; want: unknown }[] = [
    { name: 'reads the {etag, settings} file the daemon writes', files: { [DEFAULT_FILE]: JSON.stringify({ etag: 'e1', settings: settings({ session_compact: WINDOW }) }) }, want: WINDOW },
    { name: 'reads a legacy file holding the bare settings map', files: { [DEFAULT_FILE]: JSON.stringify(settings({ session_compact: WINDOW })) }, want: WINDOW },
    { name: 'finds no policy when the file is missing', files: {}, want: undefined },
    { name: 'finds no policy when the file is not JSON', files: { [DEFAULT_FILE]: '{"etag": "e1", "sett' }, want: undefined },
    { name: 'finds no setting when the section is absent', files: { [DEFAULT_FILE]: JSON.stringify({ etag: 'e1', settings: settings({}) }) }, want: undefined },
    { name: 'finds no setting when the section is not an object', files: { [DEFAULT_FILE]: JSON.stringify({ settings: settings({ session_compact: '17:00-00:00' }) }) }, want: undefined },
    {
      name: 'follows CIPX_HOME over the default home',
      env: { HOME: '/home/u', CIPX_HOME: '/srv/cipx' },
      files: { '/srv/cipx/policy-state.json': JSON.stringify({ settings: settings({ session_compact: WINDOW }) }) },
      want: WINDOW,
    },
    {
      name: 'expands a leading ~ in CIPX_HOME against HOME',
      env: { HOME: '/home/u', CIPX_HOME: '~/.opik-cipx-mac' },
      files: { '/home/u/.opik-cipx-mac/policy-state.json': JSON.stringify({ settings: settings({ session_compact: WINDOW }) }) },
      want: WINDOW,
    },
  ]

  for (const c of cases) {
    test(c.name, async () => {
      expect(await lookup(c.env ?? { HOME: '/home/u' }, c.files)).toEqual(c.want)
    })
  }
})

describe('stringKnob', () => {
  const cases = [
    { name: 'returns a string trimmed', fragment: { k: ' 18:00 ' }, want: '18:00' },
    { name: 'does not read a number as text', fragment: { k: 1800 }, want: undefined },
    { name: 'treats a blank string as unset', fragment: { k: '  ' }, want: undefined },
    { name: 'treats an absent key as unset', fragment: {}, want: undefined },
  ]

  for (const c of cases) {
    test(c.name, () => {
      expect(stringKnob(c.fragment, 'k')).toBe(c.want)
    })
  }
})
