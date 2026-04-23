import { describe, expect, test } from "bun:test";
import { AppServerClient, userMessageItem } from "../src/app-server/client";

function fakeAppServer() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) {
        return;
      }
      return new Response("CALL-CODEX fake app-server");
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
              result: {
                thread: {
                  id: "thread-test",
                  status: { type: "idle" },
                  ephemeral: false,
                  turns: [],
                },
                model: "gpt-test",
                modelProvider: "openai",
                serviceTier: null,
                cwd: "/tmp/call-codex",
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

        if (request.method === "thread/inject_items") {
          ws.send(JSON.stringify({ id: request.id, result: {} }));
        }
      },
    },
  });

  return { server, calls };
}

describe("AppServerClient", () => {
  test("initializes once, starts a thread, and injects items", async () => {
    const { server, calls } = fakeAppServer();
    const client = new AppServerClient(`ws://127.0.0.1:${server.port}`);

    try {
      const thread = await client.startThread({
        cwd: "/tmp/call-codex",
        developerInstructions: "Keep the call line clear.",
        ephemeral: false,
        experimentalRawEvents: false,
        persistExtendedHistory: true,
      });
      await client.injectItems({
        threadId: thread.thread.id,
        items: [userMessageItem("CALL-CODEX ping")],
      });

      expect(thread.thread.id).toBe("thread-test");
      expect(calls.map((call) => call.method)).toEqual([
        "initialize",
        "thread/start",
        "thread/inject_items",
      ]);
    } finally {
      client.close();
      server.stop(true);
    }
  });
});
