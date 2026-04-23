import { z } from "zod";
import {
  addMessage,
  buildTranscript,
  createCall,
  getCallBundle,
  getDbPath,
  getParticipant,
  getRuntime,
  listCalls,
  listMessages,
  listParticipants,
  markMessageInjected,
  setCallStatus,
  setParticipantThreadId,
  updateCall,
} from "./bus";
import { bootManagedAppServer } from "./app-server/manager";
import { AppServerClient, userMessageItem } from "./app-server/client";
import type { MessageRow, ParticipantRow, RuntimeState } from "./bus";

const prioritySchema = z
  .enum(["low", "normal", "high", "urgent"])
  .default("normal");
const messageTypeSchema = z
  .enum(["task", "question", "status", "review", "note"])
  .default("note");
const workerSchema = z.object({
  name: z.string().min(1).max(64),
  role: z.string().min(1).max(64),
  brief: z.string().min(1).max(10_000),
});

export const toolDefinitions = [
  {
    name: "call_boot",
    description:
      "Wake the managed local Codex app-server and initialize CALL-CODEX state.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Workspace directory for the call board.",
        },
        force_restart: {
          type: "boolean",
          description: "Restart the managed loopback app-server.",
        },
      },
    },
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
        main_thread_id: {
          type: "string",
          description:
            "Required to fork workers from the current main Codex thread.",
        },
        cwd: { type: "string" },
        workers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              brief: { type: "string" },
            },
            required: ["name", "role", "brief"],
          },
        },
      },
      required: ["title", "workers"],
    },
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
        message_type: {
          type: "string",
          enum: ["task", "question", "status", "review", "note"],
        },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
      },
      required: ["call_id", "to", "content"],
    },
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
        message_type: {
          type: "string",
          enum: ["task", "question", "status", "review", "note"],
        },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
      },
      required: ["call_id", "content"],
    },
  },
  {
    name: "call_inbox",
    description: "Read pending or recent messages for a call participant.",
    inputSchema: {
      type: "object",
      properties: {
        participant: { type: "string" },
        call_id: { type: "string" },
        limit: { type: "number" },
      },
      required: ["participant"],
    },
  },
  {
    name: "call_who",
    description: "List active calls and workers on the line.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        project: { type: "string" },
      },
    },
  },
  {
    name: "call_update",
    description: "Update call, participant, or task state.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        participant: { type: "string" },
        status: {
          type: "string",
          enum: ["queued", "running", "blocked", "done", "failed", "cancelled"],
        },
        summary: { type: "string" },
        blocker: { type: "string" },
      },
      required: ["call_id", "status"],
    },
  },
  {
    name: "call_status",
    description: "Show progress, blockers, and recent traffic for a call.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        include_recent_messages: { type: "boolean" },
      },
      required: ["call_id"],
    },
  },
  {
    name: "call_cancel",
    description: "Interrupt active work and mark a call cancelled.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["call_id"],
    },
  },
  {
    name: "call_close",
    description: "Close a call and preserve its transcript.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        summary: { type: "string" },
      },
      required: ["call_id"],
    },
  },
  {
    name: "call_transcript",
    description: "Export a readable transcript for a call.",
    inputSchema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        format: { type: "string", enum: ["markdown"], default: "markdown" },
      },
      required: ["call_id"],
    },
  },
] as const;

const callToolNames: Set<string> = new Set(
  toolDefinitions.map((tool) => tool.name),
);

const bootSchema = z.object({
  cwd: z.string().optional(),
  force_restart: z.boolean().optional(),
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  project: z.string().max(100).optional(),
  mode: z.enum(["fork", "fresh"]).default("fork"),
  main_thread_id: z.string().min(1).optional(),
  cwd: z.string().optional(),
  workers: z.array(workerSchema).min(1).max(12),
});

const sendSchema = z.object({
  call_id: z.string().min(1),
  from: z.string().min(1).max(64).default("main"),
  to: z.string().min(1).max(64),
  content: z.string().min(1).max(10_000),
  message_type: messageTypeSchema,
  priority: prioritySchema,
});

const broadcastSchema = z.object({
  call_id: z.string().min(1),
  from: z.string().min(1).max(64).default("main"),
  content: z.string().min(1).max(10_000),
  message_type: messageTypeSchema,
  priority: prioritySchema,
});

const inboxSchema = z.object({
  participant: z.string().min(1).max(64),
  call_id: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
});

const whoSchema = z.object({
  call_id: z.string().optional(),
  project: z.string().optional(),
});

const updateSchema = z.object({
  call_id: z.string().min(1),
  participant: z.string().optional(),
  status: z.enum([
    "queued",
    "running",
    "blocked",
    "done",
    "failed",
    "cancelled",
  ]),
  summary: z.string().optional(),
  blocker: z.string().optional(),
});

const statusSchema = z.object({
  call_id: z.string().min(1),
  include_recent_messages: z.boolean().default(true),
});

const closeSchema = z.object({
  call_id: z.string().min(1),
  summary: z.string().optional(),
});

const transcriptSchema = z.object({
  call_id: z.string().min(1),
  format: z.enum(["markdown"]).default("markdown"),
});

function parse<T>(schema: z.ZodType<T>, name: string, args: unknown) {
  const result = schema.safeParse(args ?? {});
  if (!result.success) {
    return {
      ok: false as const,
      tool: name,
      error: result.error.message,
    };
  }

  return {
    ok: true as const,
    data: result.data,
  };
}

function missingCall(tool: string, callId: string) {
  return {
    ok: false,
    tool,
    error: `No CALL-CODEX call found for ${callId}`,
  };
}

function requireRuntime(runtime: RuntimeState | null) {
  if (!runtime) {
    throw new Error(
      "CALL-CODEX app-server runtime was not recorded after boot.",
    );
  }
  return runtime;
}

function workerInstructions(
  callTitle: string,
  worker: { name: string; role: string; brief: string },
) {
  return [
    `You are ${worker.name}, the ${worker.role} on a CALL-CODEX call.`,
    `Call: ${callTitle}`,
    "",
    "Stay focused on your assigned role. Treat CALL-CODEX injected messages as the call line.",
    "When you report back, be concise, concrete, and include blockers early.",
    "",
    `Brief: ${worker.brief}`,
  ].join("\n");
}

async function startWorkerThreads(input: {
  callId: string;
  title: string;
  mode: "fork" | "fresh";
  mainThreadId?: string;
  cwd?: string;
  workers: Array<{ name: string; role: string; brief: string }>;
}) {
  if (input.mode === "fork" && !input.mainThreadId) {
    return {
      worker_threads_created: false,
      requires_main_thread_id: true,
      message:
        "Fork mode needs main_thread_id so CALL-CODEX knows which Codex thread to fork.",
    };
  }

  const boot = await bootManagedAppServer();
  const runtime = requireRuntime(boot.runtime);
  const client = new AppServerClient(runtime.url);
  const workers = [];

  try {
    for (const worker of input.workers) {
      const developerInstructions = workerInstructions(input.title, worker);
      const started =
        input.mode === "fresh"
          ? await client.startThread({
              cwd: input.cwd ?? process.cwd(),
              developerInstructions,
              ephemeral: false,
              experimentalRawEvents: false,
              persistExtendedHistory: true,
            })
          : await client.forkThread({
              threadId: input.mainThreadId!,
              cwd: input.cwd ?? process.cwd(),
              developerInstructions,
              ephemeral: false,
              persistExtendedHistory: true,
            });

      const participant = setParticipantThreadId({
        callId: input.callId,
        name: worker.name,
        threadId: started.thread.id,
      });

      workers.push({
        name: worker.name,
        role: worker.role,
        thread_id: started.thread.id,
        status: participant?.status ?? "running",
      });
    }
  } finally {
    client.close();
  }

  return {
    worker_threads_created: workers.length > 0,
    requires_main_thread_id: false,
    mode: input.mode,
    runtime: getRuntime(),
    workers,
  };
}

function callMessageText(message: MessageRow) {
  return [
    "CALL-CODEX line message",
    `From: ${message.from_name}`,
    `To: ${message.to_name}`,
    `Type: ${message.message_type}`,
    `Priority: ${message.priority}`,
    "",
    message.content,
  ].join("\n");
}

type InjectionResult =
  | { injected: false; reason: string }
  | { injected: true; thread_id: string; message: MessageRow | null };

async function injectMessage(
  client: AppServerClient | null,
  message: MessageRow,
  participant: ParticipantRow | null | undefined,
): Promise<InjectionResult> {
  if (!participant) {
    return {
      injected: false,
      reason: `No participant named ${message.to_name} is on this call.`,
    };
  }

  if (!participant.thread_id) {
    return {
      injected: false,
      reason: `${message.to_name} is on the call board but does not have a Codex thread yet.`,
    };
  }

  if (!client) {
    return {
      injected: false,
      reason: `${message.to_name} has a Codex thread, but the app-server client is not connected.`,
    };
  }

  await client.injectItems({
    threadId: participant.thread_id,
    items: [userMessageItem(callMessageText(message))],
  });
  const injectedMessage = markMessageInjected(message.id);
  return {
    injected: true,
    thread_id: participant.thread_id,
    message: injectedMessage,
  };
}

export async function handleToolCall(name: string, args: unknown) {
  if (!callToolNames.has(name)) {
    return {
      ok: false,
      error: `Unknown CALL-CODEX tool: ${name}`,
    };
  }

  switch (name) {
    case "call_boot": {
      const parsed = parse(bootSchema, name, args);
      if (!parsed.ok) return parsed;
      const boot = await bootManagedAppServer({
        forceRestart: parsed.data.force_restart,
      });
      return {
        ok: true,
        tool: name,
        status: "online",
        message: boot.reused
          ? "CALL-CODEX reused the local app-server. The line is still hot."
          : "CALL-CODEX booted a local app-server. The line is open.",
        app_server: {
          ...boot.runtime,
          bind: "127.0.0.1",
          managed: true,
        },
        audit: {
          sqlite_path: getDbPath(),
          initialized: true,
        },
      };
    }

    case "call_create": {
      const parsed = parse(createSchema, name, args);
      if (!parsed.ok) return parsed;
      const bundle = createCall(parsed.data);
      const appServer = bundle?.call
        ? await startWorkerThreads({
            callId: bundle.call.id,
            title: parsed.data.title,
            mode: parsed.data.mode,
            mainThreadId: parsed.data.main_thread_id,
            cwd: parsed.data.cwd,
            workers: parsed.data.workers,
          })
        : { worker_threads_created: false };
      return {
        ok: true,
        tool: name,
        status: "created",
        message: appServer.worker_threads_created
          ? "CALL-CODEX opened the line and parked the workers in real Codex threads."
          : "CALL-CODEX opened the call board. Add main_thread_id for fork mode, or use fresh mode to spin workers now.",
        app_server: appServer,
        ...(bundle?.call ? getCallBundle(bundle.call.id) : bundle),
      };
    }

    case "call_send": {
      const parsed = parse(sendSchema, name, args);
      if (!parsed.ok) return parsed;
      const bundle = getCallBundle(parsed.data.call_id, false);
      if (!bundle) return missingCall(name, parsed.data.call_id);
      const message = addMessage({
        callId: parsed.data.call_id,
        fromName: parsed.data.from,
        toName: parsed.data.to,
        content: parsed.data.content,
        messageType: parsed.data.message_type,
        priority: parsed.data.priority,
      });
      const participant = getParticipant({
        callId: parsed.data.call_id,
        name: parsed.data.to,
      });
      let injection: InjectionResult = {
        injected: false,
        reason: "Message was queued on the local call board.",
      };
      if (message && participant?.thread_id) {
        const boot = await bootManagedAppServer();
        const runtime = requireRuntime(boot.runtime);
        const client = new AppServerClient(runtime.url);
        try {
          injection = await injectMessage(client, message, participant);
        } finally {
          client.close();
        }
      } else if (message) {
        injection = await injectMessage(null, message, participant);
      }
      return {
        ok: true,
        tool: name,
        status: injection.injected ? "injected" : "queued",
        message: injection.injected ? injection.message : message,
        injection,
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
          priority: parsed.data.priority,
        }),
      );
      const injections = [];
      const hasThreads = bundle.participants.some(
        (participant) => participant.thread_id,
      );
      if (hasThreads) {
        const boot = await bootManagedAppServer();
        const runtime = requireRuntime(boot.runtime);
        const client = new AppServerClient(runtime.url);
        try {
          for (const message of messages) {
            if (!message) continue;
            const participant = bundle.participants.find(
              (item) => item.name === message.to_name,
            );
            injections.push(await injectMessage(client, message, participant));
          }
        } finally {
          client.close();
        }
      } else {
        for (const message of messages) {
          if (!message) continue;
          const participant = bundle.participants.find(
            (item) => item.name === message.to_name,
          );
          injections.push(await injectMessage(null, message, participant));
        }
      }
      return {
        ok: true,
        tool: name,
        status: injections.some((item) => item.injected)
          ? "broadcast_injected"
          : "broadcast_queued",
        recipient_count: messages.length,
        messages,
        injections,
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
          limit: parsed.data.limit,
        }),
      };
    }

    case "call_who": {
      const parsed = parse(whoSchema, name, args);
      if (!parsed.ok) return parsed;
      return {
        ok: true,
        tool: name,
        runtime: getRuntime(),
        calls: parsed.data.call_id
          ? [getCallBundle(parsed.data.call_id, false)].filter(Boolean)
          : listCalls({ project: parsed.data.project }),
        participants: listParticipants({ callId: parsed.data.call_id }),
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
        blocker: parsed.data.blocker,
      });
      if (!bundle) return missingCall(name, parsed.data.call_id);
      return {
        ok: true,
        tool: name,
        status: "updated",
        ...bundle,
      };
    }

    case "call_status": {
      const parsed = parse(statusSchema, name, args);
      if (!parsed.ok) return parsed;
      const bundle = getCallBundle(
        parsed.data.call_id,
        parsed.data.include_recent_messages,
      );
      if (!bundle) return missingCall(name, parsed.data.call_id);
      return {
        ok: true,
        tool: name,
        runtime: getRuntime(),
        ...bundle,
      };
    }

    case "call_cancel": {
      const parsed = parse(closeSchema, name, args);
      if (!parsed.ok) return parsed;
      const bundle = setCallStatus(
        parsed.data.call_id,
        "cancelled",
        parsed.data.summary,
      );
      if (!bundle) return missingCall(name, parsed.data.call_id);
      return {
        ok: true,
        tool: name,
        status: "cancelled",
        interrupt: {
          implemented: false,
          next: "turn/interrupt",
        },
        ...bundle,
      };
    }

    case "call_close": {
      const parsed = parse(closeSchema, name, args);
      if (!parsed.ok) return parsed;
      const bundle = setCallStatus(
        parsed.data.call_id,
        "closed",
        parsed.data.summary,
      );
      if (!bundle) return missingCall(name, parsed.data.call_id);
      return {
        ok: true,
        tool: name,
        status: "closed",
        ...bundle,
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
        transcript,
      };
    }
  }

  return {
    ok: false,
    tool: name,
    error: `CALL-CODEX has no handler for ${name}`,
  };
}
