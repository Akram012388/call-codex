import { z } from "zod";
import {
  addMessage,
  buildTranscript,
  createCall,
  getCallBundle,
  getDbPath,
  getRuntime,
  listCalls,
  listMessages,
  listParticipants,
  setCallStatus,
  updateCall
} from "./bus";
import { bootManagedAppServer } from "./app-server/manager";

const prioritySchema = z.enum(["low", "normal", "high", "urgent"]).default("normal");
const messageTypeSchema = z.enum(["task", "question", "status", "review", "note"]).default("note");
const workerSchema = z.object({
  name: z.string().min(1).max(64),
  role: z.string().min(1).max(64),
  brief: z.string().min(1).max(10_000)
});

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
        cwd: { type: "string" },
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
        from: { type: "string" },
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
        from: { type: "string" },
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

const bootSchema = z.object({
  cwd: z.string().optional(),
  force_restart: z.boolean().optional()
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  project: z.string().max(100).optional(),
  mode: z.enum(["fork", "fresh"]).default("fork"),
  cwd: z.string().optional(),
  workers: z.array(workerSchema).min(1).max(12)
});

const sendSchema = z.object({
  call_id: z.string().min(1),
  from: z.string().min(1).max(64).default("main"),
  to: z.string().min(1).max(64),
  content: z.string().min(1).max(10_000),
  message_type: messageTypeSchema,
  priority: prioritySchema
});

const broadcastSchema = z.object({
  call_id: z.string().min(1),
  from: z.string().min(1).max(64).default("main"),
  content: z.string().min(1).max(10_000),
  message_type: messageTypeSchema,
  priority: prioritySchema
});

const inboxSchema = z.object({
  participant: z.string().min(1).max(64),
  call_id: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20)
});

const whoSchema = z.object({
  call_id: z.string().optional(),
  project: z.string().optional()
});

const updateSchema = z.object({
  call_id: z.string().min(1),
  participant: z.string().optional(),
  status: z.enum(["queued", "running", "blocked", "done", "failed", "cancelled"]),
  summary: z.string().optional(),
  blocker: z.string().optional()
});

const statusSchema = z.object({
  call_id: z.string().min(1),
  include_recent_messages: z.boolean().default(true)
});

const closeSchema = z.object({
  call_id: z.string().min(1),
  summary: z.string().optional()
});

const transcriptSchema = z.object({
  call_id: z.string().min(1),
  format: z.enum(["markdown"]).default("markdown")
});

function parse<T>(schema: z.ZodType<T>, name: string, args: unknown) {
  const result = schema.safeParse(args ?? {});
  if (!result.success) {
    return {
      ok: false as const,
      tool: name,
      error: result.error.message
    };
  }

  return {
    ok: true as const,
    data: result.data
  };
}

function missingCall(tool: string, callId: string) {
  return {
    ok: false,
    tool,
    error: `No CALL-CODEX call found for ${callId}`
  };
}

export async function handleToolCall(name: string, args: unknown) {
  if (!callToolNames.has(name)) {
    return {
      ok: false,
      error: `Unknown CALL-CODEX tool: ${name}`
    };
  }

  switch (name) {
    case "call_boot": {
      const parsed = parse(bootSchema, name, args);
      if (!parsed.ok) return parsed;
      const boot = await bootManagedAppServer({ forceRestart: parsed.data.force_restart });
      return {
        ok: true,
        tool: name,
        status: "online",
        message: boot.reused ? "CALL-CODEX reused the local app-server. The line is still hot." : "CALL-CODEX booted a local app-server. The line is open.",
        app_server: {
          ...boot.runtime,
          bind: "127.0.0.1",
          managed: true
        },
        audit: {
          sqlite_path: getDbPath(),
          initialized: true
        }
      };
    }

    case "call_create": {
      const parsed = parse(createSchema, name, args);
      if (!parsed.ok) return parsed;
      const bundle = createCall(parsed.data);
      return {
        ok: true,
        tool: name,
        status: "created",
        message: "CALL-CODEX opened the call board. Worker thread creation lands in the next app-server slice.",
        app_server: {
          runtime: getRuntime(),
          worker_threads_created: false
        },
        ...bundle
      };
    }

    case "call_send": {
      const parsed = parse(sendSchema, name, args);
      if (!parsed.ok) return parsed;
      if (!getCallBundle(parsed.data.call_id, false)) return missingCall(name, parsed.data.call_id);
      const message = addMessage({
        callId: parsed.data.call_id,
        fromName: parsed.data.from,
        toName: parsed.data.to,
        content: parsed.data.content,
        messageType: parsed.data.message_type,
        priority: parsed.data.priority
      });
      return {
        ok: true,
        tool: name,
        status: "queued",
        message,
        injection: {
          implemented: false,
          next: "thread/inject_items"
        }
      };
    }

    case "call_broadcast": {
      const parsed = parse(broadcastSchema, name, args);
      if (!parsed.ok) return parsed;
      const bundle = getCallBundle(parsed.data.call_id, false);
      if (!bundle) return missingCall(name, parsed.data.call_id);
      const messages = bundle.participants.map((participant) =>
        addMessage({
          callId: parsed.data.call_id,
          fromName: parsed.data.from,
          toName: participant.name,
          content: parsed.data.content,
          messageType: parsed.data.message_type,
          priority: parsed.data.priority
        })
      );
      return {
        ok: true,
        tool: name,
        status: "broadcast_queued",
        recipient_count: messages.length,
        messages,
        injection: {
          implemented: false,
          next: "thread/inject_items"
        }
      };
    }

    case "call_inbox": {
      const parsed = parse(inboxSchema, name, args);
      if (!parsed.ok) return parsed;
      return {
        ok: true,
        tool: name,
        participant: parsed.data.participant,
        messages: listMessages({
          callId: parsed.data.call_id,
          participant: parsed.data.participant,
          limit: parsed.data.limit
        })
      };
    }

    case "call_who": {
      const parsed = parse(whoSchema, name, args);
      if (!parsed.ok) return parsed;
      return {
        ok: true,
        tool: name,
        runtime: getRuntime(),
        calls: parsed.data.call_id ? [getCallBundle(parsed.data.call_id, false)].filter(Boolean) : listCalls({ project: parsed.data.project }),
        participants: listParticipants({ callId: parsed.data.call_id })
      };
    }

    case "call_update": {
      const parsed = parse(updateSchema, name, args);
      if (!parsed.ok) return parsed;
      const bundle = updateCall({
        callId: parsed.data.call_id,
        participant: parsed.data.participant,
        status: parsed.data.status,
        summary: parsed.data.summary,
        blocker: parsed.data.blocker
      });
      if (!bundle) return missingCall(name, parsed.data.call_id);
      return {
        ok: true,
        tool: name,
        status: "updated",
        ...bundle
      };
    }

    case "call_status": {
      const parsed = parse(statusSchema, name, args);
      if (!parsed.ok) return parsed;
      const bundle = getCallBundle(parsed.data.call_id, parsed.data.include_recent_messages);
      if (!bundle) return missingCall(name, parsed.data.call_id);
      return {
        ok: true,
        tool: name,
        runtime: getRuntime(),
        ...bundle
      };
    }

    case "call_cancel": {
      const parsed = parse(closeSchema, name, args);
      if (!parsed.ok) return parsed;
      const bundle = setCallStatus(parsed.data.call_id, "cancelled", parsed.data.summary);
      if (!bundle) return missingCall(name, parsed.data.call_id);
      return {
        ok: true,
        tool: name,
        status: "cancelled",
        interrupt: {
          implemented: false,
          next: "turn/interrupt"
        },
        ...bundle
      };
    }

    case "call_close": {
      const parsed = parse(closeSchema, name, args);
      if (!parsed.ok) return parsed;
      const bundle = setCallStatus(parsed.data.call_id, "closed", parsed.data.summary);
      if (!bundle) return missingCall(name, parsed.data.call_id);
      return {
        ok: true,
        tool: name,
        status: "closed",
        ...bundle
      };
    }

    case "call_transcript": {
      const parsed = parse(transcriptSchema, name, args);
      if (!parsed.ok) return parsed;
      const transcript = buildTranscript(parsed.data.call_id);
      if (!transcript) return missingCall(name, parsed.data.call_id);
      return {
        ok: true,
        tool: name,
        format: parsed.data.format,
        transcript
      };
    }
  }

  return {
    ok: false,
    tool: name,
    error: `CALL-CODEX has no handler for ${name}`
  };
}
