---
description: Launch the local cipx debug viewer (HTTP UI on 127.0.0.1)
allowed-tools:
  - Bash
---

You are running the `/opik:viewer` command. Launch `cipx viewer` in the
background and report the URL.

Steps:

1. Find cipx — `cipx` on PATH first, then `~/.cipx/bin/cipx`. If neither
   exists, tell the user to run `/opik:install` first.

2. Start it in the background:

   ```bash
   nohup cipx viewer > ~/.cipx/logs/viewer.stdout 2>&1 &
   ```

   The viewer writes its bound port to stdout. Read it from
   `~/.cipx/logs/viewer.stdout` (give it a beat to come up) and surface the
   URL — it'll look like `http://127.0.0.1:<port>/`.

3. Tell the user:
   - The viewer is local-only (binds 127.0.0.1) and serves the embedded UI.
   - The capture list shows every request the proxy has seen. Each capture
     has a "where did each byte go" highlight view — categorized regions are
     colored, red regions are unattributed (categorizer gap).
   - To stop it: `pkill -f 'cipx viewer'` (or just close the session — the
     viewer dies with the shell that spawned it).

If `~/.cipx/logs/viewer.stdout` doesn't appear within a few seconds, the
launch failed — tail the file and report what went wrong (most likely cause:
the proxy isn't running, so there are no captures to show).
