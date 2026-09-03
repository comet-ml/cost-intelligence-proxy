---
name: cost-policy
description: Inspect and change which MCP servers your organization's Cost Intelligence policy denies for you. Use when the user asks why an MCP server or its tools are missing, asks to turn one off or back on for themselves, or asks what their organization has blocked — e.g. "why is Notion gone", "turn the notion MCP back on", "disable slack for me", "what's blocked?", "what else did it block?".
allowed-tools: Bash(opik-cipx mcp:*)
---

# Cost policy

An organization can deny MCP servers through Opik Cost Intelligence. Claude Code
removes a denied server silently — it disappears from `/mcp` and
`claude mcp list` with no warning — so this skill is usually how the user finds
out what happened.

## Commands

```
opik-cipx mcp list              # status table of every MCP server
opik-cipx mcp disable <server>  # deny a server for this user
opik-cipx mcp enable <server>   # stop denying one for this user
```

Pass the server name as the user said it. The command does its own matching
against the MCP servers configured on this machine, and handles exact names,
the `mcp__notion__search` tool-id form, and partial names. **Do not guess a
name, correct one, or pick between candidates yourself** — the command reports
an ambiguity so a human can resolve it, and overriding that is how a user gets
told the wrong server was changed.

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
| 0 | Changed | It worked, **and it applies from their next session** — they must restart Claude Code |
| 3 | Locked by their admin | It did **not** change, and they cannot change it here |
| 4 | No such server configured | It did **not** change; likely a typo, offer `opik-cipx mcp list` |
| 5 | Several servers match | It did **not** change; show the candidates and ask which |
| 6 | Not enabled for this org | It did **not** change; they can change it in the Opik dashboard |
| 7 | Already in that state | Nothing changed, and nothing needed to |
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

A change made with `disable`/`enable` **never** takes effect in the running
session. A denied server's process was never started, so nothing can bring it
back mid-conversation. Always tell the user to restart Claude Code, and never
imply the tools are available now.

The notice at the top of a session is the other side of this: that change had
already taken effect before the session started. Its servers are off (or back)
right now, so do not tell the user to restart for it.

## Scope

This changes the policy for **this user only**, and only if their admin left
the setting unlocked. It cannot change anyone else's, and it cannot override a
lock. If the user wants a locked setting changed, they need their admin.
