# CALL-CODEX Plugin

CALL-CODEX is the installable Codex plugin for opening app-server-powered calls between Codex threads.

It is macOS-first, local-first, and built around the `call_*` tool surface: boot the line, create worker threads, wake turns, steer progress, stream status, preserve transcripts, and cleanly remove workers when the call is done.

## What Is Included

- `.codex-plugin/plugin.json` marketplace-ready plugin metadata.
- `.mcp.json` for the Bun-powered MCP server.
- `skills/call-codex/SKILL.md` for the call-first workflow.
- `src/server.ts` exposing the `call_*` MCP tools.
- `src/app-server/generated/` generated from local Codex app-server types.
- `assets/` with CALL-CODEX icon/logo files.

## Local Checks

```bash
bun install
bun run typecheck
bun test
```

## Safety Defaults

- Managed app-server binds to `127.0.0.1`.
- `call_create` defaults to one Git worktree per worker.
- SQLite receipts live under `~/.codex/call-codex/`.
- Worker cleanup is explicit through `call_remove_thread`, `call_cancel`, or `call_close`.

Dial carefully. Build boldly.
