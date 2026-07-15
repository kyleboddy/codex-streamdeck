import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executable = process.env.CODEX_DECK_CODEX_EXE;
if (!executable) {
  throw new Error("Set CODEX_DECK_CODEX_EXE to a runnable Codex CLI executable.");
}

class AppServerProbe {
  constructor(codexHome) {
    this.nextId = 1;
    this.pending = new Map();
    this.process = spawn(
      executable,
      ["-c", "features.code_mode_host=true", "app-server", "--stdio"],
      {
        env: { ...process.env, CODEX_HOME: codexHome },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.stderr = "";
    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.process.stdout.setEncoding("utf8");
    let buffer = "";
    this.process.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.id != null && this.pending.has(String(message.id))) {
          const { resolve, reject } = this.pending.get(String(message.id));
          this.pending.delete(String(message.id));
          if (message.error) reject(new Error(JSON.stringify(message.error)));
          else resolve(message.result);
        }
      }
    });
  }

  async initialize() {
    await this.request("initialize", {
      clientInfo: {
        name: "codex_deck_probe",
        title: "Codex Deck Probe",
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    this.notify("initialized", {});
  }

  request(method, params) {
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => {
      this.pending.set(String(id), { resolve, reject });
    });
    this.process.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return response;
  }

  notify(method, params) {
    this.process.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async close() {
    this.process.stdin.end();
    const exited = new Promise((resolve) => this.process.once("exit", resolve));
    const timeout = new Promise((resolve) => setTimeout(resolve, 2_000));
    await Promise.race([exited, timeout]);
    if (this.process.exitCode == null) this.process.kill();
  }
}

const codexHome = await mkdtemp(join(tmpdir(), "codex-deck-probe-"));
let first;
let second;
let third;
try {
  first = new AppServerProbe(codexHome);
  await first.initialize();
  const started = await first.request("thread/start", {
    cwd: process.cwd(),
    model: "gpt-5.4",
    config: { model_reasoning_effort: "low" },
  });
  const threadId = started.thread.id;
  await first.request("thread/inject_items", {
    threadId,
    items: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Codex Deck persistence probe" }],
      },
    ],
  });
  await first.close();
  first = undefined;

  second = new AppServerProbe(codexHome);
  await second.initialize();
  const overriddenResume = await second.request("thread/resume", {
    threadId,
    excludeTurns: true,
    model: "gpt-5.4",
    config: { model_reasoning_effort: "high" },
  });
  await second.close();
  second = undefined;

  third = new AppServerProbe(codexHome);
  await third.initialize();
  const resumed = await third.request("thread/resume", {
    threadId,
    excludeTurns: true,
  });
  console.log(
    JSON.stringify(
      {
        threadId,
        requested: { model: "gpt-5.4", reasoningEffort: "high" },
        overriddenResume: {
          model: overriddenResume.model,
          reasoningEffort: overriddenResume.reasoningEffort,
        },
        resumed: {
          model: resumed.model,
          reasoningEffort: resumed.reasoningEffort,
        },
        persistedAcrossProcesses:
          resumed.model === "gpt-5.4" && resumed.reasoningEffort === "high",
      },
      null,
      2,
    ),
  );
} finally {
  if (first) await first.close();
  if (second) await second.close();
  if (third) await third.close();
  await rm(codexHome, { recursive: true, force: true });
}
