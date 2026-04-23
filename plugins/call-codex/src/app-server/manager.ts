import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { getRuntime, upsertRuntime } from "../bus";

export type BootOptions = {
  forceRestart?: boolean;
};

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
  const existing = getRuntime();
  if (options.forceRestart) {
    killProcess(existing?.pid);
  } else if (existing && isProcessAlive(existing.pid)) {
    try {
      await waitForWebSocket(existing.url, 1200);
      return {
        reused: true,
        runtime: upsertRuntime({ url: existing.url, pid: existing.pid, status: "running" })
      };
    } catch {
      killProcess(existing.pid);
    }
  }

  const port = await getFreePort();
  const url = `ws://127.0.0.1:${port}`;
  const child = spawn("codex", ["app-server", "--listen", url], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  await waitForWebSocket(url);

  return {
    reused: false,
    runtime: upsertRuntime({ url, pid: child.pid ?? null, status: "running" })
  };
}
