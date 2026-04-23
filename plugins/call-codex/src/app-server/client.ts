import type { ThreadStartParams } from "./generated/v2/ThreadStartParams";
import type { TurnStartParams } from "./generated/v2/TurnStartParams";

export type ManagedAppServerState = {
  url: string;
  pid?: number;
  startedAt?: string;
};

export type PlannedThreadStart = Pick<ThreadStartParams, "cwd" | "developerInstructions" | "persistExtendedHistory">;

export type PlannedTurnStart = Pick<TurnStartParams, "threadId" | "input" | "cwd">;

export function describeManagedAppServer(state?: ManagedAppServerState) {
  return {
    required: true,
    managed: true,
    bind: "127.0.0.1",
    state: state ?? null
  };
}
