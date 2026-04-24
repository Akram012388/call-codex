import type { ThreadStartParams } from "./generated/v2/ThreadStartParams";
import type { ThreadStartResponse } from "./generated/v2/ThreadStartResponse";
import type { ThreadForkParams } from "./generated/v2/ThreadForkParams";
import type { ThreadForkResponse } from "./generated/v2/ThreadForkResponse";
import type { ThreadInjectItemsParams } from "./generated/v2/ThreadInjectItemsParams";
import type { ThreadInjectItemsResponse } from "./generated/v2/ThreadInjectItemsResponse";
import type { ThreadReadParams } from "./generated/v2/ThreadReadParams";
import type { ThreadReadResponse } from "./generated/v2/ThreadReadResponse";
import type { ThreadSetNameParams } from "./generated/v2/ThreadSetNameParams";
import type { ThreadSetNameResponse } from "./generated/v2/ThreadSetNameResponse";
import type { TurnStartParams } from "./generated/v2/TurnStartParams";
import type { TurnStartResponse } from "./generated/v2/TurnStartResponse";
import type { TurnSteerParams } from "./generated/v2/TurnSteerParams";
import type { TurnSteerResponse } from "./generated/v2/TurnSteerResponse";
import type { TurnInterruptParams } from "./generated/v2/TurnInterruptParams";
import type { TurnInterruptResponse } from "./generated/v2/TurnInterruptResponse";
import type { InitializeResponse } from "./generated/InitializeResponse";
import type { ServerNotification } from "./generated/ServerNotification";
import type { JsonValue } from "./generated/serde_json/JsonValue";
import type { UserInput } from "./generated/v2/UserInput";

export type ManagedAppServerState = {
  url: string;
  pid?: number;
  startedAt?: string;
};

export type PlannedThreadStart = Pick<
  ThreadStartParams,
  "cwd" | "developerInstructions" | "persistExtendedHistory"
>;

export type PlannedTurnStart = Pick<
  TurnStartParams,
  "threadId" | "input" | "cwd"
>;

export function describeManagedAppServer(state?: ManagedAppServerState) {
  return {
    required: true,
    managed: true,
    bind: "127.0.0.1",
    state: state ?? null,
  };
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ServerResponse = {
  id?: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
  method?: string;
  params?: unknown;
};

export type AppServerClientOptions = {
  requestTimeoutMs?: number;
};

export type AppServerNotificationHandler = (
  notification: ServerNotification,
) => void;

export class AppServerClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers = new Set<AppServerNotificationHandler>();
  private initialized = false;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly url: string,
    options: AppServerClientOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  }

  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      const timer = setTimeout(() => {
        socket.close();
        reject(
          new Error(`Timed out connecting to Codex app-server at ${this.url}`),
        );
      }, this.requestTimeoutMs);

      socket.onopen = () => {
        clearTimeout(timer);
        resolve(socket);
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(
          new Error(`Could not connect to Codex app-server at ${this.url}`),
        );
      };
    });

    this.ws.onmessage = (event) => this.handleMessage(event.data);
    this.ws.onclose = () =>
      this.rejectAll(new Error("Codex app-server connection closed"));
    this.ws.onerror = () =>
      this.rejectAll(new Error("Codex app-server connection failed"));
  }

  async initialize() {
    if (this.initialized) return null;
    await this.connect();
    const result = await this.request<InitializeResponse>("initialize", {
      clientInfo: {
        name: "call-codex",
        title: "CALL-CODEX",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: [],
      },
    });
    this.initialized = true;
    return result;
  }

  async startThread(params: ThreadStartParams) {
    await this.initialize();
    return this.request<ThreadStartResponse>("thread/start", params);
  }

  async forkThread(params: ThreadForkParams) {
    await this.initialize();
    return this.request<ThreadForkResponse>("thread/fork", params);
  }

  async startTurn(params: TurnStartParams) {
    await this.initialize();
    return this.request<TurnStartResponse>("turn/start", params);
  }

  async steerTurn(params: TurnSteerParams) {
    await this.initialize();
    return this.request<TurnSteerResponse>("turn/steer", params);
  }

  async interruptTurn(params: TurnInterruptParams) {
    await this.initialize();
    return this.request<TurnInterruptResponse>("turn/interrupt", params);
  }

  async injectItems(params: ThreadInjectItemsParams) {
    await this.initialize();
    return this.request<ThreadInjectItemsResponse>(
      "thread/inject_items",
      params,
    );
  }

  async readThread(params: ThreadReadParams) {
    await this.initialize();
    return this.request<ThreadReadResponse>("thread/read", params);
  }

  async setThreadName(params: ThreadSetNameParams) {
    await this.initialize();
    return this.request<ThreadSetNameResponse>("thread/name/set", params);
  }

  onNotification(handler: AppServerNotificationHandler) {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  close() {
    this.ws?.close();
    this.ws = null;
    this.initialized = false;
    this.rejectAll(new Error("Codex app-server client closed"));
  }

  private async request<T>(method: string, params: unknown): Promise<T> {
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Codex app-server is not connected");
    }

    const id = this.nextId++;
    const payload = { id, method, params };
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`Timed out waiting for Codex app-server method ${method}`),
        );
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
    });

    this.ws.send(JSON.stringify(payload));
    return promise;
  }

  private handleMessage(data: string | ArrayBufferLike | Blob) {
    if (typeof data !== "string") return;

    let message: ServerResponse;
    try {
      message = JSON.parse(data) as ServerResponse;
    } catch {
      return;
    }

    if (typeof message.id !== "number") {
      if (typeof message.method === "string") {
        for (const handler of this.notificationHandlers) {
          handler(message as ServerNotification);
        }
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(
        new Error(message.error.message ?? JSON.stringify(message.error)),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectAll(error: Error) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

export function userMessageItem(text: string): JsonValue {
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  };
}

export function textUserInput(text: string): UserInput {
  return {
    type: "text",
    text,
    text_elements: [],
  };
}
