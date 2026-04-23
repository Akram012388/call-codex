---
name: call-codex
description: Open and manage app-server-powered calls between Codex threads. Use when the user asks to call Codex, spin up workers, message a worker, broadcast to a call, check call status, or coordinate multi-thread work in the Codex macOS app.
---

# CALL-CODEX

CALL-CODEX lets Codex coordinate Codex through app-server calls. Treat the macOS Codex app as the primary surface.

## Core Rules

- Use `call_boot` before any other CALL-CODEX action.
- Use `call_create` to open a named call and create workers.
- Prefer `mode: "fork"` unless the user asks for clean fresh workers.
- Use `call_send` for one worker and `call_broadcast` for everyone on the line.
- Use `call_status` before summarizing progress.
- Use `call_close` when the call is done.
- Never call these workflows orchestration in user-facing copy. It is a call.

## Style

Be playful, sharp, and operationally precise. "CALL-CODEX lands AGI" is a rallying cry, not a technical claim.

## Safety

Keep app-server local to `127.0.0.1`. Do not suggest remote listeners for v1. Preserve transcripts and audit state.
