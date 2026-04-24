import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getDb,
  resetDbForTests,
  setParticipantThreadId,
  upsertRuntime,
} from "../src/bus";
import { handleToolCall, toolDefinitions } from "../src/tools";

function fakeControlAppServer() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response("CALL-CODEX fake control app-server");
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

describe("CALL-CODEX scaffold tools", () => {
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
      workers: [{ name: "tests", role: "worker", brief: "check the line" }],
    });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe("call_create");
    expect("status" in result ? result.status : undefined).toBe("created");
  });

  test("records messages and exports a transcript", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const created = await handleToolCall("call_create", {
      title: "Transcript call",
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
      const status = await handleToolCall("call_status", { call_id: callId });
      const statusResult = status as {
        worker_progress?: {
          workers: Array<{
            latest_assistant_messages: Array<{ text: string }>;
          }>;
          auto_cleared: Array<{ status: string }>;
        };
        participants?: Array<{ active_turn_id: string; status: string }>;
      };

      expect(wake.ok).toBe(true);
      expect(status.ok).toBe(true);
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
        statusResult.participants
          ? statusResult.participants[0]?.active_turn_id
          : "",
      ).toBe("");
      expect(
        statusResult.participants ? statusResult.participants[0]?.status : "",
      ).toBe("done");
      expect(calls.map((call) => call.method)).toEqual([
        "initialize",
        "turn/start",
        "initialize",
        "thread/read",
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
        "thread/read",
      ]);
    } finally {
      failing.server.stop(true);
    }
  });
});
