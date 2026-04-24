# Release Notes

## v0.1.0

Initial public planning/build release for CALL-CODEX.

Core v1 includes:

- Managed loopback Codex app-server boot.
- `call_*` MCP tool surface.
- Worktree-first worker thread creation.
- macOS Codex app reveal via deep links.
- First-class worker contracts.
- Live worker event streaming into status/transcripts.
- SQLite call, message, transcript, and recovery receipts.
- Clean worker removal with optional worktree cleanup.
- Long-running multi-worker hardening.

## Release Checklist

1. Run `bun install`.
2. Run `bun run typecheck`.
3. Run `bun test`.
4. Smoke test `call_boot`, `call_create`, `call_status`, and `call_remove_thread` from the Codex macOS app.
5. Confirm `.codex-plugin/plugin.json` points to current assets.
6. Confirm `.agents/plugins/marketplace.json` points to `./plugins/call-codex`.
7. Tag the release after the smoke path is clean.
