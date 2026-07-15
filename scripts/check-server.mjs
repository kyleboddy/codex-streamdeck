import { CodexRpcClient } from "../com.driveline.codex-command-center.sdPlugin/bin/codex-client.js";
import { controlCommand } from "../com.driveline.codex-command-center.sdPlugin/bin/controller.js";

const client = new CodexRpcClient({
  logger: { error() {}, warn() {}, info() {}, debug() {} },
  url: process.env.CODEX_DECK_SERVER_URL || "ws://127.0.0.1:47812",
});

let exitCode = 0;
try {
  await client.connect();
  const [models, state] = await Promise.all([
    client.listModels(),
    controlCommand({ command: "state" }, 2_000),
  ]);
  const readControllable = async (threadId) => {
    if (!threadId) return null;
    const response = await client
      .request("thread/read", { threadId, includeTurns: false })
      .catch(() => null);
    const thread = response?.thread;
    return thread && !thread.ephemeral && thread.threadSource !== "system" ? thread : null;
  };
  let targetThread = await readControllable(state.activeThreadId);
  if (!targetThread) {
    const loaded = await client.request("thread/loaded/list", {});
    const candidates = [];
    for (const threadId of [...(loaded.data || [])].reverse()) {
      const thread = await readControllable(threadId);
      if (thread) candidates.push(thread);
    }
    targetThread = candidates.find((thread) => thread.status?.type === "active") || candidates[0] || null;
  }
  if (!targetThread) {
    const recent = await client.request("thread/list", {
      limit: 10,
      sortKey: "recency_at",
      sortDirection: "desc",
      archived: false,
    });
    const candidates = (recent.data || []).filter(
      (thread) => !thread.ephemeral && thread.threadSource !== "system",
    );
    targetThread = candidates.find((thread) => thread.status?.type === "active") || candidates[0] || null;
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      state,
      targetThread: targetThread
        ? {
            id: targetThread.id,
            name: targetThread.name,
            cwd: targetThread.cwd,
            status: targetThread.status,
          }
        : null,
      models: models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        isDefault: model.isDefault,
        defaultReasoningEffort: model.defaultReasoningEffort,
        supportedReasoningEfforts: model.supportedReasoningEfforts.map(
          (option) => option.reasoningEffort,
        ),
      })),
    })}\n`,
  );
} catch (error) {
  exitCode = 1;
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
} finally {
  client.socket?.terminate();
}

process.exit(exitCode);
