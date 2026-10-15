# opik-cipx mods

Claude Code mods shipped with the opik-cipx plugin. Each mod is a file in this directory that `index.ts` registers; `hooks/hooks.json` names `index.ts` under `modules`. Mods are an early-access Claude Code API; these were written against Claude Code 2.1.288. Every mod is off until the org's cipx policy turns it on; the cipx daemon reports that policy to the mod.

## evening-compact

Compacts an idle main-thread session ten minutes before its 1h prompt cache expires (at 50m idle), the same way `/compact` does, but only inside the window the org sets in the cipx policy. Sessions under 30k context tokens are left alone. After a compaction, the transcript gets a line saying "Comet compacted this session at HH:MM while it was idle." That is the only line the mod writes to the transcript.

**The daemon provides the facts, the mod decides.** Every main-thread turn arms a 50m timer (a new turn cancels it). When it fires, the mod asks the cipx daemon `GET /mods/session_compact?session_id=<id>` on its admin port (from `<cipx home>/state.json`, else `ports.json`; the home is `$CIPX_HOME`, default `~/.opik-cipx`). The daemon answers whether the org policy turns the mod on, the window (`window_start`, `window_end`, local `HH:MM`), and the prompt-cache TTL it observed for that session (`1h`, `5m` or `unknown`). The daemon logs an invalid window itself and answers disabled. The mod compacts only when all of these hold:

- The policy is on (otherwise it does nothing and logs nothing).
- The fire time is inside the window. The start is inclusive, the end exclusive, and the window may wrap past midnight.
- The cache TTL is `1h`. The 50m timing is built for the 1h tier, so `5m` and `unknown` sessions are skipped.
- The context is at least 30k tokens.

The cache TTL is only known after the session's requests went through the cipx proxy.

**Logs.** Each decision is one line in `~/.opik-cipx/logs/mods.log` (`opik-cipx logs mods`): `<UTC timestamp> evening-compact session=<id>: <text>`, where the text is `compacted`, `skipped (<reason>)`, `failed (<error>)` or `not checked (cipx daemon: <error>)`. The file keeps its newest 512 KiB once it passes 1 MiB. If the file cannot be written, the line goes to the Claude Code debug log.

**Compaction wins over cache warming.** cipx's `cache_warm` replays an idle session's last turn to keep its cache alive; its first keepalive on a 1h cache goes out at 55m12s. The mod fires at 50m, ahead of that keepalive, while the cache is still alive, and cipx stops warming the session once it sees the compaction.

### Known gaps

- It does not check that a policy backend is configured, so a stale policy still applies.
- It has no minimum idle time and no cap on compactions per window.
- The 50m lead sits ahead of cipx's first 1h keepalive (55m12s), so it must follow any change to that cadence.
- The pending timer lives only in memory: a plugin update or reload while a session is idle cancels that session's compaction.
- A daemon older than the `/mods/session_compact` endpoint answers 404, so there is no evening compact; the mod logs `not checked`.
- A daemon restart forgets the observed cache TTLs until each session's next turn, so a compaction that fires in between is skipped as `unknown`.
- `mods.log` is appended by read and rewrite, so two sessions logging at the same instant can drop a line.
- The macOS app's capture path does not serve the endpoint, so sessions captured by the app are `not checked`.
- The `modules` key in `hooks/hooks.json` is verified only on Claude Code 2.1.288 and later. If an older Claude Code rejects it, the plugin's `sync` hooks go down with it.

## Adding a mod

1. Write `<name>.ts` here exporting a `register(on, options)`-shaped function, and call it from `index.ts`. A plugin's `hooks.json` names one module, which is why the entry file exists.
2. Ask the daemon through `lib/cipx-daemon.ts` (home and admin-port discovery, response parsing) and log through `lib/mod-log.ts`. `claude plugin validate` follows `$` only within one file, so the mod makes the `$.env.get`, `$.fs` and `$.http.fetch` calls itself and passes them in (see `daemonIo` and `logIo` in `evening-compact.ts`).
3. No mod has settings today. A mod that adds some puts them in `.claude-plugin/plugin.json` under `userConfig`, with keys prefixed by the mod's name (all mods share one namespace).
4. The macOS app sets `CIPX_HOME` only in its engine's environment, not in Claude Code's, so a mod reads `~/.opik-cipx` there, as `opik-cipx sync` does.

## Run and check

From the repository root:

- Try it: `claude --plugin-dir .`
- Check it: `claude plugin validate .` and `claude plugin test .` (tests live in `tests/`)
