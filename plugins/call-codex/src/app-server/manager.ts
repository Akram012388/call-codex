import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { getRuntime, upsertRuntime } from "../bus";

export type BootOptions = {
  forceRestart?: boolean;
  requireNative?: boolean;
};

export type AppServerBackend = "macos_app" | "managed";

const APP_SERVER_URL_ENV_KEYS = [
  "CALL_CODEX_APP_SERVER_URL",
  "CODEX_APP_SERVER_URL",
  "CODEX_APP_SERVER_WEBSOCKET_URL",
  "CODEX_LOCAL_APP_SERVER_URL",
];

function getNativeAppServerUrl() {
  for (const key of APP_SERVER_URL_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value?.startsWith("ws://127.0.0.1:")) {
      return value;
    }
  }
  return null;
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

async function waitForWebSocket(url: string, timeoutMs = 5000) {
  const start = Date.now();
  let lastError = "not connected";

  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(url);
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
    const nativeUrl = getNativeAppServerUrl();
    if (nativeUrl) {
      await waitForWebSocket(nativeUrl, 1200);
      return {
        reused: true,
        backend: "macos_app" as AppServerBackend,
        runtime: upsertRuntime({ url: nativeUrl, pid: null, status: "running" })
      };
    }
  }

  if (options.requireNative) {
    throw new Error(
      "CALL-CODEX needs the Codex macOS app's native app-server connection for visible worker threads, but no native app-server URL was exposed to the plugin.",
    );
  }

  const existing = getRuntime();
  if (options.forceRestart) {
    killProcess(existing?.pid);
  } else if (existing && isProcessAlive(existing.pid)) {
    try {
      await waitForWebSocket(existing.url, 1200);
      return {
        reused: true,
        backend: "managed" as AppServerBackend,
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

  return {
    reused: false,
    backend: "managed" as AppServerBackend,
    runtime: upsertRuntime({ url, pid: child.pid ?? null, status: "running" })
  };
}
