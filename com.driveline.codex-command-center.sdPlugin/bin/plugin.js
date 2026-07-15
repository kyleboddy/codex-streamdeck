import streamDeck, { SingletonAction } from "@elgato/streamdeck";
import { runWithFeedback } from "./action-feedback.js";
import { CodexDeckController, EFFORTS } from "./controller.js";

const PLUGIN_UUID = "com.driveline.codex-command-center";
const PROFILE_NAME = "Codex Command Center";
const STREAM_DECK_PLUS = 7;
const controller = new CodexDeckController({ logger: streamDeck.logger });

async function activateProfile(device) {
  if (!device?.isConnected || device.type !== STREAM_DECK_PLUS) return;
  try {
    await streamDeck.profiles.switchToProfile(device.id, PROFILE_NAME, 0);
    streamDeck.logger.info(`Activated ${PROFILE_NAME} on ${device.name}`);
  } catch (error) {
    streamDeck.logger.error(`Could not activate ${PROFILE_NAME}: ${error?.message || error}`);
  }
}

async function report(target, operation) {
  try {
    await runWithFeedback(target, operation, streamDeck.logger);
  } catch {
    // The helper already logged and displayed the alert.
  }
}

class CommandAction extends SingletonAction {
  constructor(suffix, command, title = null) {
    super();
    this.manifestId = `${PLUGIN_UUID}.${suffix}`;
    this.command = command;
    this.title = title;
  }

  async onWillAppear(event) {
    const title = this.title ?? controller.blankTitle(this.command);
    if (title != null) await event.action.setTitle(title);
  }

  async onKeyDown(event) {
    await report(event.action, () => controller.execute(this.command));
  }
}

class ReasoningDial extends SingletonAction {
  manifestId = `${PLUGIN_UUID}.reasoning`;
  targets = new Set();

  constructor() {
    super();
    controller.on("selection", () => void this.renderAll());
  }

  async render(target) {
    const current = controller.selection().effort;
    const index = Math.max(0, EFFORTS.findIndex((item) => item.value === current));
    await target.setFeedback({
      title: "Brainpower",
      value: EFFORTS[index]?.label || current,
      indicator: { value: Math.round((index * 100) / (EFFORTS.length - 1)) },
    });
  }

  async renderAll() {
    await Promise.allSettled([...this.targets].map((target) => this.render(target)));
  }

  async onWillAppear(event) {
    this.targets.add(event.action);
    await this.render(event.action);
  }

  onWillDisappear(event) {
    this.targets.delete(event.action);
  }

  async onDialRotate(event) {
    await report(event.action, async () => {
      await controller.stepEffort(event.payload.ticks);
      await this.render(event.action);
    });
  }

  async onDialUp(event) {
    await report(event.action, async () => {
      await controller.resetEffort();
      await this.render(event.action);
    });
  }
}

class ModelDial extends SingletonAction {
  manifestId = `${PLUGIN_UUID}.model`;
  targets = new Set();

  constructor() {
    super();
    controller.on("selection", () => void this.renderAll());
    controller.on("models", () => void this.renderAll());
  }

  async render(target) {
    const options = controller.modelOptions();
    const current = controller.selection().model;
    const index = Math.max(0, options.findIndex((item) => item.value === current));
    const selected = options[index];
    await target.setFeedback({
      title: "Model",
      value: selected?.label || current || "Connecting...",
      indicator: { value: options.length > 1 ? Math.round((index * 100) / (options.length - 1)) : 0 },
    });
  }

  async renderAll() {
    await Promise.allSettled([...this.targets].map((target) => this.render(target)));
  }

  async onWillAppear(event) {
    this.targets.add(event.action);
    await this.render(event.action);
  }

  onWillDisappear(event) {
    this.targets.delete(event.action);
  }

  async onDialRotate(event) {
    await report(event.action, async () => {
      await controller.stepModel(event.payload.ticks);
      await this.render(event.action);
    });
  }

  async onDialUp(event) {
    await report(event.action, async () => {
      await controller.resetModel();
      await this.render(event.action);
    });
  }
}

streamDeck.actions.registerAction(new ReasoningDial());
streamDeck.actions.registerAction(new ModelDial());
streamDeck.actions.registerAction(new CommandAction("new-task", "new-task", "New Task"));
streamDeck.actions.registerAction(new CommandAction("review", "review", "Review"));
streamDeck.actions.registerAction(new CommandAction("approve", "approve", "Approve"));
streamDeck.actions.registerAction(new CommandAction("decline", "decline", "Decline"));
streamDeck.actions.registerAction(new CommandAction("stop", "stop", "Stop"));
streamDeck.actions.registerAction(new CommandAction("fork", "fork", "Fork"));
streamDeck.actions.registerAction(new CommandAction("skills", "skills", "Skills"));
streamDeck.actions.registerAction(new CommandAction("settings", "settings", "Settings"));
streamDeck.actions.registerAction(new CommandAction("blank1", "blank1"));
streamDeck.actions.registerAction(new CommandAction("blank2", "blank2"));
streamDeck.devices.onDeviceDidConnect((event) => void activateProfile(event.device));

await streamDeck.connect();
controller.startAutoReconnect();
for (const device of streamDeck.devices) void activateProfile(device);
