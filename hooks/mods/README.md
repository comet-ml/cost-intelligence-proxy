# opik-cipx mods

Claude Code mods shipped with the opik-cipx plugin. Each mod is a file in this directory that `index.ts` registers; `hooks/hooks.json` names `index.ts` under `modules`. Mods are an early-access Claude Code API; these were written against Claude Code 2.1.288. Every mod is off until the org's cipx policy turns it on.

## evening-compact

Compacts an idle main-thread session ten minutes before its 1h prompt cache expires (at 50m idle), the same way `/compact` does, but only inside the window the org sets in the cipx policy. Sessions under 30k context tokens are left alone. After a compaction, the transcript gets a line saying "Comet compacted this session at HH:MM while it was idle." and the status line shows the same until the next turn.

**The policy is the switch.** The mod reads `$CIPX_HOME/policy-state.json` (default `~/.opik-cipx/policy-state.json`, written by the cipx daemon) when its timer fires, so a policy change applies without a restart. The setting is `settings.cipx.adaptive_settings.claude_code.session_compact`, holding `window_start` and `window_end` as local `H:MM` strings:

- Section missing: the mod does nothing.
- A bound that is missing, not a string, not a valid time, or equal to the other bound: the mod does nothing and logs `evening-compact: session_compact window ignored (<reason>)`.
- Otherwise it compacts only when the fire time is inside the window. The start is inclusive, the end exclusive, and the window may wrap past midnight.

The parsing matches the cipx daemon's.

**It compacts only a 1h cache.** The 50m timing is built for the 1h tier, so 5m sessions are skipped on purpose. The mod resolves the main thread's cache TTL with a mirror of Claude Code's rule, once when a turn ends (it arms the timer only on 1h) and again at fire time after the policy window passes (it compacts only if both say 1h):

1. `DISABLE_PROMPT_CACHING`, or any per-model `DISABLE_PROMPT_CACHING_*`, set: no 1h cache.
2. `FORCE_PROMPT_CACHING_5M` set: 5m.
3. `CLAUDE_CODE_PROMPT_CACHE_TTL`, if exactly `5m` or `1h`.
4. The `promptCacheTtl` setting, if exactly `5m` or `1h`.
5. `ENABLE_PROMPT_CACHING_1H` set: 1h.
6. Otherwise 1h on a subscription that is not over its usage limit. A gateway (`spend_limit` reading), no five-hour or seven-day reading, or a window at 100% is 5m.

A skip is logged to the debug log only (`evening-compact: skipped (prompt cache is 5m: <reason>)`). If the usage or settings read fails at arm time, the transcript gets `evening-compact: not armed (<error>)` and the timer is not armed.

**Compaction wins over cache warming.** cipx's `cache_warm` replays an idle session's last turn to keep its cache alive; its first keepalive on a 1h cache goes out at 55m12s. The mod fires at 50m, ahead of that keepalive, while the cache is still alive, and cipx stops warming the session once it sees the compaction.

### Known gaps

- It does not check that a policy backend is configured, so a stale policy file still applies.
- It has no minimum idle time and no cap on compactions per window.
- The 50m lead sits ahead of cipx's first 1h keepalive (55m12s), so it must follow any change to that cadence.
- The pending timer lives only in memory: a plugin update or reload while a session is idle cancels that session's compaction.
- The TTL rule mirrors Claude Code 2.1.292 (`lib/cc-cache-ttl.ts`) and can drift in later versions.
- Overage is approximated from the rate-limit readings: a five-hour or seven-day window at 100%. Model-scoped weekly limits (e.g. `seven_day_opus`) are not exposed to mods, so overage on one of them is missed and the mod may compact a 5m cache.
- Usage-based subscriber seats may send no five-hour or seven-day readings and would then always be skipped (unverified).
- `ENABLE_PROMPT_CACHING_1H_BEDROCK` is not mirrored; that falls to 5m, the harmless direction.
- Claude Code's server-side allowlist for subscriber 1h caching is assumed to include the main thread, which is its default.
- The `modules` key in `hooks/hooks.json` is verified only on Claude Code 2.1.288 and later. If an older Claude Code rejects it, the plugin's `sync` hooks go down with it.

## Adding a mod

1. Write `<name>.ts` here exporting a `register(on, options)`-shaped function, and call it from `index.ts`. A plugin's `hooks.json` names one module, which is why the entry file exists.
2. Read org policy through `lib/cipx-policy.ts`. `claude plugin validate` follows `$` only within one file, so the mod makes the `$.env.get` and `$.fs.read` calls itself and passes them in (see `policyIo` in `evening-compact.ts`).
3. No mod has settings today. A mod that adds some puts them in `.claude-plugin/plugin.json` under `userConfig`, with keys prefixed by the mod's name (all mods share one namespace).
4. The macOS app sets `CIPX_HOME` only in its engine's environment, not in Claude Code's, so a mod reads `~/.opik-cipx` there, as `opik-cipx sync` does.

## Run and check

From the repository root:

- Try it: `claude --plugin-dir .`
- Check it: `claude plugin validate .` and `claude plugin test .` (tests live in `tests/`)
