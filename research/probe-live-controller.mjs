import { CodexDeckController, controlCommand } from "../com.driveline.codex-command-center.sdPlugin/bin/controller.js";

const logger = {
  debug() {},
  info() {},
  warn(message) {
    process.stderr.write(`warning: ${message}\n`);
  },
  error(message) {
    process.stderr.write(`error: ${message}\n`);
  },
};

const controller = new CodexDeckController({ logger });
await controller.initialize();
const state = await controlCommand({ command: "state" });
let threadId = state.activeThreadId;
if (threadId) {
  const active = await controller.rpc
    .request("thread/read", { threadId, includeTurns: false })
    .catch(() => null);
  if (active?.thread?.ephemeral || active?.thread?.threadSource === "system") threadId = null;
}
if (!threadId) {
  const recent = await controller.rpc.request("thread/list", {
    limit: 10,
    sortKey: "recency_at",
    sortDirection: "desc",
    archived: false,
  });
  const candidates = (recent.data || []).filter(
    (thread) => !thread.ephemeral && thread.threadSource !== "system",
  );
  threadId =
    (candidates.find((thread) => thread.status?.type === "active") || candidates[0])?.id;
}
if (!threadId) throw new Error("The desktop transport has no controllable local task");

const initial = controller.selection();
const models = controller.modelOptions().filter((item) => item.value !== "loading");
const initialThread = await controller.rpc.request("thread/resume", {
  threadId,
  excludeTurns: true,
});

const observed = { effort: null, model: null };
try {
  const effort = await controller.stepEffort(1);
  const effortThread = await controller.rpc.request("thread/resume", {
    threadId,
    excludeTurns: true,
  });
  observed.effort = {
    selected: effort.value,
    thread: effortThread.reasoningEffort,
    model: effortThread.model,
  };
  if (effortThread.reasoningEffort !== effort.value) {
    throw new Error(`Brainpower dial selected ${effort.value}, task reported ${effortThread.reasoningEffort}`);
  }

  const model = await controller.stepModel(1);
  const modelThread = await controller.rpc.request("thread/resume", {
    threadId,
    excludeTurns: true,
  });
  observed.model = {
    selected: model.value,
    thread: modelThread.model,
    effort: modelThread.reasoningEffort,
  };
  if (modelThread.model !== model.value) {
    throw new Error(`Model dial selected ${model.value}, task reported ${modelThread.model}`);
  }
} finally {
  for (let count = 0; count <= models.length && controller.selection().model !== initial.model; count += 1) {
    await controller.stepModel(1);
  }
  for (let count = 0; count <= controller.effortOptions().length && controller.selection().effort !== initial.effort; count += 1) {
    await controller.stepEffort(1);
  }
  await controller.rpc.request("thread/settings/update", {
    threadId,
    model: initialThread.model,
    effort: initialThread.reasoningEffort,
  });
}

const restored = await controller.rpc.request("thread/resume", {
  threadId,
  excludeTurns: true,
});
if (controller.selection().model !== initial.model || controller.selection().effort !== initial.effort) {
  throw new Error("The live control probe could not restore the original dial selection");
}

console.log(JSON.stringify({
  threadId,
  modelCount: models.length,
  initial: {
    configured: initial,
    threadModel: initialThread.model,
    threadEffort: initialThread.reasoningEffort,
  },
  observed,
  restored: {
    configured: controller.selection(),
    threadModel: restored.model,
    threadEffort: restored.reasoningEffort,
  },
}, null, 2));

controller.rpc.socket?.terminate();
process.exit(0);
