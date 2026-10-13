import type { Register } from 'claude-code'

import { registerEveningCompact } from './evening-compact'

export const register: Register = (on, options) => {
  registerEveningCompact(on, options)
}
