import { describe, expect, test } from "bun:test";
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

  test("returns a scaffold response for known tools", () => {
    const result = handleToolCall("call_boot", { cwd: "/tmp/call-codex" });
    expect(result.ok).toBe(true);
    expect(result.tool).toBe("call_boot");
    expect(result.status).toBe("scaffold_ready");
  });
});
