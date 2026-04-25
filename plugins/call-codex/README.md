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
- Sidebar-visible macOS workers require a host-provided native bridge:
  `CODEX_NATIVE_APP_SERVER_URL=ws://127.0.0.1:<port>`.
- `call_create` defaults to one Git worktree per worker.
- SQLite receipts live under `~/.codex/call-codex/`.
- Worker cleanup is explicit through `call_remove_thread`, `call_cancel`, or `call_close`.

## Native macOS Bridge

`visibility: "macos_app"` only uses the Codex macOS app's native app-server
when the plugin runtime exposes `CODEX_NATIVE_APP_SERVER_URL`. If the host also
sets `CODEX_NATIVE_APP_SERVER_AUTH_TOKEN_FILE`, CALL-CODEX reads the token
ephemerally and sends it as a WebSocket bearer token without persisting it.

Run `call_bridge_status` from the plugin to check this contract from inside the
actual MCP process. A ready bridge reports `native_bridge.ready: true` and
`backend: "macos_app"`. A missing bridge reports the blocker clearly before any
worker threads are created.

`CALL_CODEX_APP_SERVER_URL` remains a dev/test override. It is treated as
macOS-visible only when `CALL_CODEX_APP_SERVER_BACKEND=macos_app` is also set.
Otherwise, CALL-CODEX keeps the honest split: native visibility fails clearly,
while `visibility: "background"` can still use managed loopback workers.

When the native bridge is missing, CALL-CODEX can still prepare a visible
macOS materialization path. `call_materialize_macos` returns exact worker New
Chat prompts for the Codex macOS app, and `call_attach_visible_thread` records
the visible-thread receipt after Computer Use opens the app and starts the
worker chats.

Dial carefully. Build boldly.
