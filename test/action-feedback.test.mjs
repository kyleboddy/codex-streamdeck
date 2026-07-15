import assert from "node:assert/strict";
import test from "node:test";
import { runWithFeedback } from "../com.driveline.codex-command-center.sdPlugin/bin/action-feedback.js";

test("dial success does not call the keypad-only showOk API", async () => {
  let alertCount = 0;
  const dial = {
    isKey: () => false,
    showAlert: async () => {
      alertCount += 1;
    },
  };

  assert.equal(await runWithFeedback(dial, async () => "changed", {}), "changed");
  assert.equal(alertCount, 0);
});

test("key success still displays the Stream Deck success badge", async () => {
  let okCount = 0;
  const key = {
    isKey: () => true,
    showOk: async () => {
      okCount += 1;
    },
    showAlert: async () => {},
  };

  await runWithFeedback(key, async () => {}, {});
  assert.equal(okCount, 1);
});

test("failures are logged, alerted, and remain failures", async () => {
  const messages = [];
  let alertCount = 0;
  const target = {
    isKey: () => false,
    showAlert: async () => {
      alertCount += 1;
    },
  };

  await assert.rejects(
    runWithFeedback(
      target,
      async () => {
        throw new Error("dial failed");
      },
      { error: (message) => messages.push(message) },
    ),
    /dial failed/,
  );
  assert.equal(alertCount, 1);
  assert.match(messages[0], /dial failed/);
});
