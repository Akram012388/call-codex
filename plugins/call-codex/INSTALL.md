# Install CALL-CODEX

CALL-CODEX is currently a repo-local Codex plugin.

## Requirements

- macOS with the Codex desktop app.
- Bun installed and available on `PATH`.
- Codex CLI with `codex app-server` support.
- Git for worktree-isolated worker calls.

## Local Install

From this plugin folder:

```bash
bun install
bun run typecheck
bun test
```

The repo marketplace entry is:

```text
.agents/plugins/marketplace.json
```

The plugin entry points at:

```text
./plugins/call-codex
```

## Smoke Test

Use Codex to call the MCP tool surface:

```text
call_boot
call_create with mode "worktree"
call_status
call_transcript
```

For the first real run, use one or two workers and keep `reveal: true` so the Codex macOS app opens the created worker threads.

Visible macOS worker threads require the Codex host runtime to expose:

```text
CODEX_NATIVE_APP_SERVER_URL=ws://127.0.0.1:<port>
```

If the host provides `CODEX_NATIVE_APP_SERVER_AUTH_TOKEN_FILE`, the plugin uses
that token for the WebSocket handshake without storing it. Until the host bridge
exists, use `visibility: "background"` for functional background workers, or
expect `visibility: "macos_app"` to fail clearly.

Before a visible-worker smoke test, run `call_bridge_status`. Continue only when
it reports `native_bridge.ready: true`; otherwise the Codex host runtime has not
yet exposed the native app-server URL to the plugin.

## Troubleshooting

- If Bun dependencies are missing, run `bun install` inside `plugins/call-codex`.
- If worker creation fails, confirm the `cwd` is inside a Git repo with at least one commit.
- If visible macOS workers fail, run `call_bridge_status` and confirm `CODEX_NATIVE_APP_SERVER_URL` is present in the plugin runtime.
- If the Codex app sidebar looks stale after cleanup, run `call_remove_thread` first, then reopen the workspace in the Codex app.
- If app-server startup fails, run `call_boot` again with `force_restart: true`.
