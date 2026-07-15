import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const localAppData = await mkdtemp(join(tmpdir(), "codex-deck-controller-test-"));
process.env.LOCALAPPDATA = localAppData;
test.beforeEach(async () => {
  await rm(join(localAppData, "CodexDeck", "deck-config.json"), { force: true });
});

const { CodexDeckController, EFFORTS, modelDialLabel } = await import(
  "../com.driveline.codex-command-center.sdPlugin/bin/controller.js?controller-test"
);

test("Model dial uses compact labels for the live Codex catalog", () => {
  const labels = [
    ["gpt-5.6-sol", "Sol"],
    ["gpt-5.6-terra", "Terra"],
    ["gpt-5.6-luna", "Luna"],
    ["gpt-5.5", "5.5"],
    ["gpt-5.4", "5.4"],
    ["gpt-5.4-mini", "5.4-Mini"],
    ["gpt-5.3-codex-spark", "5.3-Spark"],
  ];

  for (const [id, expected] of labels) {
    assert.equal(modelDialLabel({ id, displayName: `Long name for ${id}` }), expected);
  }
  assert.equal(modelDialLabel({ id: "future-model", displayName: "Future Model" }), "Future Model");
});

const effortOptions = (values) =>
  values.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort }));

class FakeRpc extends EventEmitter {
  connected = false;
  calls = [];

  async connect() {
    this.connected = true;
  }

  async listModels() {
    return [
      {
        id: "gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        description: "Full effort catalog",
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: effortOptions([
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
          "ultra",
        ]),
      },
      {
        id: "gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        description: "No Ultra support",
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: effortOptions(["low", "medium", "high", "xhigh", "max"]),
      },
    ];
  }

  async request(method, params) {
    this.calls.push({ method, params });
    if (method === "thread/loaded/list") return { data: ["thread-1"], nextCursor: null };
    if (method === "thread/list") return { data: [{ id: "thread-1" }], nextCursor: null };
    if (method === "thread/read") {
      return {
        thread: {
          id: params.threadId,
          cwd: "C:\\workspace",
          ephemeral: false,
          threadSource: null,
        },
      };
    }
    if (method === "thread/start") return { thread: { id: "thread-new" } };
    if (method === "thread/fork") return { thread: { id: "thread-fork" } };
    return {};
  }
}

test("Brainpower exposes every current Codex effort in order", () => {
  assert.deepEqual(
    EFFORTS.map((item) => [item.value, item.label]),
    [
      ["low", "Light"],
      ["medium", "Medium"],
      ["high", "High"],
      ["xhigh", "Extra High"],
      ["max", "Max"],
      ["ultra", "Ultra"],
    ],
  );
});

test("Ultra automatically moves from an incompatible model to a compatible live model", async () => {
  const rpc = new FakeRpc();
  const controller = new CodexDeckController({
    logger: {},
    rpc,
    control: async () => ({ ok: true, activeThreadId: null }),
  });
  await controller.initialize();

  await controller.stepModel(1);
  assert.deepEqual(controller.selection(), { model: "gpt-5.6-luna", effort: "high" });

  await controller.stepEffort(1);
  await controller.stepEffort(1);
  assert.deepEqual(controller.selection(), { model: "gpt-5.6-luna", effort: "max" });

  await controller.stepEffort(1);
  assert.deepEqual(controller.selection(), { model: "gpt-5.6-sol", effort: "ultra" });
  assert.ok(
    rpc.calls.some(
      ({ method, params }) =>
        method === "thread/settings/update" &&
        params.threadId === "thread-1" &&
        params.model === "gpt-5.6-sol" &&
        params.effort === "ultra",
    ),
  );
});

test("dial rotation honors every tick and wraps in both directions", async () => {
  const rpc = new FakeRpc();
  const controller = new CodexDeckController({
    logger: {},
    rpc,
    control: async () => ({ ok: true, activeThreadId: null }),
  });
  await controller.initialize();

  await controller.stepEffort(3);
  assert.equal(controller.selection().effort, "ultra");
  await controller.stepEffort(-2);
  assert.equal(controller.selection().effort, "xhigh");
});

test("the six hardware buttons issue direct Codex commands without UI automation", async () => {
  const rpc = new FakeRpc();
  const controls = [];
  const opened = [];
  const control = async (command) => {
    controls.push(command);
    if (command.command === "state") {
      return { ok: true, activeThreadId: "thread-1", activeTurnId: "turn-1" };
    }
    return { ok: true };
  };
  const controller = new CodexDeckController({
    logger: {},
    rpc,
    control,
    openUri: (uri) => opened.push(uri),
  });
  await controller.initialize();

  await controller.execute("new-task");
  await controller.execute("review");
  await controller.execute("approve");
  await controller.execute("decline");
  await controller.execute("stop");
  await controller.execute("fork");

  assert.deepEqual(opened, [
    "codex://threads/new?path=C%3A%5Cworkspace",
    "codex://threads/thread-fork",
  ]);
  assert.ok(!rpc.calls.some(({ method }) => method === "thread/start"));
  assert.ok(
    rpc.calls.some(
      ({ method, params }) =>
        method === "thread/fork" &&
        params.threadId === "thread-1" &&
        !Object.hasOwn(params, "excludeTurns"),
    ),
  );
  assert.ok(controls.some(({ command, method }) => command === "rpc" && method === "review/start"));
  assert.ok(controls.some(({ command }) => command === "approve"));
  assert.ok(controls.some(({ command }) => command === "decline"));
  assert.ok(controls.some(({ command, method }) => command === "rpc" && method === "turn/interrupt"));
});

test("custom slots remain intentional blanks until configured", async () => {
  const controller = new CodexDeckController({ logger: {}, rpc: new FakeRpc() });
  await assert.rejects(controller.execute("blank1"), /intentionally unassigned/);
  await assert.rejects(controller.execute("blank2"), /intentionally unassigned/);
});

test("background ephemeral tasks cannot steal the hardware target", async () => {
  const rpc = new FakeRpc();
  const originalRequest = rpc.request.bind(rpc);
  rpc.request = async (method, params) => {
    if (method === "thread/read" && params.threadId === "thread-system") {
      return {
        thread: {
          id: "thread-system",
          ephemeral: true,
          threadSource: "system",
        },
      };
    }
    return originalRequest(method, params);
  };
  const controller = new CodexDeckController({
    logger: {},
    rpc,
    control: async () => ({ ok: true, activeThreadId: "thread-system" }),
  });
  await controller.initialize();

  await controller.stepEffort(1);
  assert.ok(
    rpc.calls.some(
      ({ method, params }) =>
        method === "thread/settings/update" &&
        params.threadId === "thread-1" &&
        params.effort === "xhigh",
    ),
  );
  assert.ok(
    !rpc.calls.some(
      ({ method, params }) => method === "thread/settings/update" && params.threadId === "thread-system",
    ),
  );
});
