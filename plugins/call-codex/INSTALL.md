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

## Troubleshooting

- If Bun dependencies are missing, run `bun install` inside `plugins/call-codex`.
- If worker creation fails, confirm the `cwd` is inside a Git repo with at least one commit.
- If the Codex app sidebar looks stale after cleanup, run `call_remove_thread` first, then reopen the workspace in the Codex app.
- If app-server startup fails, run `call_boot` again with `force_restart: true`.
