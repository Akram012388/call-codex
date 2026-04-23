---
name: call-codex
description: Open and manage app-server-powered calls between Codex threads. Use when the user asks to call Codex, spin up workers, message a worker, broadcast to a call, check call status, or coordinate multi-thread work in the Codex macOS app.
---

# CALL-CODEX

CALL-CODEX lets Codex coordinate Codex through app-server calls. Treat the macOS Codex app as the primary surface.

## Core Rules

- Use `call_boot` before any other CALL-CODEX action.
- Use `call_create` to open a named call and create workers.
- Prefer `mode: "fork"` when the current main thread ID is available; use `mode: "fresh"` for clean workers or when no main thread ID is available.
- Use `call_send` for one worker and `call_broadcast` for everyone on the line.
- Use `call_wake` to start active work; use `call_steer` only after a worker has an active turn.
- Use `call_interrupt` for the worker brake, then inspect `call_status`.
- Use `call_status` before summarizing progress; trust its `worker_progress` block for recent worker output and auto-cleared turns.
- Use `call_transcript` for final receipts; it imports and caches worker assistant output when thread reads are available.
- Use `call_close` when the call is done.
- Never call these workflows orchestration in user-facing copy. It is a call.

## Style

Be playful, sharp, and operationally precise. "CALL-CODEX lands AGI" is a rallying cry, not a technical claim.

## Safety

Keep app-server local to `127.0.0.1`. Do not suggest remote listeners for v1. Preserve transcripts and audit state.
