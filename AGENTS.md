# AGENTS.md

Rules for Codex agents working in this repo:

1. Build for the Codex macOS app first.
2. Treat Codex app-server as required, not optional.
3. Keep the public tool surface named `call_*`.
4. Never introduce `orchestration_*` public names.
5. Use TypeScript and Bun for v1 implementation.
6. Use Bun's built-in SQLite before adding SQLite packages.
7. Keep app-server traffic on `127.0.0.1` in v1.
8. Do not bind managed app-server processes to non-loopback addresses.
9. Prefer generated app-server TypeScript bindings over hand-written types.
10. Generate bindings from the local `codex app-server` command.
11. Keep the plugin repo-local until install testing works.
12. Put installable plugin code under `plugins/call-codex`.
13. Keep root docs short, useful, and public-facing.
14. Keep implementation docs precise and decision-complete.
15. Write playful-pro copy, not dry enterprise copy.
16. Use "lands AGI" only as playful energy, not a factual claim.
17. The main user metaphor is a "call" between Codex threads.
18. A worker should feel like it answers the call.
19. Persist call state and messages in SQLite.
20. Inject important messages into Codex thread context.
21. Keep an audit trail for transcripts and recovery.
22. Worker threads stay open until `call_close` or `call_cancel`.
23. Default `call_create` mode is `fork`.
24. Also support fresh worker threads.
25. Prefer simple schemas and explicit migrations.
26. Avoid broad abstractions before the code needs them.
27. Avoid daemons beyond the managed local app-server process.
28. Validate tool inputs with a small schema layer.
29. Return compact JSON from MCP tools.
30. Keep tool output low-noise and model-friendly.
31. Add tests with each meaningful behavior.
32. Unit test bus, state, messages, and transcripts.
33. Smoke test the MCP server over stdio.
34. Integration test app-server connection when feasible.
35. Do not add remote control features in v1.
36. Do not add a dashboard in v1.
37. Do not add approval relay in v1.
38. Do not introduce heavy frameworks without a clear need.
39. Prefer local-first safety over impressive demos.
40. Keep README copy exciting but honest.
41. Keep PLAN.md updated when core decisions change.
42. Keep AGENTS.md tight; do not turn it into a manual.
43. Use `rg` for search.
44. Use `apply_patch` for manual edits.
45. Do not rewrite unrelated files.
46. Do not revert user changes unless explicitly asked.
47. Before publishing, verify git status is clean.
48. Before claiming success, verify the remote exists.
49. Treat this project as an OSS love letter to Codex.
50. Dial carefully, build boldly.
