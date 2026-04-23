import { z } from "zod";

const prioritySchema = z.enum(["low", "normal", "high", "urgent"]).default("normal");
const messageTypeSchema = z.enum(["task", "question", "status", "review", "note"]).default("note");

export const toolDefinitions = [
  {
    name: "call_boot",
    description: "Wake the managed local Codex app-server and initialize CALL-CODEX state.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Workspace directory for the call board." },
        force_restart: { type: "boolean", description: "Restart the managed loopback app-server." }
      }
    }
  },
  {
    name: "call_create",
    description: "Open a new CALL-CODEX call with named worker threads.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        project: { type: "string" },
        mode: { type: "string", enum: ["fork", "fresh"], default: "fork" },
        workers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              brief: { type: "string" }
            },
            required: ["name", "role", "brief"]
          }
        }
      },
      required: ["title", "workers"]
    }
  },
  {
    name: "call_send",
    description: "Send a targeted message to one worker on a call.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        to: { type: "string" },
        content: { type: "string" },
        message_type: { type: "string", enum: ["task", "question", "status", "review", "note"] },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] }
      },
      required: ["call_id", "to", "content"]
    }
  },
  {
    name: "call_broadcast",
    description: "Send a message to everyone on a call.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        content: { type: "string" },
        message_type: { type: "string", enum: ["task", "question", "status", "review", "note"] },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] }
      },
      required: ["call_id", "content"]
    }
  },
  {
    name: "call_inbox",
    description: "Read pending or recent messages for a call participant.",
    inputSchema: {
      type: "object",
      properties: {
        participant: { type: "string" },
        call_id: { type: "string" },
        limit: { type: "number" }
      },
      required: ["participant"]
    }
  },
  {
    name: "call_who",
    description: "List active calls and workers on the line.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        project: { type: "string" }
      }
    }
  },
  {
    name: "call_update",
    description: "Update call, participant, or task state.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        participant: { type: "string" },
        status: { type: "string", enum: ["queued", "running", "blocked", "done", "failed", "cancelled"] },
        summary: { type: "string" },
        blocker: { type: "string" }
      },
      required: ["call_id", "status"]
    }
  },
  {
    name: "call_status",
    description: "Show progress, blockers, and recent traffic for a call.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        include_recent_messages: { type: "boolean" }
      },
      required: ["call_id"]
    }
  },
  {
    name: "call_cancel",
    description: "Interrupt active work and mark a call cancelled.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        reason: { type: "string" }
      },
      required: ["call_id"]
    }
  },
  {
    name: "call_close",
    description: "Close a call and preserve its transcript.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        summary: { type: "string" }
      },
      required: ["call_id"]
    }
  },
  {
    name: "call_transcript",
    description: "Export a readable transcript for a call.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        format: { type: "string", enum: ["markdown"], default: "markdown" }
      },
      required: ["call_id"]
    }
  }
] as const;

const callToolNames: Set<string> = new Set(toolDefinitions.map((tool) => tool.name));

const scaffoldInputSchema = z
  .object({
    priority: prioritySchema.optional(),
    message_type: messageTypeSchema.optional()
  })
  .passthrough();

export function handleToolCall(name: string, args: unknown) {
  if (!callToolNames.has(name)) {
    return {
      ok: false,
      error: `Unknown CALL-CODEX tool: ${name}`
    };
  }

  const parsed = scaffoldInputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      tool: name,
      error: parsed.error.message
    };
  }

  return {
    ok: true,
    tool: name,
    status: "scaffold_ready",
    message: "CALL-CODEX scaffold is wired. App-server and SQLite behavior land in the next build slice.",
    app_server: {
      required: true,
      managed: true,
      bind: "127.0.0.1",
      implemented: false
    },
    audit: {
      sqlite_path: "~/.codex/call-codex/bus.db",
      implemented: false
    },
    received: parsed.data
  };
}
