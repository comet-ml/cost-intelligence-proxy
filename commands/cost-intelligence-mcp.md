---
description: Show which MCP servers your organization's cost policy blocks, and whether you can change it
allowed-tools: Bash(opik-cipx mcp list)
---

Run `opik-cipx mcp list` and show its output.

**Always show it. Every single time, without exception** — including when you
showed the same table one message ago and nothing has changed since. The user
ran this command to look at the table; "it is the same as before" is your
judgement about what they need, not an answer to what they asked. Saying
nothing changed and omitting it is the one failure this command cannot tolerate.

Show the command's own output as it came back. Do not retype it, summarise it,
re-sort it, count it, or wrap it in a code fence — a fence strips the colour
that separates a blocked row from an active one at a glance, and retyping it
breaks the column alignment and asks the user to trust your transcription of
something they can already see.

After the table you may add **one** short sentence, and only for something the
table cannot say — a server failing to connect for reasons unrelated to policy,
say. That sentence is an addition to the table, never a replacement for it. If
there is nothing to add, add nothing; the table alone is a complete answer.

If the command fails, say so in one line and quote its message. Never describe
a policy you did not just read.
