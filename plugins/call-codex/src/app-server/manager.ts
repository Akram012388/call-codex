import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { getRuntime, upsertRuntime } from "../bus";

export type BootOptions = {
  forceRestart?: boolean;
  requireNative?: boolean;
};

export type AppServerBackend = "macos_app" | "managed";

export type AppServerAuth = {
  headers: Record<string, string>;
  source: "native_token_file";
};

export type AppServerDiscovery = {
  backend: AppServerBackend | "unavailable";
  source:
    | "native_env"
    | "dev_override"
    | "managed_runtime"
    | "managed_spawn"
    | "unavailable";
  url: string | null;
  auth?: AppServerAuth;
  reason?: string;
};

const NATIVE_URL_ENV_KEY = "CODEX_NATIVE_APP_SERVER_URL";
const NATIVE_BACKEND_ENV_KEY = "CODEX_NATIVE_APP_SERVER_BACKEND";
const NATIVE_AUTH_TOKEN_FILE_ENV_KEY =
  "CODEX_NATIVE_APP_SERVER_AUTH_TOKEN_FILE";
const DEV_URL_ENV_KEY = "CALL_CODEX_APP_SERVER_URL";
const DEV_BACKEND_ENV_KEY = "CALL_CODEX_APP_SERVER_BACKEND";

function parseLoopbackWebSocket(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (
      url.protocol === "ws:" &&
      url.hostname === "127.0.0.1" &&
      url.port
    ) {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function readNativeAuth(): AppServerAuth | undefined {
  const tokenFile = process.env[NATIVE_AUTH_TOKEN_FILE_ENV_KEY]?.trim();
  if (!tokenFile) return undefined;

  const token = readFileSync(tokenFile, "utf8").trim();
  if (!token) {
    throw new Error(
      "CODEX_NATIVE_APP_SERVER_AUTH_TOKEN_FILE is set, but the token file is empty.",
    );
  }

  return {
    source: "native_token_file",
    headers: { Authorization: `Bearer ${token}` },
  };
}

export function discoverAppServerBridge(): AppServerDiscovery {
  const nativeUrl = parseLoopbackWebSocket(process.env[NATIVE_URL_ENV_KEY]);
  const nativeBackend = process.env[NATIVE_BACKEND_ENV_KEY]?.trim();
  if (nativeUrl) {
    if (nativeBackend && nativeBackend !== "macos_app") {
      return {
        backend: "unavailable",
        source: "unavailable",
        url: null,
        reason:
          "CODEX_NATIVE_APP_SERVER_URL is set, but CODEX_NATIVE_APP_SERVER_BACKEND is not macos_app.",
      };
    }

    return {
      backend: "macos_app",
      source: "native_env",
      url: nativeUrl,
      auth: readNativeAuth(),
    };
  }

  if (process.env[NATIVE_URL_ENV_KEY]?.trim()) {
    return {
      backend: "unavailable",
      source: "unavailable",
      url: null,
      reason:
        "CODEX_NATIVE_APP_SERVER_URL must be a ws://127.0.0.1:<port> loopback URL.",
    };
  }

  const devUrl = parseLoopbackWebSocket(process.env[DEV_URL_ENV_KEY]);
  if (devUrl) {
    const backend =
      process.env[DEV_BACKEND_ENV_KEY]?.trim() === "macos_app"
        ? "macos_app"
        : "managed";
    return {
      backend,
      source: "dev_override",
      url: devUrl,
    };
  }

  return {
    backend: "unavailable",
    source: "unavailable",
    url: null,
  };
}

function isProcessAlive(pid: number | null | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcess(pid: number | null | undefined) {
  if (!pid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone. That is fine for a managed local process.
  }
}

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Unable to allocate a loopback port"));
        }
      });
    });
  });
}

function openWebSocket(url: string, auth?: AppServerAuth) {
  const WebSocketClient = WebSocket as unknown as new (
    url: string,
    options?: { headers?: Record<string, string> },
  ) => WebSocket;
  return auth
    ? new WebSocketClient(url, { headers: auth.headers })
    : new WebSocketClient(url);
}

async function waitForWebSocket(
  url: string,
  timeoutMs = 5000,
  auth?: AppServerAuth,
) {
  const start = Date.now();
  let lastError = "not connected";

  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const ws = openWebSocket(url, auth);
      const timer = setTimeout(() => {
        lastError = "timed out";
        ws.close();
        resolve(false);
      }, 500);

      ws.onopen = () => {
        clearTimeout(timer);
        ws.close();
        resolve(true);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        lastError = "connection failed";
        resolve(false);
      };
    });

    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Codex app-server did not become reachable: ${lastError}`);
}

export async function bootManagedAppServer(options: BootOptions = {}) {
  if (!options.forceRestart) {
    const bridge = discoverAppServerBridge();
    if (bridge.reason) {
      if (options.requireNative) {
        throw new Error(bridge.reason);
      }
    } else if (bridge.url) {
      if (options.requireNative && bridge.backend !== "macos_app") {
        throw new Error(
          "CALL-CODEX needs the native app-server bridge CODEX_NATIVE_APP_SERVER_URL from the Codex macOS app runtime for visible worker threads. CALL_CODEX_APP_SERVER_URL is only a macOS-visible dev override when CALL_CODEX_APP_SERVER_BACKEND=macos_app.",
        );
      }
      await waitForWebSocket(bridge.url, 1200, bridge.auth);
      return {
        reused: true,
        backend: bridge.backend,
        discovery: bridge,
        auth: bridge.auth,
        runtime: upsertRuntime({
          url: bridge.url,
          pid: null,
          status: "running",
        }),
      };
    }
  }

  if (options.requireNative) {
    throw new Error(
      "CALL-CODEX needs the native app-server bridge CODEX_NATIVE_APP_SERVER_URL from the Codex macOS app runtime for visible worker threads, but no native bridge was exposed to the plugin.",
    );
  }

  const existing = getRuntime();
  if (options.forceRestart) {
    killProcess(existing?.pid);
  } else if (existing && isProcessAlive(existing.pid)) {
    try {
      await waitForWebSocket(existing.url, 1200);
      const discovery: AppServerDiscovery = {
        backend: "managed",
        source: "managed_runtime",
        url: existing.url,
      };
      return {
        reused: true,
        backend: "managed" as AppServerBackend,
        discovery,
        runtime: upsertRuntime({ url: existing.url, pid: existing.pid, status: "running" })
      };
    } catch {
      killProcess(existing.pid);
    }
  }

  const port = await getFreePort();
  const url = `ws://127.0.0.1:${port}`;
  const child = spawn("codex", ["app-server", "--listen", url], {
    cwd: homedir(),
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  await waitForWebSocket(url);
  const discovery: AppServerDiscovery = {
    backend: "managed",
    source: "managed_spawn",
    url,
  };

  return {
    reused: false,
    backend: "managed" as AppServerBackend,
    discovery,
    runtime: upsertRuntime({ url, pid: child.pid ?? null, status: "running" })
  };
}
