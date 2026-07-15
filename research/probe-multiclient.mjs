import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "../com.driveline.codex-command-center.sdPlugin/node_modules/ws/wrapper.mjs";

const executable = process.env.CODEX_DECK_CODEX_EXE;
if (!executable) {
  throw new Error("Set CODEX_DECK_CODEX_EXE to a runnable Codex CLI executable.");
}

class RpcClient {
  constructor(url, name) {
    this.url = url;
    this.name = name;
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.id != null && this.pending.has(String(message.id))) {
        const { resolve, reject } = this.pending.get(String(message.id));
        this.pending.delete(String(message.id));
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else if (message.method) {
        this.notifications.push(message);
      }
    });
    await this.request("initialize", {
      clientInfo: { name: this.name, title: this.name, version: "0.0.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.notify("initialized", {});
  }

  request(method, params) {
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => {
      this.pending.set(String(id), { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  notify(method, params) {
    this.socket.send(JSON.stringify({ method, params }));
  }

  close() {
    this.socket.close();
  }
}

const codexHome = await mkdtemp(join(tmpdir(), "codex-deck-multiclient-"));
const port = 47_991;
const server = spawn(
  executable,
  [
    "-c",
    "features.code_mode_host=true",
    "app-server",
    "--listen",
    `ws://127.0.0.1:${port}`,
  ],
  {
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  },
);
let serverErrors = "";
server.stderr.setEncoding("utf8");
server.stderr.on("data", (chunk) => {
  serverErrors += chunk;
});

let desktop;
let deck;
try {
  const url = `ws://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      desktop = new RpcClient(url, "desktop_probe");
      await desktop.connect();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!desktop?.socket || desktop.socket.readyState !== WebSocket.OPEN) {
    throw new Error(`Server did not start. ${serverErrors}`);
  }
  deck = new RpcClient(url, "deck_probe");
  await deck.connect();

  const started = await desktop.request("thread/start", {
    cwd: process.cwd(),
    model: "gpt-5.4",
    config: { model_reasoning_effort: "low" },
  });
  const threadId = started.thread.id;
  await desktop.request("thread/inject_items", {
    threadId,
    items: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Codex Deck multi-client probe" }],
      },
    ],
  });
  await deck.request("thread/settings/update", {
    threadId,
    model: "gpt-5.4",
    effort: "high",
  });
  const resumed = await desktop.request("thread/resume", {
    threadId,
    excludeTurns: true,
  });
  const loaded = await deck.request("thread/loaded/list", {});
  console.log(
    JSON.stringify(
      {
        threadId,
        loadedThreadIds: loaded.data.map((entry) => entry.id),
        desktopSeesPeerUpdate: resumed.reasoningEffort === "high",
        resumedModel: resumed.model,
        resumedReasoningEffort: resumed.reasoningEffort,
      },
      null,
      2,
    ),
  );
} finally {
  desktop?.close();
  deck?.close();
  server.kill();
  await new Promise((resolve) => server.once("exit", resolve));
  await rm(codexHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
