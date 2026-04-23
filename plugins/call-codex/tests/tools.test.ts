import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDbForTests } from "../src/bus";
import { handleToolCall, toolDefinitions } from "../src/tools";

describe("CALL-CODEX scaffold tools", () => {
  test("exposes the pro v1 call surface", () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual([
      "call_boot",
      "call_create",
      "call_send",
      "call_broadcast",
      "call_inbox",
      "call_who",
      "call_update",
      "call_status",
      "call_cancel",
      "call_close",
      "call_transcript"
    ]);
  });

  test("creates a local call board entry", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const result = await handleToolCall("call_create", {
      title: "Test call",
      workers: [{ name: "tests", role: "worker", brief: "check the line" }]
    });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe("call_create");
    expect("status" in result ? result.status : undefined).toBe("created");
  });

  test("records messages and exports a transcript", async () => {
    resetDbForTests(join(tmpdir(), `call-codex-${crypto.randomUUID()}.db`));
    const created = await handleToolCall("call_create", {
      title: "Transcript call",
      workers: [{ name: "reviewer", role: "reviewer", brief: "watch the diff" }]
    });
    const callId = "call" in created && created.call ? created.call.id : "";

    const sent = await handleToolCall("call_send", {
      call_id: callId,
      to: "reviewer",
      content: "Please review the local call board."
    });
    const status = await handleToolCall("call_status", { call_id: callId });
    const transcript = await handleToolCall("call_transcript", { call_id: callId });

    expect(sent.ok).toBe(true);
    expect(status.ok).toBe(true);
    expect("recent_messages" in status ? (status.recent_messages?.length ?? 0) : 0).toBe(1);
    expect("transcript" in transcript ? (transcript.transcript?.includes("Please review") ?? false) : false).toBe(true);
  });
});
