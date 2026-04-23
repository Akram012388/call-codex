# CALL-CODEX Detailed Plan

## Thesis

CALL-CODEX should be Codex coordinating Codex through Codex-native primitives, not a separate agent framework stapled to the side.

The plugin will make the Codex macOS app feel like a mission console: a main thread opens a call, creates or forks worker threads through app-server, sends targeted messages, receives status updates, and closes with a transcript. The public vocabulary stays playful and direct: every major user-facing command starts with `call_*`.

The goal is a striking autonomous-feeling workflow while staying honest about the machinery:

- Codex app-server owns thread creation, forking, turns, steering, and injection.
- MCP exposes a clean tool surface to Codex.
- Skills teach Codex when and how to use the tools.
- SQLite keeps the local audit trail.
- The macOS Codex app is the first-class user surface.

## Locked Decisions

- Product shape: Codex plugin.
- First surface: Codex macOS app.
- Runtime: TypeScript + Bun.
- App-server: required, managed locally.
- App-server binding: auto-selected `127.0.0.1` port only.
- Messaging: inject into Codex thread history and persist to SQLite.
- Thread lifecycle: workers stay open until `call_close` or `call_cancel`.
- Worker creation: `call_create` supports `fork` and `fresh`; default is `fork`.
- Plugin scope: repo-local first, under this project.
- Public naming: `call_*`, never `orchestration_*`.
- Copy style: playful-pro, high-energy, precise, and not falsely claiming AGI.

## Repository Layout

Planned source layout:

```text
.
├── AGENTS.md
├── PLAN.md
├── README.md
├── .agents/
│   └── plugins/
│       └── marketplace.json
├── plugins/
│   └── call-codex/
│       ├── .codex-plugin/
│       │   └── plugin.json
│       ├── .mcp.json
│       ├── assets/
│       ├── skills/
│       │   └── call-codex/
│       │       └── SKILL.md
│       ├── src/
│       │   ├── app-server/
│       │   ├── bus/
│       │   ├── tools/
│       │   └── server.ts
│       ├── tests/
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
```

The root docs explain the project. The plugin folder contains the installable Codex plugin.

## Architecture

CALL-CODEX has four cooperating layers:

1. **Skill layer**
   - Tells Codex when to use CALL-CODEX.
   - Guides the model to call `call_boot` before call operations.
   - Keeps language playful but operationally crisp.
   - Teaches worker threads how to answer messages and update state.

2. **MCP layer**
   - Exposes the `call_*` tools.
   - Validates inputs with `zod`.
   - Connects tool calls to app-server and SQLite.
   - Returns compact JSON that Codex can use without reading noisy logs.

3. **App-server layer**
   - Starts a local `codex app-server --listen ws://127.0.0.1:<port>` when needed.
   - Connects over WebSocket.
   - Uses generated TypeScript protocol types from `codex app-server generate-ts --experimental`.
   - Calls thread APIs such as `thread/start`, `thread/fork`, `turn/start`, `turn/steer`, `thread/inject_items`, `thread/read`, and `thread/list`.

4. **Bus and audit layer**
   - Uses SQLite under `~/.codex/call-codex/bus.db`.
   - Tracks calls, participants, messages, task updates, app-server thread ids, and transcripts.
   - Provides recovery if Codex restarts or a worker goes quiet.

## App-Server Lifecycle

`call_boot` is the app-server gate.

Expected behavior:

- Check whether a managed app-server process is already recorded and reachable.
- If not reachable, choose a free loopback port.
- Launch `codex app-server --listen ws://127.0.0.1:<port>`.
- Wait for WebSocket readiness.
- Store process metadata in SQLite.
- Return health: server URL, pid, startup time, Codex version, and available app-server capabilities.

Safety rules:

- Never bind to `0.0.0.0` in v1.
- Never start a remote listener.
- Never require a token for the managed loopback default.
- If a user later wants remote mode, make it an explicit separate feature.

## Public Tool Contract

### `call_boot`

Starts or reconnects to the local managed app-server and initializes SQLite.

Inputs:

- `cwd` optional, defaults to current workspace.
- `force_restart` optional boolean.

Returns:

- app-server URL
- process status
- database path
- plugin health summary

### `call_create`

Creates a call and one or more worker threads.

Inputs:

- `title`
- `project`
- `mode`: `fork` or `fresh`, default `fork`
- `workers`: array of `{ name, role, brief }`
- `main_thread_id` optional
- `cwd` optional

Behavior:

- Ensure `call_boot`.
- Create a call row.
- For `fork`, fork from the main thread when available.
- For `fresh`, start new threads with base instructions and worker brief.
- Start the first worker turn with the role and task.
- Register each worker as a participant.

### `call_send`

Sends a targeted message to one worker.

Inputs:

- `call_id`
- `to`
- `content`
- `message_type`: `task`, `question`, `status`, `review`, or `note`
- `priority`: `low`, `normal`, `high`, or `urgent`

Behavior:

- Persist message.
- Inject into target thread history.
- If the target has an active turn, steer when appropriate.

### `call_broadcast`

Sends a message to all active participants in a call.

Inputs:

- `call_id`
- `content`
- `message_type`
- `priority`

Behavior:

- Persist one logical broadcast.
- Inject per participant.
- Skip closed/cancelled participants.

### `call_inbox`

Reads pending or recent messages for the current participant.

Inputs:

- `participant`
- `call_id` optional
- `limit` optional

Returns:

- recent messages
- unread count
- suggested next actions

### `call_who`

Lists calls and participants.

Inputs:

- `call_id` optional
- `project` optional

Returns:

- participant names, roles, app-server thread ids, status, heartbeat age, and current task.

### `call_update`

Updates task, participant, or call state.

Inputs:

- `call_id`
- `participant` optional
- `status`: `queued`, `running`, `blocked`, `done`, `failed`, `cancelled`
- `summary` optional
- `blocker` optional

### `call_status`

Shows the full state of a call.

Inputs:

- `call_id`
- `include_recent_messages` optional boolean

Returns:

- call summary
- worker states
- recent messages
- blockers
- transcript pointer

### `call_cancel`

Cancels an active call.

Behavior:

- Interrupt in-flight worker turns through app-server when possible.
- Mark call and participants cancelled.
- Preserve transcript.

### `call_close`

Closes a call cleanly.

Behavior:

- Mark call closed.
- Leave worker threads available in Codex history.
- Stop sending messages to closed participants.
- Preserve full audit trail.

### `call_transcript`

Exports a readable call transcript.

Inputs:

- `call_id`
- `format`: `markdown` initially

Returns:

- transcript path or markdown content, depending on size.

## SQLite Schema Outline

Tables:

- `runtime`
  - app-server URL, pid, started_at, last_seen
- `calls`
  - id, title, project, status, mode, created_at, closed_at, summary
- `participants`
  - id, call_id, name, role, thread_id, cwd, status, last_seen, current_task
- `messages`
  - id, call_id, from_name, to_name, content, message_type, priority, injected_at, created_at
- `tasks`
  - id, call_id, participant_id, title, status, summary, blocker, created_at, updated_at
- `events`
  - id, call_id, event_type, payload_json, created_at

Use WAL mode and small, explicit migrations. Avoid clever abstractions until the schema has real pressure.

## macOS App-First Workflow

The happy path:

1. User opens Codex macOS app in the project.
2. User asks: "Call Codex and spin up backend, tests, and reviewer."
3. Skill triggers `call_boot`.
4. MCP starts local app-server if needed.
5. `call_create` forks or starts worker threads.
6. Worker threads receive injected briefs.
7. Main thread uses `call_status`, `call_send`, and `call_broadcast` to steer.
8. Workers use `call_update` to report progress.
9. Main thread runs `call_close` and optionally `call_transcript`.

The UX should feel like a high-signal control room, not a chatbot pretending to multitask.

## Dependencies

Runtime:

- `@modelcontextprotocol/sdk`
- `zod`

Runtime through Bun:

- SQLite via `bun:sqlite`
- WebSocket via Bun runtime APIs

Dev:

- `@types/bun`
- `typescript`
- `prettier`

Generated:

- app-server TypeScript bindings generated from the local Codex CLI with:

```bash
codex app-server generate-ts --experimental --out plugins/call-codex/src/app-server/generated
```

## Testing Plan

Unit tests:

- schema migration
- app-server process registry
- call creation
- participant registration
- message persistence
- status transitions
- transcript formatting

MCP smoke tests:

- server starts over stdio
- `call_boot` returns health
- `call_create` creates a call
- `call_send` records and injects
- `call_status` reports accurate state
- `call_close` closes cleanly

Integration tests:

- launch loopback app-server
- connect WebSocket client
- start or fork a thread
- start a turn
- inject a message
- read thread state

Manual macOS app checks:

- plugin appears in repo-local marketplace
- skill is discoverable
- `call_*` tools are available
- app-server traffic is local
- copy feels playful and not bloated

## Milestones

### Milestone 1: Docs And Repo

- Create root `README.md`, `PLAN.md`, and `AGENTS.md`.
- Initialize Git.
- Publish public GitHub repo.

### Milestone 2: Plugin Skeleton

- Scaffold plugin with manifest, skill, MCP config, and marketplace entry.
- Add package scripts and TypeScript config.
- Generate app-server protocol types.

Status: scaffolded. The current MCP server exposes scaffold responses for the full planned `call_*` surface while app-server and SQLite behavior are implemented in the next slices.

### Milestone 3: Local Call Core

- Implement SQLite schema.
- Implement `call_boot`, `call_create`, `call_who`, and `call_status`.
- Add tests and MCP smoke test.

### Milestone 4: Messaging

- Implement `call_send`, `call_broadcast`, and `call_inbox`.
- Add app-server injection.
- Add audit trail and transcript basics.

### Milestone 5: Control And Polish

- Implement `call_update`, `call_cancel`, `call_close`, and `call_transcript`.
- Tighten skill behavior.
- Test through Codex macOS app.

### Milestone 6: Public-Ready Plugin

- Add logo/icon assets.
- Polish install docs.
- Add release notes.
- Prepare marketplace-ready metadata.

## Non-Goals For V1

- Remote non-loopback app-server control.
- Cloud-hosted coordination.
- Full GUI dashboard.
- Permission relay.
- Approval delegation.
- Replacing Codex native multi-agent tools.
- Claiming literal AGI.

## Copy Principles

- Say "call" instead of "orchestrate."
- Keep the energy high but the instructions precise.
- Treat Codex as the star.
- Make super-user workflows feel approachable.
- Avoid bloated enterprise-speak.
- Use "lands AGI" as a playful slogan, never a technical claim.
