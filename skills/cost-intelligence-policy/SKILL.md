---
name: cost-intelligence-policy
description: Cost Intelligence policy — inspect and change which MCP servers your organization's cost policy denies for you, and, for an organization admin, change the org's cost policy itself. Use when the user asks why an MCP server or its tools are missing, asks to turn one off or back on for themselves, asks to undo their own override or follow the org again, or asks what their organization has blocked — e.g. "why is Notion gone", "turn the notion MCP back on", "disable slack for me", "undo what I did to slack", "reset my MCP overrides", "what's blocked?", "what else did it block?" — and when an admin asks to change it for everyone: "make Sonnet the default for the team", "apply that recommendation", "compact earlier org-wide", "stop pushing the default model".
allowed-tools: Bash(opik-cipx mcp:*), Bash(opik-cipx policy recommendations)
---

# Cost Intelligence policy

An organization can deny MCP servers through Opik Cost Intelligence. Claude Code
removes a denied server silently — it disappears from `/mcp` and
`claude mcp list` with no warning — so this skill is usually how the user finds
out what happened.

## Commands

```
opik-cipx mcp list              # status table of every MCP server
opik-cipx mcp disable <server>  # deny a server for this user
opik-cipx mcp enable <server>   # stop denying one for this user
opik-cipx mcp reset <server>    # drop this user's own choice, so the org's applies
opik-cipx mcp reset --all       # drop every one of them at once
```

Pass the server name as the user said it. The command does its own matching
against the MCP servers configured on this machine, and handles exact names,
the `mcp__notion__search` tool-id form, and partial names. **Do not guess a
name, correct one, or pick between candidates yourself** — the command reports
an ambiguity so a human can resolve it, and overriding that is how a user gets
told the wrong server was changed.

`reset` is the exception to the matching rule above: a name it cannot match is
sent as typed rather than refused, because the choice being dropped can be for
a server the user no longer has configured. So exit 4 never comes back from
`reset` — a genuine typo comes back as exit 7, "nothing to reset".

## `disable` is not the undo for `enable`

`enable` and `disable` both store **the user's own** choice about a server, on
their account. That is why neither undoes the other: `disable` after `enable`
stores "I deny this too", which is a second opinion that keeps diverging from
the organization every time the organization changes its mind. The user's
choice also re-applies on its own — an `enable` survives a lock and comes back
the moment the admin unlocks again.

`reset` removes the user's choice, so the organization's answer applies to them
again. It is the only way to hand a server back.

Suggest it when the user says any of:

- "put it back the way the org has it", "stop overriding it", "follow the org"
- "why did that server come back after the admin locked it?" — because their
  own `enable` is still on their account, and only `reset` clears it
- "undo what I did to slack" — `mcp reset slack`, never `mcp disable slack`
- "reset all my MCP overrides" — `mcp reset --all`

Do not reach for it when they want a server **off**: that is `disable`. Reset
is not "turn it off", it is "I have no opinion". If the organization does not
deny that server, resetting leaves it on.

## Show the output, do not retell it

**Every one of these commands prints a finished, branded answer. Paste it into
your reply verbatim and stop.**

`mcp list` in particular is a table — one row per server, aligned columns,
saying what is blocked, what is active, and whether the user can change it.
Turning that into sentences is a downgrade in every direction: it is longer,
it loses the alignment that made it scannable, it re-sorts rows the user was
about to read, and it forces them to trust your transcription of something
they could have read themselves. Never do it. Do not summarise the table, do
not list its rows as prose, do not lead with a count.

Show it every time it is asked for, including when you showed the same table a
message ago and nothing has changed. "It is unchanged" is your judgement about
what the user needs rather than an answer to what they asked, and it leaves
them reading your memory instead of their policy.

After the output you may add **at most one line**, and only for something the
table cannot say — a server that failed to connect for reasons unrelated to
policy, say. That line is an addition to the output, never a replacement for
it. If nothing like that is true, add nothing.

## What the user already saw

A policy change prints a short notice when their session starts. It names **no
server** — only that policy changed, and where to look. So the user genuinely
does not know which servers moved, and asking them which one they mean will not
work.

Your context does carry the full change, but a change is a **diff**: it says
what just moved, not what is blocked. A server denied a month ago appears in
neither.

So `opik-cipx mcp list` is the answer to both "what changed?" and "what's
blocked?" — it prints the most recent change and the current policy together.
Run it rather than answering from the diff in your context alone.

## Reading the outcome

**The exit code is the result. The text is for the user.** Never describe an
outcome the exit code does not support.

| Exit | Meaning | What to tell the user |
|---|---|---|
| 0 | Changed | It worked, **and it applies from their next session** — pass on the restart command the output prints, verbatim (see Timing) |
| 1 | The command line was wrong | Nothing was sent; `reset` refuses `--all` beside a server name, and refuses neither |
| 3 | Locked by their admin | It did **not** change, and they cannot change it here. A lock blocks `reset` too — reverting is not a way around one |
| 4 | No such server configured | It did **not** change; likely a typo, offer `opik-cipx mcp list`. `reset` never returns this |
| 5 | Several servers match | It did **not** change; show the candidates and ask which |
| 6 | Not enabled for this org | It did **not** change; they can change it in the Opik dashboard |
| 7 | Already in that state | Nothing changed, and nothing needed to. From `reset`: they held no choice of their own about that server, so the org's policy was already what applied |
| 8 | Could not read an MCP config | It did **not** change; the name cannot be matched safely |
| 9 | Backend refused or unreachable | It did **not** change |

Any non-zero exit means **nothing changed**. Say so plainly. Do not soften a
refusal into "done" or "that should be sorted now" — the user will act on it,
find the server still missing, and trust nothing this skill says afterwards.

The command prints the reason to stderr. Quote it rather than inventing
wording.

## Do not restate the mechanics

Underneath the output, every run is also true of every other run: that a denied
server was never launched, that the override is per-user, that an admin could
re-push the policy, that a change waits for the next session. A user who reads
that once has read it forever. Volunteering it each time turns a one-line
confirmation into a lecture and buries the detail that was specific to this run.

If they ask why, explain then — and reach for `opik-cipx mcp list` rather than
answering from memory.

## Timing

A change made with `disable`/`enable`/`reset` **never** takes effect in the
running session. A denied server's process was never started, so nothing can
bring it back mid-conversation. Always tell the user how to restart, and never
imply the tools are available now.

### Relay the restart command verbatim

The output ends with a command on a line of its own — `claude --resume <id>`,
or `claude --continue` when it could not tell which session this is. **Copy
that line into your reply exactly as printed.** Do not paraphrase it as
"restart Claude Code", do not shorten it, and do not substitute a command of
your own: the id is this session's, resolved from the working directory, and it
is the only thing that brings the user back to the conversation they are having
with you. "Restart Claude Code" reads as "start over", and a user who acts on
it loses this session.

`--continue` is the weaker form, and when it is what was printed, say the
directory part too: it takes the most recent conversation in the directory it
is run from, so it only means this session when it is run here.

What the user does with it: `/exit` ends the session (Ctrl+C twice does the
same), then the command reopens it with its history intact — it is not a new
conversation, and nothing said so far is lost. Say that if they hesitate; it is
the reason the command is worth typing rather than just relaunching `claude`.

The notice at the top of a session is the other side of this: that change had
already taken effect before the session started. Its servers are off (or back)
right now, so do not tell the user to restart for it.

## Scope

This changes the policy for **this user only**, and only if their admin left
the setting unlocked. It cannot change anyone else's, and it cannot override a
lock. If the user wants a locked setting changed, they need their admin — or
they may be one themselves, which is the section below.

## If the user is an admin

`opik-cipx policy` changes the policy for the **whole organization**. It is a
different command group from `mcp` for a reason: `mcp` stores one developer's
exception, and every verb here lands on everybody.

```
opik-cipx policy recommendations         # what the org could still do, and what it would save
opik-cipx policy apply <recommendation>  # apply one, org-wide
opik-cipx policy set <name> <value> [--lock|--unlock]
opik-cipx policy unset <name>
```

**How to know whether they are an admin: run the report and look.** If
`opik-cipx cost-intelligence` prints a `Recommendations` section, the backend
served this developer the admin list and they are one. If it does not, they are
not — the section is absent for a member, silently and by design. There is no
other test, and **never** assert or assume it: the client cannot tell, only the
backend can, and `opik-cipx policy recommendations` refusing with exit 3 is the
same answer arriving the expensive way.

For a **non-admin**, nothing changes about this skill: their route to an org
setting is their admin, or the Opik page the report names. Do not offer them a
`policy` command; it would exit 3 and read as a broken tool.

### Never run a `policy` write on your own initiative

`apply`, `set` and `unset` are org-wide writes. They are deliberately **not** in
this skill's allowed tools, so each one goes through the user's own permission
prompt — that prompt is the consent, and it is not something to work around.

Before running one, say all three of these in your own words and **wait for an
explicit yes**:

1. **It applies to everyone in the organization**, not just to them.
2. **It is enforced on every policy check** — a developer editing their own
   `settings.json` gets it re-applied, and there is no per-developer opt-out for
   a setting (unlike an MCP denial, which `mcp enable` can except).
3. **The risk tag, if the row carries one.** `quality trade-off` on a
   recommendation means applying it can change the answers Claude gives. If the
   row has it, say so before asking; do not soften it.

"Apply the model one" is a request to *prepare* the command, not permission to
run it. A user who has not been told points 1–3 has not agreed to them.

### Reading the outcome

Same exit codes as the `mcp` commands, same rule: **the exit code is the
result**, and any non-zero means nothing changed. Two of them mean something
different here:

| Exit | Meaning | What to tell the user |
|---|---|---|
| 3 | Refused | Two sentences, and they are not the same news. "needs the plugin to authenticate you" means the terminal write path is not open on this deployment yet — the change can still be made on the Opik Cost savings page. "does not list you as an admin" means this developer is not an admin; their admin can do it |
| 4 | Unknown recommendation, or the backend refused the change | Quote the message. For a name, offer `opik-cipx policy recommendations`. For a setting the backend rejected, the message is the backend's own validator — never substitute a list of your own |
| 5 | Several match | Show the candidates and ask which; never pick |
| 7 | Already in effect | Nothing changed and nothing needed to |

After a successful write, the confirmation says when it lands. Every developer
also learns about it from their own session-start notice, the admin included —
so do not suppress or duplicate that; it is how they see it took.
