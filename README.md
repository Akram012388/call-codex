# CALL-CODEX

**CALL-CODEX** is a macOS-first Codex plugin concept for opening real app-server-powered calls between Codex threads.

One main thread dials the mission. Worker threads answer with names, roles, context, and a clean task brief. Messages move through Codex app-server primitives, transcripts stay auditable, and the whole thing feels like Codex grew a command center.

The phrase is playful: **CALL-CODEX lands AGI** means "this feels wildly agentic when the pieces click." It is not a factual AGI claim. It is a wink, a banner, and a dare to build a smoother Codex-native multi-thread experience.

## The Idea

Codex already has the raw power: threads, turns, app-server, skills, MCP, plugins, and a gorgeous macOS app surface.

CALL-CODEX brings those primitives into one super-user workflow:

- Start a local Codex app-server on loopback.
- Create a named call from the main thread.
- Fork or start worker threads for specific jobs.
- Send direct messages, broadcasts, task updates, and status pings.
- Inject important messages into worker context.
- Keep a local SQLite audit trail for transcripts and recovery.
- Close the call when the mission is done.

No copy-paste relay. No vague "some other agent is doing something somewhere." Just calls, workers, status, and receipts.

## Planned `call_*` Tools

The public surface is intentionally playful and sharp:

- `call_boot` - wake the local app-server and check the board.
- `call_create` - open a new call with named worker threads.
- `call_send` - send a task, question, status, or review note to one worker.
- `call_broadcast` - ring everyone in the call.
- `call_inbox` - read the messages waiting for this participant.
- `call_wake` - start active worker turns on purpose.
- `call_steer` - steer an active worker turn.
- `call_interrupt` - stop one worker turn, or pull the brake on the whole call.
- `call_who` - see who is on the line.
- `call_update` - update task or call state.
- `call_status` - show progress, blockers, and recent traffic.
- `call_cancel` - interrupt active work and mark the call cancelled.
- `call_close` - close the call and keep the receipts.
- `call_transcript` - export the call history.

No `orchestration_create`. No lab-coat verbs. We are calling Codex.

## Local-First Safety

CALL-CODEX is designed to be local-first:

- The managed app-server binds only to `127.0.0.1`.
- Worker traffic is scoped to a call and project.
- SQLite lives under `~/.codex/call-codex/`.
- Messages are injected into Codex threads and persisted for audit.
- Worker threads stay open until explicitly closed or cancelled.

Remote app-server setups may come later, but v1 starts on the Mac, close to the user, with the Codex app as the first-class home.

## Build Status

This repository is in the early build phase.

The locked v1 stack is:

- TypeScript
- Bun
- Codex app-server
- Codex plugin manifest, skill, and MCP server
- SQLite via Bun's built-in runtime

The repo-local plugin scaffold now lives under `plugins/call-codex` with a Codex manifest, local marketplace entry, skill, MCP server, generated app-server protocol types, and starter tests.

`call_boot` can start a managed loopback Codex app-server, and the SQLite call board is wired for local calls, participants, messages, status, and transcripts.

`call_create` now creates real Codex app-server worker threads for `fresh` calls, or for `fork` calls when `main_thread_id` is provided. `call_send` and `call_broadcast` inject call-line messages into workers with `thread/inject_items` when a participant has a thread ID.

`call_wake`, `call_steer`, and `call_interrupt` now move workers from parked threads into active missions through `turn/start`, `turn/steer`, and `turn/interrupt`, with active turn IDs tracked on the local board.

`call_status` now reads active worker threads with `thread/read`, shows recent assistant output in `worker_progress`, reports completion/failure/interruption, and clears finished active turns from the local board.

`call_transcript` now imports worker turns with `thread/read`, caches imported worker output locally, and exports both CALL-CODEX line messages and worker assistant output under a `Worker Output` section. If a worker thread is unavailable later, cached receipts still make the transcript useful.

The next step is richer lifecycle polish: event subscriptions, cache freshness indicators, and tighter macOS app smoke testing.

## Spirit

CALL-CODEX is built in appreciation for Codex and the OpenAI team: a small, earnest, slightly overexcited love letter to the feeling of agents coordinating real work.

Dial the main thread. Name the crew. Send the brief. Let Codex answer.
