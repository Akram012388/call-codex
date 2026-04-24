import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import {
  getDb,
  resetDbForTests,
  setParticipantThreadId,
  upsertRuntime,
} from "../src/bus";
import { resetLiveStateForTests } from "../src/live";
import { handleToolCall, toolDefinitions } from "../src/tools";

function fakeControlAppServer() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const sockets = new Set<{ send: (message: string) => void }>();
  const broadcast = (message: unknown) => {
    for (const socket of sockets) {
      socket.send(JSON.stringify(message));
    }
  };
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response("CALL-CODEX fake control app-server");
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
      },
      close(ws) {
        sockets.delete(ws);
      },
      message(ws, message) {
        const request = JSON.parse(String(message)) as {
          id: number;
          method: string;
          params: unknown;
        };
        calls.push({ method: request.method, params: request.params });

        if (request.method === "initialize") {
          ws.send(
            JSON.stringify({
              id: request.id,
              result: {
                userAgent: "fake-codex",
                codexHome: "/tmp/call-codex",
                platformFamily: "unix",
                platformOs: "macos",
              },
            }),
          );
          return;
        }

        if (request.method === "thread/start") {
          ws.send(
            JSON.stringify({
              id: request.id,
              result: {
                thread: {
                  id: "thread-control",
                  status: { type: "idle" },
                  ephemeral: false,
                  turns: [],
                },
                model: "gpt-test",
                modelProvider: "openai",
                serviceTier: null,
                cwd:
                  typeof request.params === "object" &&
                  request.params &&
                  "cwd" in request.params
                    ? request.params.cwd
                    : "/tmp/call-codex",
                instructionSources: [],
                approvalPolicy: "on-request",
                approvalsReviewer: "user",
                sandbox: { type: "readOnly" },
                permissionProfile: null,
                reasoningEffort: null,
              },
            }),
          );
          return;
        }

        if (request.method === "turn/start") {
          ws.send(
            JSON.stringify({
              id: request.id,
              result: {
                turn: {
                  id: "turn-control",
                  items: [],
                  status: "inProgress",
                  error: null,
                  startedAt: 1,
                  completedAt: null,
                  durationMs: null,
                },
              },
            }),
          );
          queueMicrotask(() => {
            broadcast({
              method: "item/agentMessage/delta",
              params: {
                threadId: "thread-control",
                turnId: "turn-control",
                itemId: "agent-control",
                delta: "Mission complete. The line is clear.",
              },
            });
            broadcast({
              method: "turn/completed",
              params: {
                threadId: "thread-control",
                turn: {
                  id: "turn-control",
                  items: [
                    {
                      type: "agentMessage",
                      id: "agent-control",
                      text: "Mission complete. The line is clear.",
                      phase: "final_answer",
                      memoryCitation: null,
                    },
                  ],
                  status: "completed",
                  error: null,
                  startedAt: 1,
                  completedAt: 2,
                  durationMs: 1000,
                },
              },
            });
          });
          return;
        }

        if (request.method === "turn/steer") {
          ws.send(
            JSON.stringify({
              id: request.id,
              result: { turnId: "turn-control" },
            }),
          );
          return;
        }

        if (request.method === "turn/interrupt") {
          ws.send(JSON.stringify({ id: request.id, result: {} }));
          return;
        }

        if (request.method === "thread/inject_items") {
          ws.send(JSON.stringify({ id: request.id, result: {} }));
          return;
        }

        if (request.method === "thread/name/set") {
          ws.send(JSON.stringify({ id: request.id, result: {} }));
          return;
        }

        if (request.method === "thread/archive") {
          ws.send(JSON.stringify({ id: request.id, result: {} }));
          return;
        }

        if (request.method === "thread/read") {
          ws.send(
            JSON.stringify({
              id: request.id,
              result: {
                thread: {
                  id: "thread-control",
                  turns: [
                    {
                      id: "turn-control",
                      items: [
                        {
                          type: "agentMessage",
                          id: "agent-control",
                          text: "Mission complete. The line is clear.",
                          phase: "final_answer",
                          memoryCitation: null,
                        },
                      ],
                      status: "completed",
                      error: null,
                      startedAt: 1,
                      completedAt: 2,
                      durationMs: 1000,
                    },
                  ],
                },
              },
            }),
          );
        }
      },
    },
  });

  return { server, calls };
}

function fakeFailingReadAppServer() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response("CALL-CODEX fake failing read app-server");
    },
    websocket: {
      message(ws, message) {
        const request = JSON.parse(String(message)) as {
          id: number;
          method: string;
          params: unknown;
        };
        calls.push({ method: request.method, params: request.params });

        if (request.method === "initialize") {
          ws.send(
            JSON.stringify({
              id: request.id,
              result: {
                userAgent: "fake-codex",
                codexHome: "/tmp/call-codex",
                platformFamily: "unix",
                platformOs: "macos",
              },
            }),
          );
          return;
        }

        if (request.method === "thread/read") {
          ws.send(
            JSON.stringify({
              id: request.id,
              error: {
                code: -32000,
                message: "thread unavailable",
              },
            }),
          );
        }
      },
    },
  });

  return { server, calls };
}

function fakeFailingStartAppServer() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response("CALL-CODEX fake failing start app-server");
    },
    websocket: {
      message(ws, message) {
        const request = JSON.parse(String(message)) as {
          id: number;
          method: string;
          params: unknown;
        };
        calls.push({ method: request.method, params: request.params });

        if (request.method === "initialize") {
          ws.send(
            JSON.stringify({
              id: request.id,
              result: {
                userAgent: "fake-codex",
                codexHome: "/tmp/call-codex",
                platformFamily: "unix",
                platformOs: "macos",
              },
            }),
          );
          return;
        }

        if (request.method === "thread/start") {
          ws.send(
            JSON.stringify({
              id: request.id,
              error: { code: -32000, message: "start failed" },
            }),
          );
        }
      },
    },
  });

  return { server, calls };
}

function git(args: string[], cwd: string) {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

describe("CALL-CODEX scaffold tools", () => {
  beforeEach(() => {
    resetLiveStateForTests();
  });

  test("exposes the pro v1 call surface", () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual([
      "call_boot",
      "call_create",
      "call_send",
      "call_broadcast",
      "call_inbox",
      "call_wake",
      "call_steer",
      "call_interrupt",
      "call_who",
      "call_reveal",
      "call_remove_thread",
      "call_update",
      "call_status",
      "call_cancel",
      "call_close",
      "call_transcript",
    ]);
  });

  test("creates a local call board entry", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const result = await handleToolCall("call_create", {
      title: "Test call",
      mode: "fork",
      workers: [{ name: "tests", role: "worker", brief: "check the line" }],
    });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe("call_create");
    expect("status" in result ? result.status : undefined).toBe("created");
  });

  test("creates worker threads in first-class git worktrees by default", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const repo = join(tmpdir(), `call-codex-repo-${crypto.randomUUID()}`);
    mkdirSync(repo, { recursive: true });
    await Bun.write(join(repo, "README.md"), "# test\n");
    git(["init"], repo);
    git(["config", "user.email", "call-codex@example.com"], repo);
    git(["config", "user.name", "CALL-CODEX"], repo);
    git(["add", "README.md"], repo);
    git(["commit", "-m", "init"], repo);

    const { server, calls } = fakeControlAppServer();
    upsertRuntime({
      url: `ws://127.0.0.1:${server.port}`,
      pid: process.pid,
      status: "running",
    });

    try {
      const created = await handleToolCall("call_create", {
        title: "Worktree call",
        cwd: repo,
        workers: [{ name: "builder", role: "worker", brief: "build safely" }],
      });
      const result = created as {
        app_server?: {
          mode?: string;
          worktrees?: Array<{ created: boolean; path: string; branch: string }>;
        };
        participants?: Array<{
          cwd: string;
          worktree_path: string;
          active_turn_id: string;
          status: string;
        }>;
      };

      expect(created.ok).toBe(true);
      expect(result.app_server?.mode).toBe("worktree");
      expect(result.app_server?.worktrees?.[0]?.created).toBe(true);
      expect(result.participants?.[0]?.cwd).toBe(
        result.app_server?.worktrees?.[0]?.path,
      );
      expect(result.participants?.[0]?.worktree_path).toBe(
        result.app_server?.worktrees?.[0]?.path,
      );
      expect(result.participants?.[0]?.active_turn_id).toBe("turn-control");
      expect(result.participants?.[0]?.status).toBe("running");
      expect(calls.map((call) => call.method)).toEqual([
        "initialize",
        "thread/start",
        "thread/name/set",
        "turn/start",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("persists first-class worker role contracts", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const created = await handleToolCall("call_create", {
      title: "Contract call",
      mode: "fork",
      workers: [
        {
          name: "reviewer",
          role: "reviewer",
          brief: "review the mission",
          capabilities: ["code review", "tests"],
          allowed_scope: "plugins/call-codex only",
          model: "gpt-test",
          reasoning_effort: "high",
          permissions: { write: false },
          deliverables: ["findings", "risk notes"],
          reporting_contract: "Report findings first, then tests.",
        },
      ],
    });
    const participant =
      "participants" in created ? created.participants?.[0] : null;

    expect(created.ok).toBe(true);
    expect(participant?.capabilities_json).toBe(
      JSON.stringify(["code review", "tests"]),
    );
    expect(participant?.allowed_scope).toBe("plugins/call-codex only");
    expect(participant?.model).toBe("gpt-test");
    expect(participant?.reasoning_effort).toBe("high");
    expect(participant?.deliverables_json).toBe(
      JSON.stringify(["findings", "risk notes"]),
    );
    expect(participant?.reporting_contract).toBe(
      "Report findings first, then tests.",
    );
  });

  test("keeps call_create alive when worker thread starts fail", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const { server } = fakeFailingStartAppServer();
    upsertRuntime({
      url: `ws://127.0.0.1:${server.port}`,
      pid: process.pid,
      status: "running",
    });

    try {
      const created = await handleToolCall("call_create", {
        title: "Failure call",
        mode: "fresh",
        workers: [{ name: "fragile", role: "worker", brief: "try to start" }],
      });
      const result = created as {
        app_server?: {
          worker_threads_created?: boolean;
          failures?: Array<{ name: string; error: string }>;
        };
        participants?: Array<{ status: string; current_task: string }>;
      };

      expect(created.ok).toBe(true);
      expect(result.app_server?.worker_threads_created).toBe(false);
      expect(result.app_server?.failures?.[0]?.error).toContain("start failed");
      expect(result.participants?.[0]?.status).toBe("failed");
    } finally {
      server.stop(true);
    }
  });

  test("records messages and exports a transcript", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const created = await handleToolCall("call_create", {
      title: "Transcript call",
      mode: "fork",
      workers: [
        { name: "reviewer", role: "reviewer", brief: "watch the diff" },
      ],
    });
    const callId = "call" in created && created.call ? created.call.id : "";

    const sent = await handleToolCall("call_send", {
      call_id: callId,
      to: "reviewer",
      content: "Please review the local call board.",
    });
    const status = await handleToolCall("call_status", { call_id: callId });
    const transcript = await handleToolCall("call_transcript", {
      call_id: callId,
    });

    expect(sent.ok).toBe(true);
    expect(status.ok).toBe(true);
    expect(
      "recent_messages" in status ? (status.recent_messages?.length ?? 0) : 0,
    ).toBe(1);
    expect(
      "transcript" in transcript
        ? (transcript.transcript?.includes("Please review") ?? false)
        : false,
    ).toBe(true);
  });

  test("wakes, steers, and interrupts an active worker turn", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const { server, calls } = fakeControlAppServer();
    upsertRuntime({
      url: `ws://127.0.0.1:${server.port}`,
      pid: process.pid,
      status: "running",
    });

    try {
      const created = await handleToolCall("call_create", {
        title: "Control call",
        mode: "fork",
        workers: [
          { name: "pilot", role: "worker", brief: "fly the active turn" },
        ],
      });
      const callId = "call" in created && created.call ? created.call.id : "";
      setParticipantThreadId({
        callId,
        name: "pilot",
        threadId: "thread-control",
      });

      const wake = await handleToolCall("call_wake", {
        call_id: callId,
        participant: "pilot",
        prompt: "Start the mission.",
      });
      const steer = await handleToolCall("call_steer", {
        call_id: callId,
        participant: "pilot",
        content: "Adjust the mission.",
      });
      const interrupt = await handleToolCall("call_interrupt", {
        call_id: callId,
        participant: "pilot",
        reason: "Test brake.",
      });

      expect(wake.ok).toBe(true);
      expect("status" in wake ? wake.status : undefined).toBe("wake_started");
      expect(steer.ok).toBe(true);
      expect("status" in steer ? steer.status : undefined).toBe("steered");
      expect(interrupt.ok).toBe(true);
      expect("status" in interrupt ? interrupt.status : undefined).toBe(
        "interrupted",
      );
      expect(calls.map((call) => call.method)).toEqual([
        "initialize",
        "initialize",
        "turn/start",
        "initialize",
        "turn/steer",
        "initialize",
        "turn/interrupt",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("reveals a worker thread with a Codex desktop deep link", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    process.env.CALL_CODEX_REVEAL_DRY_RUN = "1";
    const { server, calls } = fakeControlAppServer();
    upsertRuntime({
      url: `ws://127.0.0.1:${server.port}`,
      pid: process.pid,
      status: "running",
    });

    try {
      const created = await handleToolCall("call_create", {
        title: "Reveal call",
        mode: "fork",
        workers: [{ name: "glass", role: "worker", brief: "show up" }],
      });
      const callId = "call" in created && created.call ? created.call.id : "";
      setParticipantThreadId({
        callId,
        name: "glass",
        threadId: "thread-control",
      });

      const reveal = await handleToolCall("call_reveal", {
        call_id: callId,
        participant: "glass",
      });
      const result = reveal as {
        reveal?: Array<{
          reveal_url?: string;
          revealed?: boolean;
          name_set?: boolean;
        }>;
      };

      expect(reveal.ok).toBe(true);
      expect(result.reveal?.[0]?.revealed).toBe(true);
      expect(result.reveal?.[0]?.name_set).toBe(true);
      expect(result.reveal?.[0]?.reveal_url).toBe(
        "codex:///local/thread-control",
      );
      expect(calls.map((call) => call.method)).toEqual([
        "initialize",
        "thread/name/set",
      ]);
    } finally {
      delete process.env.CALL_CODEX_REVEAL_DRY_RUN;
      server.stop(true);
    }
  });

  test("removes a worker thread from the call board", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const { server, calls } = fakeControlAppServer();
    upsertRuntime({
      url: `ws://127.0.0.1:${server.port}`,
      pid: process.pid,
      status: "running",
    });

    try {
      const created = await handleToolCall("call_create", {
        title: "Remove call",
        mode: "fork",
        workers: [{ name: "gone", role: "worker", brief: "step away" }],
      });
      const callId = "call" in created && created.call ? created.call.id : "";
      setParticipantThreadId({
        callId,
        name: "gone",
        threadId: "thread-control",
      });

      const removed = await handleToolCall("call_remove_thread", {
        call_id: callId,
        participant: "gone",
      });
      const result = removed as {
        archive?: { archived?: boolean };
        participants?: Array<{ name: string }>;
      };

      expect(removed.ok).toBe(true);
      expect(result.archive?.archived).toBe(true);
      expect(result.participants?.some((item) => item.name === "gone")).toBe(
        false,
      );
      expect(calls.map((call) => call.method)).toContain("thread/archive");
    } finally {
      server.stop(true);
    }
  });

  test("call_status refreshes worker progress and clears finished turns", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const { server, calls } = fakeControlAppServer();
    upsertRuntime({
      url: `ws://127.0.0.1:${server.port}`,
      pid: process.pid,
      status: "running",
    });

    try {
      const created = await handleToolCall("call_create", {
        title: "Progress call",
        mode: "fork",
        workers: [{ name: "reader", role: "worker", brief: "report back" }],
      });
      const callId = "call" in created && created.call ? created.call.id : "";
      setParticipantThreadId({
        callId,
        name: "reader",
        threadId: "thread-control",
      });

      const wake = await handleToolCall("call_wake", {
        call_id: callId,
        participant: "reader",
        prompt: "Finish and report.",
      });
      await Bun.sleep(10);
      const status = await handleToolCall("call_status", { call_id: callId });
      const statusResult = status as {
        health?: { ok: boolean; active_count: number };
        worker_progress?: {
          workers: Array<{
            latest_assistant_messages: Array<{ text: string }>;
            source?: string;
          }>;
          auto_cleared: Array<{ status: string }>;
        };
        participants?: Array<{ active_turn_id: string; status: string }>;
      };

      expect(wake.ok).toBe(true);
      expect(status.ok).toBe(true);
      expect(statusResult.health?.ok).toBe(true);
      expect(statusResult.health?.active_count).toBe(0);
      expect(
        statusResult.worker_progress
          ? statusResult.worker_progress.workers[0]
              ?.latest_assistant_messages[0]?.text
          : "",
      ).toBe("Mission complete. The line is clear.");
      expect(
        statusResult.worker_progress
          ? statusResult.worker_progress.auto_cleared[0]?.status
          : "",
      ).toBe("completed");
      expect(
        statusResult.worker_progress
          ? statusResult.worker_progress.workers[0]?.source
          : "",
      ).toBe("live_stream");
      expect(
        statusResult.participants
          ? statusResult.participants[0]?.active_turn_id
          : "",
      ).toBe("");
      expect(
        statusResult.participants ? statusResult.participants[0]?.status : "",
      ).toBe("done");
      expect(calls.map((call) => call.method)).toEqual([
        "initialize",
        "initialize",
        "turn/start",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("call_transcript imports worker assistant output", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const { server, calls } = fakeControlAppServer();
    upsertRuntime({
      url: `ws://127.0.0.1:${server.port}`,
      pid: process.pid,
      status: "running",
    });

    try {
      const created = await handleToolCall("call_create", {
        title: "Imported transcript call",
        mode: "fork",
        workers: [{ name: "scribe", role: "worker", brief: "write it down" }],
      });
      const callId = "call" in created && created.call ? created.call.id : "";
      setParticipantThreadId({
        callId,
        name: "scribe",
        threadId: "thread-control",
      });

      await handleToolCall("call_send", {
        call_id: callId,
        to: "scribe",
        content: "Record the worker output.",
      });
      const transcript = await handleToolCall("call_transcript", {
        call_id: callId,
      });

      expect(transcript.ok).toBe(true);
      expect(
        "worker_sections_imported" in transcript
          ? transcript.worker_sections_imported
          : 0,
      ).toBe(1);
      expect(
        "transcript" in transcript
          ? transcript.transcript?.includes("## Worker Output")
          : false,
      ).toBe(true);
      expect(
        "transcript" in transcript
          ? transcript.transcript?.includes("- Source: live")
          : false,
      ).toBe(true);
      expect(
        "transcript" in transcript
          ? transcript.transcript?.includes(
              "Mission complete. The line is clear.",
            )
          : false,
      ).toBe(true);
      expect(
        "worker_transcript_metadata" in transcript
          ? transcript.worker_transcript_metadata?.[0]?.source
          : "",
      ).toBe("live");
      expect(
        "worker_transcript_metadata" in transcript
          ? transcript.worker_transcript_metadata?.[0]?.cache_state
          : "",
      ).toBe("fresh");
      expect(calls.map((call) => call.method)).toEqual([
        "initialize",
        "thread/inject_items",
        "initialize",
        "initialize",
        "thread/read",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("call_transcript falls back to cached worker output", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const live = fakeControlAppServer();
    upsertRuntime({
      url: `ws://127.0.0.1:${live.server.port}`,
      pid: process.pid,
      status: "running",
    });

    let callId = "";
    try {
      const created = await handleToolCall("call_create", {
        title: "Cached transcript call",
        mode: "fork",
        workers: [{ name: "cache", role: "worker", brief: "keep receipts" }],
      });
      callId = "call" in created && created.call ? created.call.id : "";
      setParticipantThreadId({
        callId,
        name: "cache",
        threadId: "thread-control",
      });
      await handleToolCall("call_transcript", { call_id: callId });
      getDb().run(
        "UPDATE worker_transcript_items SET imported_at = ? WHERE call_id = ?",
        ["2000-01-01T00:00:00.000Z", callId],
      );
    } finally {
      live.server.stop(true);
    }

    const failing = fakeFailingReadAppServer();
    upsertRuntime({
      url: `ws://127.0.0.1:${failing.server.port}`,
      pid: process.pid,
      status: "running",
    });

    try {
      const transcript = await handleToolCall("call_transcript", {
        call_id: callId,
      });

      expect(transcript.ok).toBe(true);
      expect(
        "transcript" in transcript
          ? transcript.transcript?.includes(
              "Mission complete. The line is clear.",
            )
          : false,
      ).toBe(true);
      expect(
        "transcript" in transcript
          ? transcript.transcript?.includes("- Source: cache")
          : false,
      ).toBe(true);
      expect(
        "transcript" in transcript
          ? transcript.transcript?.includes("- Cache: stale")
          : false,
      ).toBe(true);
      expect(
        "transcript" in transcript
          ? transcript.transcript?.includes(
              "- Live read error: thread unavailable",
            )
          : false,
      ).toBe(true);
      expect(
        "worker_transcript_metadata" in transcript
          ? transcript.worker_transcript_metadata?.[0]?.source
          : "",
      ).toBe("cache");
      expect(
        "worker_transcript_metadata" in transcript
          ? transcript.worker_transcript_metadata?.[0]?.cache_state
          : "",
      ).toBe("stale");
      expect(
        "worker_transcript_metadata" in transcript
          ? transcript.worker_transcript_metadata?.[0]?.live_read_error
          : "",
      ).toBe("thread unavailable");
      expect(
        "worker_transcript_metadata" in transcript
          ? transcript.worker_transcript_metadata?.[0]?.imported_at
          : null,
      ).toBeTruthy();
      expect(failing.calls.map((call) => call.method)).toEqual([
        "initialize",
        "initialize",
        "thread/read",
      ]);
    } finally {
      failing.server.stop(true);
    }
  });
});
