import { describe, expect, test } from 'claude-code/testing'

import { resolveCacheTtl, type TtlInputs } from '../hooks/mods/lib/cc-cache-ttl'

const SUB = [{ kind: 'five_hour', percentUsed: 20 }]
const OVERAGE = [{ kind: 'five_hour', percentUsed: 100 }]
const none: TtlInputs = { disableEnvs: [], forceFiveMinuteEnv: undefined, ttlEnv: undefined, ttlSetting: undefined, oneHourEnv: undefined, rateLimits: [] }

describe('resolveCacheTtl', () => {
  // reason is asserted only where which branch won is the point of the row
  const cases: { name: string; in: Partial<TtlInputs>; want: '5m' | '1h'; reason?: string }[] = [
    { name: 'DISABLE_PROMPT_CACHING beats an explicit 1h env', in: { disableEnvs: ['1'], ttlEnv: '1h', rateLimits: SUB }, want: '5m', reason: 'DISABLE_PROMPT_CACHING' },
    { name: 'a per-model DISABLE var counts, as the model is unknown', in: { disableEnvs: [undefined, undefined, 'true'], rateLimits: SUB }, want: '5m', reason: 'DISABLE_PROMPT_CACHING' },
    { name: 'a falsy DISABLE var is ignored', in: { disableEnvs: ['0'], rateLimits: SUB }, want: '1h' },
    { name: 'FORCE_PROMPT_CACHING_5M beats an explicit 1h env', in: { forceFiveMinuteEnv: 'true', ttlEnv: '1h', rateLimits: SUB }, want: '5m', reason: 'FORCE_PROMPT_CACHING_5M' },
    { name: 'a falsy FORCE_PROMPT_CACHING_5M is ignored', in: { forceFiveMinuteEnv: '0', rateLimits: SUB }, want: '1h' },
    { name: 'env 1h', in: { ttlEnv: '1h' }, want: '1h', reason: 'CLAUDE_CODE_PROMPT_CACHE_TTL' },
    { name: 'env 5m beats a subscription', in: { ttlEnv: '5m', rateLimits: SUB }, want: '5m', reason: 'CLAUDE_CODE_PROMPT_CACHE_TTL' },
    { name: 'env is trimmed', in: { ttlEnv: ' 1h ' }, want: '1h' },
    { name: 'env garbage falls through to the subscription rule', in: { ttlEnv: '2h', rateLimits: SUB }, want: '1h', reason: 'subscription' },
    { name: 'env is case-sensitive, so 1H falls through', in: { ttlEnv: '1H' }, want: '5m' },
    { name: 'setting 1h', in: { ttlSetting: '1h' }, want: '1h', reason: 'promptCacheTtl setting' },
    { name: 'setting 5m beats a subscription', in: { ttlSetting: '5m', rateLimits: SUB }, want: '5m', reason: 'promptCacheTtl setting' },
    { name: 'env beats the setting', in: { ttlEnv: '5m', ttlSetting: '1h' }, want: '5m', reason: 'CLAUDE_CODE_PROMPT_CACHE_TTL' },
    { name: 'ENABLE_PROMPT_CACHING_1H true', in: { oneHourEnv: 'true' }, want: '1h', reason: 'ENABLE_PROMPT_CACHING_1H' },
    { name: 'ENABLE_PROMPT_CACHING_1H 0 falls through', in: { oneHourEnv: '0' }, want: '5m' },
    { name: 'ENABLE_PROMPT_CACHING_1H wins during overage', in: { oneHourEnv: '1', rateLimits: OVERAGE }, want: '1h', reason: 'ENABLE_PROMPT_CACHING_1H' },
    { name: 'a subscription under its limits', in: { rateLimits: [{ kind: 'five_hour', percentUsed: 99.9 }, { kind: 'seven_day', percentUsed: 40 }] }, want: '1h', reason: 'subscription' },
    { name: 'a five-hour window at 100 is overage', in: { rateLimits: [{ kind: 'five_hour', percentUsed: 100 }, { kind: 'seven_day', percentUsed: 40 }] }, want: '5m', reason: 'over its usage limit' },
    { name: 'a seven-day window at 100 is overage', in: { rateLimits: [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 100 }] }, want: '5m' },
    { name: 'an explicit 1h setting wins during overage', in: { ttlSetting: '1h', rateLimits: OVERAGE }, want: '1h', reason: 'promptCacheTtl setting' },
    { name: 'a gateway spend_limit alone is 5m', in: { rateLimits: [{ kind: 'spend_limit', percentUsed: 5 }] }, want: '5m', reason: 'Claude gateway' },
    { name: 'spend_limit next to a five_hour window is still the gateway', in: { rateLimits: [{ kind: 'spend_limit', percentUsed: 5 }, ...SUB] }, want: '5m', reason: 'Claude gateway' },
    { name: 'no readings is unknown, so 5m', in: {}, want: '5m', reason: 'no plan rate-limit readings' },
  ]

  for (const c of cases) {
    test(c.name, () => {
      const got = resolveCacheTtl({ ...none, ...c.in })
      expect(got.ttl, `ttl for ${JSON.stringify(c.in)}, reason "${got.reason}"`).toBe(c.want)
      if (c.reason !== undefined) expect(got.reason, `reason for ${JSON.stringify(c.in)}`).toContain(c.reason)
    })
  }
})
