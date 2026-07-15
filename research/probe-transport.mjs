import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexRpcClient } from "../com.driveline.codex-command-center.sdPlugin/bin/codex-client.js";

const wrapper = process.env.CODEX_DECK_TRANSPORT_EXE;
const realCli = process.env.CODEX_DECK_CODEX_EXE;
const serverUrl = process.env.CODEX_DECK_SERVER_URL || "ws://127.0.0.1:47995";
if (!wrapper || !realCli) throw new Error("Transport and real CLI paths are required");

class StdioRpcClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    child.stdout.setEncoding("utf8");
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        const pending = this.pending.get(String(message.id));
        if (pending && !message.method) {
          clearTimeout(pending.timer);
          this.pending.delete(String(message.id));
          if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
          else pending.resolve(message.result);
        }
      }
    });
  }

  request(method, params) {
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 15_000);
      this.pending.set(String(id), { resolve, reject, timer });
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return result;
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }
}

function control(command) {
  return new Promise((resolve, reject) => {
    const socket = createConnection("\\\\.\\pipe\\codex-deck-control");
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("control timeout"));
    }, 5_000);
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(command)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      const response = JSON.parse(buffer.slice(0, newline));
      if (response.ok) resolve(response);
      else reject(new Error(response.error));
    });
    socket.once("error", reject);
  });
}

const codexHome = await mkdtemp(join(tmpdir(), "codex-deck-transport-probe-"));
const localAppData = await mkdtemp(join(tmpdir(), "codex-deck-localappdata-probe-"));
const child = spawn(
  wrapper,
  ["-c", "features.code_mode_host=true", "app-server", "--stdio"],
  {
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_DECK_REAL_CLI: realCli,
      CODEX_DECK_SERVER_URL: serverUrl,
      LOCALAPPDATA: localAppData,
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  },
);
let errors = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  errors += chunk;
});
const desktop = new StdioRpcClient(child);
const deck = new CodexRpcClient({ logger: {}, url: serverUrl });
let failure = null;

try {
  await desktop.request("initialize", {
    clientInfo: { name: "desktop_probe", title: "Desktop Probe", version: "0.0.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  process.stderr.write("probe: desktop initialized\n");
  desktop.notify("initialized", {});
  await deck.connect();
  process.stderr.write("probe: Stream Deck peer connected\n");
  const started = await desktop.request("thread/start", {
    cwd: process.cwd(),
    model: "gpt-5.6-sol",
    config: { model_reasoning_effort: "medium" },
  });
  const threadId = started.thread.id;
  process.stderr.write(`probe: thread ${threadId} started\n`);
  await desktop.request("thread/inject_items", {
    threadId,
    items: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Codex Deck transport probe" }],
      },
    ],
  });
  await deck.request("thread/settings/update", {
    threadId,
    model: "gpt-5.6-sol",
    effort: "ultra",
  });
  const peerUpdated = await desktop.request("thread/resume", { threadId, excludeTurns: true });
  process.stderr.write("probe: peer update observed by desktop\n");
  const state = await control({ command: "state" });
  await control({
    command: "rpc",
    method: "thread/settings/update",
    params: { threadId, effort: "max" },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const injectedUpdate = await deck.request("thread/resume", { threadId, excludeTurns: true });
  process.stderr.write("probe: desktop injection observed by peer\n");
  console.log(
    JSON.stringify(
      {
        threadId,
        wrapperTrackedActiveThread: state.activeThreadId === threadId,
        peerUpdateVisibleToDesktop: peerUpdated.reasoningEffort === "ultra",
        desktopInjectionVisibleToPeer: injectedUpdate.reasoningEffort === "max",
        serverUrl,
        codexHome,
        localAppData,
      },
      null,
      2,
    ),
  );
  const holdMs = Number.parseInt(process.env.CODEX_DECK_PROBE_HOLD_MS || "0", 10);
  if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
} catch (error) {
  failure = new Error(`${error.message}\n${errors}`);
} finally {
  deck.socket?.terminate();
  child.stdin.end();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode == null) child.kill();
}

if (failure) {
  process.stderr.write(`${failure.stack || failure}\n`);
  process.exit(1);
}
process.exit(0);
