import { EventEmitter } from "node:events";
import WebSocket from "ws";

const DEFAULT_URL = "ws://127.0.0.1:47812";

export class CodexRpcClient extends EventEmitter {
  constructor({ logger, url = process.env.CODEX_DECK_SERVER_URL || DEFAULT_URL } = {}) {
    super();
    this.logger = logger;
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
    this.connecting = null;
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect() {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.#connectOnce().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async #connectOnce() {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.on("message", (data) => this.#handleMessage(String(data)));
    socket.on("close", () =>
      this.#handleClose(socket, new Error("Codex app-server disconnected")),
    );
    socket.on("error", (error) => this.logger?.debug?.(`Codex socket: ${error.message}`));
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timed out connecting to ${this.url}`)),
          5_000,
        );
        socket.once("open", () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });

      await this.#requestConnected("initialize", {
        clientInfo: {
          name: "codex_stream_deck",
          title: "Codex Stream Deck",
          version: "1.0.0",
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: [
            "item/reasoning/textDelta",
            "item/reasoning/summaryTextDelta",
          ],
        },
      });
      this.notify("initialized", {});
      this.emit("connected");
    } catch (error) {
      if (this.socket === socket) this.socket = null;
      socket.removeAllListeners();
      try {
        socket.terminate();
      } catch {
        // The opening handshake may not have allocated a socket yet.
      }
      throw error;
    }
  }

  async request(method, params = {}, timeoutMs = 15_000) {
    await this.connect();
    return this.#requestConnected(method, params, timeoutMs);
  }

  #requestConnected(method, params = {}, timeoutMs = 15_000) {
    if (!this.connected) throw new Error("Codex app-server is not connected");
    const id = `deck-${this.nextId++}`;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
    });
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return response;
  }

  notify(method, params = {}) {
    if (!this.connected) return;
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  async listModels() {
    const models = [];
    let cursor = null;
    do {
      const response = await this.request("model/list", {
        cursor,
        limit: 100,
        includeHidden: false,
      });
      models.push(...response.data);
      cursor = response.nextCursor;
    } while (cursor);
    return models.filter((model) => !model.hidden);
  }

  #handleMessage(json) {
    let message;
    try {
      message = JSON.parse(json);
    } catch (error) {
      this.logger?.error?.(`Invalid Codex JSON: ${error.message}`);
      return;
    }
    if (message.id != null && !message.method) {
      const key = String(message.id);
      const pending = this.pending.get(key);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(key);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (message.id != null && message.method) {
      this.socket?.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Stream Deck does not handle this server request" },
        }),
      );
      return;
    }
    if (message.method) this.emit("notification", message);
  }

  #handleClose(socket, error) {
    if (this.socket !== socket) return;
    socket.removeAllListeners();
    this.socket = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    this.emit("disconnected", error);
  }
}
