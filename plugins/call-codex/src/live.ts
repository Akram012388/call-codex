import type { ServerNotification } from "./app-server/generated/ServerNotification";
import type { ThreadItem } from "./app-server/generated/v2/ThreadItem";
import type { Turn } from "./app-server/generated/v2/Turn";
import { AppServerClient } from "./app-server/client";

type LiveTurn = {
  id: string;
  thread_id: string;
  status: string;
  started_at: number | null;
  completed_at: number | null;
  duration_ms: number | null;
  items: ThreadItem[];
  updated_at: string;
};

type LiveMonitor = {
  url: string;
  client: AppServerClient;
  ready: Promise<unknown>;
};

const MAX_TURNS_PER_THREAD = 20;

const monitors = new Map<string, LiveMonitor>();
const turnsByThread = new Map<string, Map<string, LiveTurn>>();

function stamp() {
  return new Date().toISOString();
}

function turnFromAppServer(threadId: string, turn: Turn): LiveTurn {
  return {
    id: turn.id,
    thread_id: threadId,
    status: turn.status,
    started_at: turn.startedAt,
    completed_at: turn.completedAt,
    duration_ms: turn.durationMs,
    items: [...turn.items],
    updated_at: stamp(),
  };
}

function getThreadTurns(threadId: string) {
  let turns = turnsByThread.get(threadId);
  if (!turns) {
    turns = new Map();
    turnsByThread.set(threadId, turns);
  }
  return turns;
}

function upsertTurn(threadId: string, turn: Turn) {
  const turns = getThreadTurns(threadId);
  const liveTurn = turnFromAppServer(threadId, turn);
  turns.set(turn.id, liveTurn);
  pruneThreadTurns(turns);
  return liveTurn;
}

function ensureTurn(threadId: string, turnId: string): LiveTurn {
  const turns = getThreadTurns(threadId);
  let turn = turns.get(turnId);
  if (!turn) {
    turn = {
      id: turnId,
      thread_id: threadId,
      status: "inProgress",
      started_at: null,
      completed_at: null,
      duration_ms: null,
      items: [],
      updated_at: stamp(),
    };
    turns.set(turnId, turn);
    pruneThreadTurns(turns);
  }
  return turn;
}

function pruneThreadTurns(turns: Map<string, LiveTurn>) {
  if (turns.size <= MAX_TURNS_PER_THREAD) return;
  const ordered = [...turns.values()].sort(
    (a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at),
  );
  for (const turn of ordered.slice(0, turns.size - MAX_TURNS_PER_THREAD)) {
    turns.delete(turn.id);
  }
}

function upsertItem(turn: LiveTurn, item: ThreadItem) {
  const index = turn.items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    turn.items[index] = item;
  } else {
    turn.items.push(item);
  }
  turn.updated_at = stamp();
}

function appendAgentDelta(input: {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}) {
  const turn = ensureTurn(input.threadId, input.turnId);
  const item = turn.items.find(
    (candidate): candidate is Extract<ThreadItem, { type: "agentMessage" }> =>
      candidate.type === "agentMessage" && candidate.id === input.itemId,
  );
  if (item) {
    item.text += input.delta;
  } else {
    turn.items.push({
      type: "agentMessage",
      id: input.itemId,
      text: input.delta,
      phase: null,
      memoryCitation: null,
    });
  }
  turn.updated_at = stamp();
}

export function handleLiveNotification(notification: ServerNotification) {
  if (notification.method === "turn/started") {
    upsertTurn(notification.params.threadId, notification.params.turn);
    return;
  }

  if (notification.method === "turn/completed") {
    upsertTurn(notification.params.threadId, notification.params.turn);
    return;
  }

  if (notification.method === "item/completed") {
    const turn = ensureTurn(
      notification.params.threadId,
      notification.params.turnId,
    );
    upsertItem(turn, notification.params.item);
    return;
  }

  if (notification.method === "item/agentMessage/delta") {
    appendAgentDelta({
      threadId: notification.params.threadId,
      turnId: notification.params.turnId,
      itemId: notification.params.itemId,
      delta: notification.params.delta,
    });
  }
}

export function ensureLiveMonitor(url: string) {
  const existing = monitors.get(url);
  if (existing) return existing;

  const client = new AppServerClient(url, { requestTimeoutMs: 15_000 });
  client.onNotification(handleLiveNotification);
  const monitor = {
    url,
    client,
    ready: client.initialize(),
  };
  monitors.set(url, monitor);
  monitor.ready.catch(() => {
    monitors.delete(url);
    client.close();
  });
  return monitor;
}

export function getLiveTurn(threadId: string, turnId: string) {
  return turnsByThread.get(threadId)?.get(turnId) ?? null;
}

export function listLiveTurns(threadId: string) {
  return [...(turnsByThread.get(threadId)?.values() ?? [])];
}

export function resetLiveStateForTests() {
  for (const monitor of monitors.values()) {
    monitor.client.close();
  }
  monitors.clear();
  turnsByThread.clear();
}
