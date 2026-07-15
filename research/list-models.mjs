import { CodexRpcClient } from "../com.driveline.codex-command-center.sdPlugin/bin/codex-client.js";

const client = new CodexRpcClient({
  logger: { error: () => {}, warn: () => {}, info: () => {} },
  url: process.env.CODEX_DECK_SERVER_URL,
});

try {
  for (let attempt = 0; attempt < 50 && !client.connected; attempt += 1) {
    try {
      await client.connect();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!client.connected) throw new Error(`Could not connect to ${client.url}`);
  const models = await client.listModels();
  console.log(
    JSON.stringify(
      models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        hidden: model.hidden,
        defaultReasoningEffort: model.defaultReasoningEffort,
        supportedReasoningEfforts: model.supportedReasoningEfforts.map(
          (option) => option.reasoningEffort,
        ),
      })),
      null,
      2,
    ),
  );
} finally {
  client.socket?.close();
}
