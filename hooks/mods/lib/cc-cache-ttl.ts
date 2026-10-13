// Mirrors Claude Code 2.1.292's main-thread prompt-cache TTL rule; it can drift in later versions.
export type CacheTtl = '5m' | '1h'

export type TtlInputs = {
  // DISABLE_PROMPT_CACHING and its per-model variants.
  disableEnvs: (string | undefined)[]
  forceFiveMinuteEnv: string | undefined
  ttlEnv: string | undefined
  ttlSetting: unknown
  oneHourEnv: string | undefined
  rateLimits: readonly { kind: string; percentUsed: number }[]
}

const truthy = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes((v ?? '').trim().toLowerCase())

const explicit = (v: unknown): CacheTtl | undefined => {
  const text = typeof v === 'string' ? v.trim() : ''
  return text === '5m' || text === '1h' ? text : undefined
}

export const resolveCacheTtl = (i: TtlInputs): { ttl: CacheTtl; reason: string } => {
  if (i.disableEnvs.some(truthy)) return { ttl: '5m', reason: 'DISABLE_PROMPT_CACHING' }
  if (truthy(i.forceFiveMinuteEnv)) return { ttl: '5m', reason: 'FORCE_PROMPT_CACHING_5M' }
  const fromEnv = explicit(i.ttlEnv)
  if (fromEnv) return { ttl: fromEnv, reason: 'CLAUDE_CODE_PROMPT_CACHE_TTL' }
  const fromSetting = explicit(i.ttlSetting)
  if (fromSetting) return { ttl: fromSetting, reason: 'promptCacheTtl setting' }
  if (truthy(i.oneHourEnv)) return { ttl: '1h', reason: 'ENABLE_PROMPT_CACHING_1H' }

  // Claude Code emits spend_limit only for the gateway provider, whose users are not subscribers.
  if (i.rateLimits.some((r) => r.kind === 'spend_limit')) return { ttl: '5m', reason: 'Claude gateway' }
  const windows = i.rateLimits.filter((r) => r.kind === 'five_hour' || r.kind === 'seven_day')
  if (windows.length === 0) return { ttl: '5m', reason: 'no plan rate-limit readings' }
  // Approximates Claude Code's isUsingOverage; model-scoped weekly limits are invisible here.
  if (windows.some((r) => r.percentUsed >= 100)) return { ttl: '5m', reason: 'subscription over its usage limit' }
  return { ttl: '1h', reason: 'subscription' }
}
