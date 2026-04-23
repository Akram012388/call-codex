# CALL-CODEX Plugin Scaffold

This folder contains the installable Codex plugin scaffold.

Current slice:

- `.codex-plugin/plugin.json` is filled with v1 metadata.
- `.mcp.json` points Codex at the Bun-powered MCP server.
- `skills/call-codex/SKILL.md` teaches Codex the call-first workflow.
- `src/server.ts` exposes the planned `call_*` MCP tools.
- `src/app-server/generated/` is generated from the local Codex app-server protocol.

Run from this directory:

```bash
bun install
bun run typecheck
bun test
```

The tool implementations are intentionally scaffold responses. The next build slice wires `call_boot` to a managed loopback app-server and adds the SQLite call board.
