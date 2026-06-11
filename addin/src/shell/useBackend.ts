import { useState, useEffect, useRef, useCallback } from "react";
import { healthCheck } from "./api";

export type BackendStatus = "starting" | "ready" | "error" | "offline";

interface BackendState {
  status: BackendStatus;
  modelName?: string;
}

const BACKEND_PORT = 8766;
const POLL_INTERVAL_MS = 2_000;
const MAX_WAIT_MS = 30_000;

function spawnBackend(): void {
  // child_process is available in the Office Add-in Electron/Node runtime.
  // In a plain browser context this will throw — caught below.
  const { spawn } = require("child_process") as typeof import("child_process");
  const home = require("os").homedir();
  const certDir = require("path").join(home, ".office-addin-dev-certs");
  const proc = spawn(
    "uvicorn",
    [
      "main:app",
      "--port", String(BACKEND_PORT),
      "--host", "127.0.0.1",
      "--ssl-keyfile", require("path").join(certDir, "localhost.key"),
      "--ssl-certfile", require("path").join(certDir, "localhost.crt"),
    ],
    {
      cwd: require("path").resolve(__dirname, "../../backend"),
      detached: false,
      stdio: "ignore",
      env: { ...process.env },
    }
  );
  proc.unref();  // don't block Word from closing
}

export function useBackend(_workspaceDocPath?: string) {
  const [state, setState] = useState<BackendState>({ status: "starting" });
  const spawnedRef = useRef(false);

  const pollHealth = useCallback(async (startedAt: number): Promise<void> => {
    const ok = await healthCheck();
    if (ok) {
      setState({ status: "ready" });
      return;
    }
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      setState({ status: "error" });
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    return pollHealth(startedAt);
  }, []);

  useEffect(() => {
    if (spawnedRef.current) return;
    spawnedRef.current = true;

    healthCheck().then((already) => {
      if (already) {
        setState({ status: "ready" });
        return;
      }
      // Try to spawn
      try {
        spawnBackend();
      } catch {
        // Not in Node runtime (e.g. browser-only test) — skip spawn, poll anyway
      }
      pollHealth(Date.now());
    });
  }, [pollHealth]);

  // Restart on crash: re-poll every 5s when ready, re-spawn if health fails
  useEffect(() => {
    if (state.status !== "ready") return;
    const interval = setInterval(async () => {
      const ok = await healthCheck();
      if (!ok) {
        setState({ status: "starting" });
        try { spawnBackend(); } catch { /* not in node runtime */ }
        pollHealth(Date.now());
      }
    }, 5_000);
    return () => clearInterval(interval);
  }, [state.status, pollHealth]);

  return state;
}
