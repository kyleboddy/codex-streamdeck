"use strict";

const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { createServer } = require("node:net");
const {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");

const APP_DATA_ROOT = join(process.env.LOCALAPPDATA || tmpdir(), "CodexDeck");
const LOG_PATH = join(APP_DATA_ROOT, "logs", "transport.log");
const STATE_PATH = join(APP_DATA_ROOT, "state.json");
const CONTROL_PIPE = "\\\\.\\pipe\\codex-deck-control";
const DEFAULT_SERVER_URL = "ws://127.0.0.1:47812";
const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "applyPatchApproval",
  "execCommandApproval",
]);
const THREAD_TARGETING_METHODS = new Set([
  "thread/resume",
  "thread/read",
  "thread/settings/update",
  "thread/fork",
  "thread/archive",
  "thread/compact/start",
  "thread/rollback",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "review/start",
]);

mkdirSync(dirname(LOG_PATH), { recursive: true });

function log(message) {
  try {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // Logging must never disrupt the protocol transport.
  }
}

function userArgs() {
  const values = process.argv.slice(1);
  if (values[0] && resolve(values[0]) === resolve(process.execPath)) values.shift();
  return values;
}

function realCliPath() {
  const configured = process.env.CODEX_DECK_REAL_CLI?.trim();
  const value = configured || join(APP_DATA_ROOT, "runtime", "codex-real.exe");
  if (!existsSync(value)) {
    throw new Error(`Real Codex CLI missing at ${value}; re-run scripts/install-local.ps1.`);
  }
  return resolve(value);
}

function shouldBridgeAppServer(args) {
  const index = args.indexOf("app-server");
  if (index < 0) return false;
  const subcommands = new Set([
    "daemon",
    "proxy",
    "generate-ts",
    "generate-json-schema",
    "help",
  ]);
  const optionsWithValues = new Set([
    "--listen",
    "--ws-auth",
    "--ws-token-file",
    "--ws-token-sha256",
    "--ws-shared-secret-file",
    "--ws-issuer",
    "--ws-audience",
    "--ws-max-clock-skew-seconds",
  ]);
  for (let cursor = index + 1; cursor < args.length; cursor += 1) {
    const value = args[cursor];
    if (value === "--help" || value === "-h") return false;
    if (!value.startsWith("-")) return !subcommands.has(value);
    if (optionsWithValues.has(value)) cursor += 1;
  }
  return true;
}

function cleanEnvironment() {
  const environment = { ...process.env };
  delete environment.CODEX_CLI_PATH;
  return environment;
}

async function delegate(executable, args) {
  const child = spawn(executable, args, {
    env: cleanEnvironment(),
    stdio: "inherit",
    windowsHide: true,
  });
  return new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) done(1);
      else done(code ?? 1);
    });
  });
}

function wait(milliseconds) {
  return new Promise((done) => setTimeout(done, milliseconds));
}

async function connectWebSocket(url, timeoutMs) {
  const socket = new WebSocket(url);
  let timer;
  try {
    await new Promise((done, reject) => {
      timer = setTimeout(() => reject(new Error("WebSocket connection timed out")), timeoutMs);
      socket.addEventListener("open", done, { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), {
        once: true,
      });
    });
    return socket;
  } catch (error) {
    try {
      socket.close();
    } catch {
      // The opening handshake may not have created a closeable socket.
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function canConnect(url, timeoutMs = 250) {
  try {
    const socket = await connectWebSocket(url, timeoutMs);
    socket.close(1000, "health check");
    return true;
  } catch {
    return false;
  }
}

function sharedServerArgs(desktopArgs, url) {
  const result = [];
  for (let index = 0; index < desktopArgs.length; index += 1) {
    const value = desktopArgs[index];
    if (value === "--stdio") continue;
    if (value === "--listen") {
      index += 1;
      continue;
    }
    result.push(value);
  }
  result.push("--listen", url);
  return result;
}

async function acquireBootstrapLock() {
  const path = join(APP_DATA_ROOT, "bootstrap.lock");
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const descriptor = openSync(path, "wx");
      writeFileSync(descriptor, `${process.pid}\n${new Date().toISOString()}\n`);
      return () => {
        try {
          closeSync(descriptor);
          rmSync(path, { force: true });
        } catch {
          // A stale lock is recovered by timestamp on the next start.
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > 30_000) rmSync(path, { force: true });
      } catch {
        // Another process may have released it between checks.
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for app-server bootstrap");
      await wait(100);
    }
  }
}

async function ensureSharedServer(executable, desktopArgs, url) {
  if (await canConnect(url)) return;
  const release = await acquireBootstrapLock();
  try {
    if (await canConnect(url)) return;
    const logDescriptor = openSync(LOG_PATH, "a");
    const child = spawn(executable, sharedServerArgs(desktopArgs, url), {
      env: cleanEnvironment(),
      stdio: ["ignore", logDescriptor, logDescriptor],
      windowsHide: true,
    });
    closeSync(logDescriptor);
    child.unref();
    child.on("exit", (code, signal) => log(`app-server exit code=${code} signal=${signal}`));
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (child.exitCode != null) throw new Error(`Shared app-server exited ${child.exitCode}`);
      if (await canConnect(url, 300)) {
        log(`shared app-server ready at ${url}`);
        return;
      }
      await wait(150);
    }
    throw new Error(`Shared app-server did not open ${url}`);
  } finally {
    release();
  }
}

class BridgeState {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.connectedAt = new Date().toISOString();
    this.activeThreadId = null;
    this.activeTurnId = null;
    this.desktopRequests = new Map();
    this.approvals = [];
    this.save();
  }

  observeDesktop(json) {
    try {
      const message = JSON.parse(json);
      const id = message.id == null ? null : JSON.stringify(message.id);
      if (message.method && id) this.desktopRequests.set(id, message.method);
      if (THREAD_TARGETING_METHODS.has(message.method) && message.params?.threadId) {
        this.activeThreadId = message.params.threadId;
      }
      if (!message.method && id) {
        this.approvals = this.approvals.filter((item) => item.idJson !== id);
      }
      this.save();
    } catch {
      // Observation is deliberately best effort.
    }
  }

  observeServer(json) {
    try {
      const message = JSON.parse(json);
      const id = message.id == null ? null : JSON.stringify(message.id);
      if (message.method && id && APPROVAL_METHODS.has(message.method)) {
        this.approvals = this.approvals.filter((item) => item.idJson !== id);
        this.approvals.push({ idJson: id, method: message.method, params: message.params || {} });
        if (message.params?.threadId) this.activeThreadId = message.params.threadId;
      } else if (message.method === "turn/started") {
        this.activeThreadId = message.params?.threadId || this.activeThreadId;
        this.activeTurnId = message.params?.turn?.id || null;
      } else if (message.method === "turn/completed") {
        if (message.params?.turn?.id === this.activeTurnId) this.activeTurnId = null;
      } else if (!message.method && id) {
        const requestMethod = this.desktopRequests.get(id);
        this.desktopRequests.delete(id);
        if (["thread/start", "thread/resume", "thread/fork"].includes(requestMethod)) {
          this.activeThreadId = message.result?.thread?.id || this.activeThreadId;
        }
      }
      this.save();
    } catch {
      // Observation is deliberately best effort.
    }
  }

  snapshot() {
    return {
      ok: true,
      serverUrl: this.serverUrl,
      connectedAt: this.connectedAt,
      activeThreadId: this.activeThreadId,
      activeTurnId: this.activeTurnId,
      pendingApprovalCount: this.approvals.length,
      pendingApprovalMethod: this.approvals.at(-1)?.method || null,
    };
  }

  takeApproval() {
    const value = this.approvals.pop() || null;
    this.save();
    return value;
  }

  restoreApproval(value) {
    this.approvals.push(value);
    this.save();
  }

  save() {
    try {
      mkdirSync(dirname(STATE_PATH), { recursive: true });
      const temporary = `${STATE_PATH}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.snapshot(), null, 2), "utf8");
      renameSync(temporary, STATE_PATH);
    } catch {
      // State is diagnostic; the live named pipe remains authoritative.
    }
  }
}

function grantedPermissions(requested) {
  const result = {};
  if (requested?.network != null) result.network = requested.network;
  if (requested?.fileSystem != null) result.fileSystem = requested.fileSystem;
  return result;
}

function approvalResult(pending, approve) {
  if (
    pending.method === "item/commandExecution/requestApproval" ||
    pending.method === "item/fileChange/requestApproval"
  ) {
    return { decision: approve ? "accept" : "decline" };
  }
  if (pending.method === "item/permissions/requestApproval") {
    return {
      permissions: approve ? grantedPermissions(pending.params.permissions) : {},
      scope: "turn",
    };
  }
  if (pending.method === "applyPatchApproval" || pending.method === "execCommandApproval") {
    return { decision: approve ? "approved" : "denied" };
  }
  throw new Error(`Approval method ${pending.method} is not hardware-safe`);
}

function createControlServer(state, sendToServer) {
  const server = createServer((connection) => {
    connection.setEncoding("utf8");
    let buffer = "";
    connection.on("data", async (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let response;
      try {
        const request = JSON.parse(line);
        if (request.command === "state") {
          response = state.snapshot();
        } else if (request.command === "rpc") {
          if (typeof request.method !== "string" || !request.method) {
            throw new Error("rpc command requires a method");
          }
          const message = JSON.stringify({
            jsonrpc: "2.0",
            id: `codex-deck-${randomUUID()}`,
            method: request.method,
            params: request.params ?? {},
          });
          state.observeDesktop(message);
          await sendToServer(message);
          response = { ok: true, method: request.method, accepted: true };
        } else if (request.command === "approve" || request.command === "decline") {
          const pending = state.takeApproval();
          if (!pending) {
            response = { ok: false, error: "no pending approval" };
          } else {
            try {
              await sendToServer(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: JSON.parse(pending.idJson),
                  result: approvalResult(pending, request.command === "approve"),
                }),
              );
              response = { ok: true, method: pending.method, decision: request.command };
            } catch (error) {
              state.restoreApproval(pending);
              throw error;
            }
          }
        } else {
          response = { ok: false, error: "unknown command" };
        }
      } catch (error) {
        response = { ok: false, error: error.message };
      }
      connection.end(`${JSON.stringify(response)}\n`);
    });
  });
  server.on("error", (error) => log(`control pipe error: ${error.stack || error}`));
  try {
    server.listen(CONTROL_PIPE);
  } catch (error) {
    log(`control pipe listen error: ${error.stack || error}`);
  }
  return server;
}

async function runBridge(executable, args, serverUrl) {
  await ensureSharedServer(executable, args, serverUrl);
  const socket = await connectWebSocket(serverUrl, 10_000);
  const state = new BridgeState(serverUrl);
  let sendChain = Promise.resolve();
  const send = (json) => {
    sendChain = sendChain.then(() => {
      if (socket.readyState !== WebSocket.OPEN) throw new Error("app-server is not connected");
      socket.send(json);
    });
    return sendChain;
  };
  const control = createControlServer(state, send);
  process.stdin.setEncoding("utf8");
  let stdinBuffer = "";

  process.stdin.on("data", (chunk) => {
    stdinBuffer += chunk;
    for (;;) {
      const newline = stdinBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = stdinBuffer.slice(0, newline).trim();
      stdinBuffer = stdinBuffer.slice(newline + 1);
      if (!line) continue;
      state.observeDesktop(line);
      void send(line).catch((error) => log(`desktop send failed: ${error.stack || error}`));
    }
  });
  socket.addEventListener("message", (event) => {
    const json = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString();
    state.observeServer(json);
    process.stdout.write(`${json}\n`);
  });

  return new Promise((done) => {
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      try {
        control.close();
      } catch {
        // The control server may not have acquired its pipe yet.
      }
      done(code);
    };
    process.stdin.once("end", () => {
      try {
        socket.close(1000, "desktop transport closed");
      } catch {
        // The server may already be closed.
      }
      finish(0);
    });
    socket.addEventListener("close", () => finish(0), { once: true });
    socket.addEventListener("error", () => finish(1), { once: true });
  });
}

async function main() {
  const args = userArgs();
  const executable = realCliPath();
  if (!shouldBridgeAppServer(args)) return delegate(executable, args);
  const serverUrl = process.env.CODEX_DECK_SERVER_URL?.trim() || DEFAULT_SERVER_URL;
  return runBridge(executable, args, serverUrl);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    log(`fatal: ${error.stack || error}`);
    process.stderr.write(`Codex Deck transport failed: ${error.message}\n`);
    process.exitCode = 1;
  });
