import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { CodexRpcClient } from "./codex-client.js";
import { activityFromBridgeSnapshot } from "./sentinel.js";

const CONTROL_PIPE = "\\\\.\\pipe\\codex-deck-control";
const CONFIG_PATH = join(process.env.LOCALAPPDATA || process.cwd(), "CodexDeck", "deck-config.json");
const CUSTOM_ACTIONS = new Set([
  "new-task",
  "review",
  "approve",
  "decline",
  "stop",
  "fork",
  "skills",
  "settings",
]);

export const EFFORTS = [
  { value: "low", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
  { value: "ultra", label: "Ultra" },
];

const DEFAULT_CONFIG = {
  version: 1,
  selection: { model: null, effort: "high" },
  blanks: {
    blank1: { title: "", type: "none", value: "" },
    blank2: { title: "", type: "none", value: "" },
  },
};

function mergeConfig(value) {
  return {
    ...DEFAULT_CONFIG,
    ...value,
    selection: { ...DEFAULT_CONFIG.selection, ...value?.selection },
    blanks: {
      blank1: { ...DEFAULT_CONFIG.blanks.blank1, ...value?.blanks?.blank1 },
      blank2: { ...DEFAULT_CONFIG.blanks.blank2, ...value?.blanks?.blank2 },
    },
  };
}

function readConfig(logger) {
  try {
    if (!existsSync(CONFIG_PATH)) return structuredClone(DEFAULT_CONFIG);
    return mergeConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
  } catch (error) {
    logger?.error?.(`Could not read ${CONFIG_PATH}: ${error.message}`);
    return structuredClone(DEFAULT_CONFIG);
  }
}

function writeConfig(config) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  const temporary = `${CONFIG_PATH}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  renameSync(temporary, CONFIG_PATH);
}

function step(items, value, ticks) {
  if (!items.length) return undefined;
  const current = Math.max(0, items.findIndex((item) => item.value === value));
  const delta = Number.isFinite(ticks) ? Math.trunc(ticks) : 0;
  const index = ((current + delta) % items.length + items.length) % items.length;
  return items[index];
}

function openCodexUri(uri) {
  if (!uri) throw new Error("No URI configured");
  const child = spawn("explorer.exe", [uri], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return { ok: true, uri };
}

export function controlCommand(command, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(CONTROL_PIPE);
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Codex desktop transport is not responding"));
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(command)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (!response.ok) reject(new Error(response.error || "Codex control command failed"));
        else resolve(response);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export class CodexDeckController extends EventEmitter {
  constructor({ logger, rpc, control = controlCommand, openUri = openCodexUri } = {}) {
    super();
    this.logger = logger;
    this.rpc = rpc || new CodexRpcClient({ logger });
    this.control = control;
    this.openUri = openUri;
    this.config = readConfig(logger);
    this.models = [];
    this.queue = Promise.resolve();
    this.activityState = "disconnected";
    this.activitySnapshot = null;
    this.rpc.on("notification", (message) => this.#observeNotification(message));
  }

  async initialize() {
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      await this.rpc.connect();
      await this.refreshModels();
      this.emit("selection", this.selection());
    })().finally(() => {
      this.initializing = null;
    });
    return this.initializing;
  }

  startAutoReconnect() {
    if (this.reconnectTimer) return;
    const retry = () => {
      if (this.rpc.connected && this.models.length) return;
      void this.initialize().catch((error) => {
        this.logger?.debug?.(`Codex Deck waiting for desktop transport: ${error.message}`);
      });
    };
    retry();
    this.reconnectTimer = setInterval(retry, 2_000);
    this.reconnectTimer.unref?.();
  }

  activity() {
    return { state: this.activityState, snapshot: this.activitySnapshot };
  }

  async refreshActivity() {
    try {
      const snapshot = await this.control({ command: "state" });
      this.#setActivity(activityFromBridgeSnapshot(snapshot), snapshot);
    } catch (error) {
      this.logger?.debug?.(`Codex activity unavailable: ${error.message}`);
      this.#setActivity("disconnected", null);
    }
    return this.activity();
  }

  startActivityMonitor(intervalMs = 500) {
    if (this.activityTimer) return;
    const poll = async () => {
      if (this.activityPollPending) return;
      this.activityPollPending = true;
      try {
        await this.refreshActivity();
      } finally {
        this.activityPollPending = false;
      }
    };
    void poll();
    this.activityTimer = setInterval(() => void poll(), intervalMs);
    this.activityTimer.unref?.();
  }

  stopActivityMonitor() {
    if (!this.activityTimer) return;
    clearInterval(this.activityTimer);
    this.activityTimer = null;
  }

  selection() {
    return { ...this.config.selection };
  }

  effortOptions() {
    return EFFORTS;
  }

  modelOptions() {
    if (this.models.length) {
      return this.models.map((model) => ({
        value: model.id,
        label: model.displayName || model.id,
        description: model.description,
        efforts: model.supportedReasoningEfforts || [],
        defaultEffort: model.defaultReasoningEffort,
      }));
    }
    const current = this.config.selection.model;
    return current ? [{ value: current, label: current }] : [{ value: "loading", label: "Connecting..." }];
  }

  async refreshModels() {
    this.models = await this.rpc.listModels();
    const options = this.modelOptions();
    if (!options.some((model) => model.value === this.config.selection.model)) {
      const preferred = options.find((model) => model.value.includes("sol")) || options[0];
      this.config.selection.model = preferred?.value || null;
      writeConfig(this.config);
    }
    this.emit("models", options);
    return options;
  }

  stepEffort(ticks) {
    return this.#enqueue(async () => {
      await this.#ensureReady();
      const selected = step(EFFORTS, this.config.selection.effort, ticks);
      const currentModel = this.modelOptions().find(
        (model) => model.value === this.config.selection.model,
      );
      const supported = currentModel?.efforts?.some(
        (option) => option.reasoningEffort === selected.value,
      );
      const compatibleModel = supported
        ? currentModel
        : this.modelOptions().find((model) =>
            model.efforts?.some((option) => option.reasoningEffort === selected.value),
          );
      if (!compatibleModel) {
        throw new Error(`No available Codex model supports ${selected.label}`);
      }
      await this.#applySelection({ effort: selected.value, model: compatibleModel.value });
      return selected;
    });
  }

  resetEffort() {
    return this.#enqueue(async () => {
      await this.#ensureReady();
      return this.#applySelection({ effort: "high" });
    });
  }

  stepModel(ticks) {
    return this.#enqueue(async () => {
      await this.#ensureReady();
      const options = this.modelOptions().filter((item) => item.value !== "loading");
      if (!options.length) throw new Error("Codex model catalog is not available");
      const selected = step(options, this.config.selection.model, ticks);
      const effort = selected.efforts?.some(
        (item) => item.reasoningEffort === this.config.selection.effort,
      )
        ? this.config.selection.effort
        : selected.defaultEffort || this.config.selection.effort;
      await this.#applySelection({ model: selected.value, effort });
      return selected;
    });
  }

  resetModel() {
    return this.#enqueue(async () => {
      await this.#ensureReady();
      await this.refreshModels();
      const options = this.modelOptions();
      const selected = options.find((item) => item.value.includes("sol")) || options[0];
      if (!selected) throw new Error("Codex model catalog is empty");
      await this.#applySelection({
        model: selected.value,
        effort: selected.defaultEffort || this.config.selection.effort,
      });
    });
  }

  execute(command) {
    return this.#enqueue(() => this.#executeDirect(command));
  }

  blankTitle(name) {
    return this.config.blanks[name]?.title || "";
  }

  async #applySelection(changes) {
    await this.#ensureReady();
    Object.assign(this.config.selection, changes);
    writeConfig(this.config);
    const edits = [];
    if (changes.model) edits.push({ keyPath: "model", value: changes.model, mergeStrategy: "upsert" });
    if (changes.effort) {
      edits.push({
        keyPath: "model_reasoning_effort",
        value: changes.effort,
        mergeStrategy: "upsert",
      });
    }
    if (edits.length) {
      await this.rpc.request("config/batchWrite", { edits, reloadUserConfig: true });
    }
    const state = await this.#state().catch(() => null);
    if (state?.activeThreadId) {
      const params = { threadId: state.activeThreadId };
      if (changes.model) params.model = changes.model;
      if (changes.effort) params.effort = changes.effort;
      await this.rpc.request("thread/settings/update", params).catch((error) => {
        this.logger?.warn?.(`Active-thread update deferred: ${error.message}`);
      });
    }
    this.emit("selection", this.selection());
  }

  async #newTask() {
    await this.#ensureReady();
    const state = await this.#state().catch(() => null);
    let cwd = null;
    if (state?.activeThreadId) {
      const current = await this.rpc
        .request("thread/read", { threadId: state.activeThreadId, includeTurns: false })
        .catch(() => null);
      cwd = current?.thread?.cwd || null;
    }
    const query = cwd ? `?path=${encodeURIComponent(cwd)}` : "";
    return this.openUri(`codex://threads/new${query}`);
  }

  async #review() {
    const state = await this.#state();
    if (!state.activeThreadId) throw new Error("No active Codex task");
    return this.control({
      command: "rpc",
      method: "review/start",
      params: {
        threadId: state.activeThreadId,
        target: { type: "uncommittedChanges" },
        delivery: "inline",
      },
    });
  }

  async #stop() {
    const state = await this.#state();
    if (!state.activeThreadId || !state.activeTurnId) throw new Error("No active Codex turn");
    return this.control({
      command: "rpc",
      method: "turn/interrupt",
      params: { threadId: state.activeThreadId, turnId: state.activeTurnId },
    });
  }

  async #fork() {
    await this.#ensureReady();
    const state = await this.#state();
    if (!state.activeThreadId) throw new Error("No active Codex task");
    const response = await this.rpc.request("thread/fork", {
      threadId: state.activeThreadId,
      model: this.config.selection.model,
      config: { model_reasoning_effort: this.config.selection.effort },
    });
    this.openUri(`codex://threads/${response.thread.id}`);
    return response;
  }

  async #state() {
    const state = await this.control({ command: "state" }).catch(() => null);
    if (state?.activeThreadId && (await this.#readControllableThread(state.activeThreadId))) {
      return state;
    }
    const loaded = await this.rpc.request("thread/loaded/list", {});
    const loadedThreads = [];
    for (const threadId of [...(loaded.data || [])].reverse()) {
      const thread = await this.#readControllableThread(threadId);
      if (thread) loadedThreads.push(thread);
    }
    if (loadedThreads.length) {
      const selected =
        loadedThreads.find((thread) => thread.status?.type === "active") || loadedThreads[0];
      return { ...state, activeThreadId: selected.id };
    }
    const recent = await this.rpc.request("thread/list", {
      limit: 10,
      sortKey: "recency_at",
      sortDirection: "desc",
      archived: false,
    });
    const candidates = (recent.data || []).filter(
      (thread) => !thread.ephemeral && thread.threadSource !== "system",
    );
    const local = candidates.find((thread) => thread.status?.type === "active") || candidates[0];
    return { ...state, activeThreadId: local?.id || null };
  }

  async #readControllableThread(threadId) {
    const response = await this.rpc
      .request("thread/read", { threadId, includeTurns: false })
      .catch(() => null);
    const thread = response?.thread;
    return thread && !thread.ephemeral && thread.threadSource !== "system" ? thread : null;
  }

  #executeBlank(name) {
    const blank = this.config.blanks[name];
    if (!blank || blank.type === "none") throw new Error("This slot is intentionally unassigned");
    if (blank.type === "uri") return this.openUri(blank.value);
    if (blank.type === "action" && CUSTOM_ACTIONS.has(blank.value)) {
      return this.#executeDirect(blank.value);
    }
    if (blank.type === "action") throw new Error(`Unsupported custom action: ${blank.value}`);
    throw new Error(`Unsupported blank action type: ${blank.type}`);
  }

  #executeDirect(command) {
    switch (command) {
      case "new-task":
        return this.#newTask();
      case "review":
        return this.#review();
      case "approve":
        return this.control({ command: "approve" });
      case "decline":
        return this.control({ command: "decline" });
      case "stop":
        return this.#stop();
      case "fork":
        return this.#fork();
      case "skills":
        return this.openUri("codex://skills");
      case "settings":
        return this.openUri("codex://settings");
      case "blank1":
      case "blank2":
        return this.#executeBlank(command);
      default:
        throw new Error(`Unknown Codex Deck action: ${command}`);
    }
  }

  #observeNotification(message) {
    if (message.method === "model/list/updated") {
      void this.refreshModels().catch((error) => this.logger?.error?.(error.message));
    }
  }

  #setActivity(state, snapshot) {
    const changed = state !== this.activityState;
    this.activityState = state;
    this.activitySnapshot = snapshot;
    if (changed) this.emit("activity", this.activity());
  }

  async #ensureReady() {
    if (this.rpc.connected && this.models.length) return;
    await this.initialize();
  }

  #enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
}
