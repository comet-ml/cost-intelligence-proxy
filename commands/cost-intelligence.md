---
description: What cipx changed on this machine, what your organization's MCP policy blocks, what your last 30 days cost and where the tokens went, which cost policies are in effect for you and how to re-enable what they turned off — and, for org admins, the recommendations that would cut it further
argument-hint: [mcp server, skill, tool or settings key]
allowed-tools: Bash(opik-cipx cost-intelligence --markdown), Bash(opik-cipx cost-intelligence --markdown --commands), Bash(opik-cipx cost-intelligence --markdown --tool:*), Bash(opik-cipx cost-intelligence), Bash(opik-cipx mcp list)
---

Every session opens by telling this developer their Claude Code "has been
optimized" and sending them here. On its own that sentence is unverifiable.
Making it checkable is this command's whole job: what was actually changed on
this machine, what is actually blocked, what the last thirty days actually cost
and where the tokens went, which cost policies are actually in effect and who
set each one — each of them measured, none of them estimated — and, for
anything they turned off, the one route that turns it back on.

What this session is costing right now is deliberately **not** here: those
readings are the status line's, which redraws them live on every frame. This
report is the one place they would have arrived stale.

A `Recommendations` section appears only for organization admins — the backend
serves that list to admins only — so its absence is the ordinary case and never
something to flag, work around, or fetch another way. When it *is* there, the
developer reading it can change org policy from the terminal, under the rules in
"The Recommendations section" below.

## When the user named something

**`$ARGUMENTS` non-empty means they asked about one thing** — an MCP server, a
skill, a built-in tool, a Claude Code settings key. Run this and only this:

```
opik-cipx cost-intelligence --markdown --tool "$ARGUMENTS"
```

Paste what it prints and stop. Do not run the full report as well, do not run
`mcp list` "for context", and do not add the sections they did not ask for: they
asked why one thing is off and the answer is two lines. It exits 0 whether or
not the thing is off, and when it is not, that sentence is the answer too — not
a reason to go looking somewhere else.

The name goes through **exactly as the user said it**. The command does its own
matching — case, a permissions rule's head, a dotted key's leaf — and reports
what it matched. Correcting the name yourself is how a user gets told about a
server they never asked about.

## The full report

With no argument, run both. Both are read-only.

```
opik-cipx cost-intelligence --markdown
opik-cipx mcp list
```

**`--markdown` is not optional.** Without it the report prints ANSI escapes,
which are right for a terminal and wrong for here: what you paste is rendered
as markdown, and an escape sequence in your reply is inert text. The colour
that tells a drifted value from a settled one would simply not arrive.
`--markdown` is the same report with that distinction carried by bold and by
words instead.

If the user asks what they can run — what the commands are, what else cipx
does — add `--commands`:

```
opik-cipx cost-intelligence --markdown --commands
```

It appends a three-line list of the commands that exist. Leave it off
otherwise; it is the same on every machine every day, and it costs the report
the space its measured rows need.

## Show the output, do not retell it

**Paste each command's output into your reply as it came back, and stop.**

Do not retype it, summarise it, re-sort it, count it, or wrap it in a code
fence. Both commands print finished, branded answers: aligned columns, and a
marked column that separates a blocked row from an active one, and a value
about to be reverted from one that is settled. A fence shows the markup instead
of rendering it, retyping breaks the alignment, and either way you have asked
the user to trust your transcription of something they could have read
themselves.

After the two outputs you may add **at most one line**, and only for something
neither could say — that the daemon is not running, say. That line is an
addition, never a replacement. If there is nothing like that, add nothing; the
two outputs together are a complete answer.

## The MCP table

`opik-cipx mcp list` goes last, under the report — whose `Unused` rows are the
evidence for it and whose `Re-enable` groups name the same servers from the
other end. Show the table in full when either of these is true of what it
printed:

- any row reads `blocked`, or
- it carries a `Most recent change` block.

Otherwise replace it with **one line** — that no MCP server is blocked, and
that `/cost-intelligence-mcp` shows the table — and spend the space on the
other two sections. A screen of green `active` rows is the longest thing in
the reply and the only part of it that is not news; a blocked row is the
opposite, and it must never be the thing that got cut for room.

## The status line, when they ask about it

The live readings this report deliberately does not print are the status line's,
and this is where the question about them arrives. `opik-cipx sync` points
Claude Code's `statusLine` at `opik-cipx statusline` on every run, so every
developer with the plugin has the row whether or not they installed anything —
which means the row showing `◕ 42% · $1.87` is cipx's, and "what is this thing
in my status line?" is a question every session can be asked.

**Describe the row, do not send them here for it.** This report cannot answer
it: the readings are drawn on every frame and appear nowhere in what the command
prints. What the segment carries, left to right after the `◕`: context depth as
a percentage of the window, the session's cost so far, and — when they are worth
the columns — the five-hour and seven-day rate-limit windows as `5h 12%` /
`7d 71%`. At most one alert is ever added: `compact` (context nearly full),
`200k+` (past 200k tokens, where a token costs more), `limit` (a rate window
nearly spent) or `cold` (the prompt cache went cold). A recently applied org
setting can appear last, as `autoCompactWindow 2h ago`.

What else is true, and worth having straight before answering:

- **It did not replace their own status line.** cipx captured their command to
  `~/.opik-cipx/statusline-wrap.json` and runs it underneath, every row of it;
  its own segment takes a row below theirs. If their line vanished, that is a
  bug and not the design — say so rather than explaining it away.
- **Two switches, and they do different things.**
  `OPIK_CIPX_STATUSLINE_DISPLAY=0` hides the segment and leaves the sensor
  recording, so the row goes back to being entirely theirs.
  `OPIK_CIPX_STATUSLINE=off` opts out of the feature: no segment, and the next
  sync puts their own status line command back. Neither switch changes anything
  in this report.
- **Never send them to edit `statusLine` in `~/.claude/settings.json`.** Sync
  re-claims the key on the next prompt, so the edit disappears and looks like
  cipx fighting them. Name a variable instead.
- **An organization can push the status line through managed settings**, which
  outranks their file. There the switches above still hide the segment, but
  nothing local hands the key back — the org owns it.

The report says nothing about any of this — the whole section above is answered
from here, not from its output. In particular, do not go reading
`~/.opik-cipx/statusline.json` for numbers to quote: what is in that file is
whatever the last frame wrote, it may belong to another Claude Code window, and
pasting it hands the user a stale reading they will act on.

## The spend section

`Last 30 days` is the report's second section and the first that came off the
network. It opens with `Spend` — what the window actually cost, split into the
share of a seat, whatever went past the plan, and whatever was billed straight
to the API — then says where the tokens went (`Input`, `Output`), which models
and repositories they went on (`Models`, `Repos`), and finally, under `Unused`,
the MCP servers, skills and built-in tools that were billed all month for being
available and were barely used.

**Three different dollars appear in that section and they are not the same
figure.** The report labels each where it prints it, and those labels travel
with the figure or the figure does not get pasted:

- `$23.74 total · seat $8.34 · over-plan $12.00 · API $3.40` is money.
- `≈ $12.60 at list` is what those tokens *would* cost at API rates. Under a
  subscription seat it is a shadow price nobody was invoiced, and it routinely
  dwarfs the real total three rows above it.
- `$9.99 cash` on a `Models` or `Repos` row is marginal money only — over-plan
  plus API. `in-plan` there means a seat covered it, which is a measurement and
  not a missing figure: never restate it as `$0.00`.

Those `Unused` rows are the evidence behind a `blocked` row in the MCP table,
which is why the two are printed next to each other. Show them whenever they
are there. They are the one part of this report that names something the
developer could turn off today, and the token figures beside each name are the
whole argument for doing it.

The section can also print a single quiet line instead — that no backend is
configured, that the credentials were refused, or that it could not be reached
in time. That line is the answer. Show it as it came and add nothing: there is
no cached composition anywhere, and the section says so precisely because it
has nothing to report.

## Savings by policy source, and Re-enable

`Savings by policy source` is the report's third section: the cost policies
actually in effect for this developer, split into `Org` — what their
organization set — and `You` — what they set for themselves. Each block leads
with how many policies it holds, how many of those the backend could put a
price on, and what those add up to.

**`n/a` is an answer, and it is not zero.** It means the backend could not
observe that policy's saving from spend recorded after it was applied. Never
report it as $0.00, never call it "no saving", and never add up a column that
has one in it.

On a deployment whose cost-api does not serve that endpoint yet, the section is
replaced by `Policies applied · source unknown` plus a sentence saying a
cost-api update is what adds the split. Show it as it came. The rows are real —
they are what cipx applied on this machine — and the missing half is the source,
which is exactly what the heading says.

`Re-enable` is the fourth: for everything policy turned off, the one route that
turns it back on, grouped by route. `Locked` means an admin's, and the line says
plainly that editing `~/.claude/settings.json` will not stick. `Org` means a
default the developer may override for themselves. `Yours` means they turned it
off in their own Opik preferences.

**Never invent a sixth route.** Do not suggest editing settings.json for a
`Locked` row, do not suggest a `--dangerously` flag, do not offer to change the
policy yourself, and do not paste a preferences URL — the report names the page
in words on purpose, because a raw URL is the one thing on the line that gets
truncated.

## The Recommendations section

It is the last section, and it is the one that only an admin gets. Each row is
an id, what applying it would still save, and what it changes — plus
`quality trade-off` where the change can affect the answers Claude gives, and
`drifted` where it was applied and has since been undone.

**The section's presence is the only admin test there is.** The report asked the
backend with this developer's credential and rendered the section on a 200; a
member got a 401 or a 403 and no section. Never claim a role the report did not
show you, and never go looking for the list another way when it is absent.

When the section IS there, you may offer — in one line, after the outputs —
`opik-cipx policy apply <id>` for one row the user is asking about. Before
running it you must say, in your own words, that it applies to **everyone in the
organization**, that it is **re-applied on every policy check** so a developer's
own `settings.json` edit does not survive, and — if the row carries it — that it
is a **quality trade-off**. Then wait for an explicit yes. Preparing the command
is not permission to run it.

When the section is NOT there, the route stays what the report prints: the Opik
Cost savings page, or their admin. Do not offer a `policy` command to a
developer whose report has no Recommendations section — it would exit 3.

## Length

**28 lines.** A `--tool` answer is its own budget: **whatever it printed, and
nothing else.**

That number is a ceiling rather than a target — a saturated report runs to
fifty-five lines, and most of what it adds is cuttable. If the two outputs
together run past the budget, cut in this order and stop the moment it fits:

1. the `Commands` section — reference, not news: it is the only part of the
   report that reads the same on every machine every day, and re-running with
   `--commands` brings it straight back
2. the `Models` and `Repos` rows — a leaderboard is where the money went, not
   something to do about it
3. the `Input` and `Output` lane rows — where the tokens went is context, and
   the `Unused` rows below them are the same section's actionable half; cut the
   context and keep the action
4. the MCP table — down to the one-line form above
5. the two-line enforcement sentence — down to "Your organization sets these"
6. the per-entity `↳` rows under a policy — the policy row above them stays
7. policy rows past the first two in each block — the rest as a count
8. `Unused` rows past the first two — last out, and the rest as a count

Cutting means omitting whole lines. It never means rewording a line to make it
shorter: the moment you retype one you are back to transcription. `Commands`
comes out whole or not at all — half a list of commands reads as the whole one.

**Never cut a `Re-enable` group.** It is the only part of the reply that says
what to do rather than what is true, and a route the user cannot see costs them
the change they came to make. The `Commands` section is the exception and only
the exception: nothing in it is attached to a reading, which is why it is first
out.

## Never

- **Never compute or estimate a figure of your own, in any form** — a saving,
  a total, a projection, a monthly rate, a per-row sum. There is no price table
  anywhere in cipx, and a number invented to fill a gap would discredit every
  measured number beside it.
- **Every `$` the report printed may be pasted verbatim, and only verbatim.**
  Each was priced server-side by the spend backend, which owns the price table.
  Copy them. Do not add them up, scale them to a month, or turn one into what
  it "would save".
- **`tokens idle` and `tokens of schema` are token counts, and they are not
  the same count.** `tokens idle` is what the backend attributed to nobody
  using the entity; `tokens of schema` is everything the entity was billed for
  being available, on a row where the backend reported no narrower figure. Keep
  whichever word the report used, and never multiply either by a price.
- **`at list` travels with the figure it is attached to.** Those dollars are
  what the tokens would cost at API rates, which under a subscription seat is
  not money anyone was invoiced — and the section now prints real money three
  rows above them. Never present a list figure as this developer's bill, never
  drop the words that say which it is, and never compare the two.
- **`in-plan` and `n/a` are readings, not blanks.** `in-plan` means a seat
  covered that row; `n/a` means the backend could not measure that saving.
  Neither is $0.00, neither is "nothing", and neither may be filled in.
- **Never say denying an MCP server keeps tool *definitions* out of the
  context.** Claude Code defers MCP schemas behind tool search and fetches them
  on demand, so they were never in the request; measured on live traffic, a
  denial removes the server's entry from a list of tool names. What is true is
  what `mcp list` already prints: a blocked server never starts, so none of its
  tools exist in the session.
- **Never supply a reading the report did not print.** It does not report what
  this session is costing, and that is not a gap to fill: those readings are
  the status line's, and it redraws them every frame. Do not go looking for
  them in `~/.opik-cipx/statusline.json` — what is in that file is whatever the
  last frame wrote, it may belong to another Claude Code window, and pasting it
  hands the user a stale number they will act on. The same holds for the
  composition: if that section printed one quiet line, do not go and query the
  backend yourself. The report asked with the credential that scopes the answer
  to this developer; anything you fetch another way is scoped to somebody else
  or to everyone.
- **Never guess a Claude Code default the report did not print.** Every default
  it shows was read out of the shipping CLI binary. A key with no default beside
  it is one nobody has verified, and it stays that way in your reply too.
- **Never imply the applied settings are editable.** They are re-applied on
  every policy check, including one that finds nothing changed.
- **Never name an `opik-cipx` command the output did not print.** The list
  under `Commands` is generated from the commands that actually exist in the
  binary that just ran. One you added from memory is one this developer's
  binary may not have, and they will find that out by typing it.
- **Never run an `opik-cipx policy` write on your own initiative.** `apply`,
  `set` and `unset` change policy for the whole organization. Reading the
  Recommendations section is not a mandate to act on it: name the command, say
  what it does to everyone, and wait for the user to say yes. An org-wide
  change nobody asked for is the one mistake in this report that other people
  find out about.
- **Never present `opik-cipx mcp enable` as free.** The report prints its
  consequences on the same line — it asks the organization, it does nothing
  until the next session, and it exits 3 when an admin has locked the policy.
  Those travel with it or it does not get named.

## When the command is not there

Both commands run whatever `opik-cipx` resolves to on PATH, and a machine with
a working, capturing cipx can still have nothing under that name. A plugin
install normally does provide it: the plugin ships a `bin/opik-cipx` dispatcher
and Claude Code puts every plugin's `bin/` on PATH, so `opik-cipx` resolves to
the build for this platform. A curl install does not — the installer only
prints a suggestion to add `~/.opik-cipx/bin`. Two messages mean the command is
missing, and not that cipx is broken or absent:

- **`command not found`, or `no installed binary found for …`** — nothing on
  PATH answers to `opik-cipx`. Say the report cannot be run here, not that
  cipx is not running; the session hook invokes the binary by absolute path
  and never needed PATH to begin with. For a curl install the fix is to put
  `~/.opik-cipx/bin` on PATH. For a plugin install it means the dispatcher is
  not there — a plugin version older than it, or no build for this
  `<os>-<arch>` in the plugin's `bin/` — and updating the plugin is the fix.
- **`unknown command "cost-intelligence"`** (or `"mcp"`) — the binary on PATH
  is older than the report. Name the version it printed if you have it, and
  say that upgrading the plugin is what adds the command.
- **`unknown flag: --markdown`** (or `--commands`) — same cause, one version
  nearer: the command exists, the flag does not. This is the one case where
  running it a second time is right. Re-run it bare, once, and show what comes
  back; it will carry escape sequences this surface cannot render, so say in
  one line that the report is from an older binary and reads plainly here.

Quote the failing message once, in one line, and stop. Do not retry it in
another form — the one exception is the rejected flag above, and that retry is
the same command with a flag removed, never a different command. Everything
else interrupts the user for permission to learn what you already know.

**When a command fails, report nothing from its section.** Everything in it
comes from the command that just refused to run — there is no cached copy to
fall back on, and the session intro's "has been optimized" is the claim under
test, never evidence for it. A report reconstructed from anywhere else is
precisely the unverifiable sentence this command exists to replace.

If only one of the two fails, run and show the other; a missing MCP table does
not spoil a cost reading, or the reverse. Say in one line which half is
missing and why, then show the half you have.
