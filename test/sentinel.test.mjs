import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  SENTINEL_ANIMATIONS,
  SENTINEL_STATES,
  activityFromBridgeSnapshot,
  sentinelFrameDelay,
  sentinelFramePath,
} from "../com.driveline.codex-command-center.sdPlugin/bin/sentinel.js";

const pluginRoot = join(process.cwd(), "com.driveline.codex-command-center.sdPlugin");

const hash = (value) => createHash("sha256").update(value).digest("hex");

test("bridge state maps to every sentinel animation state", () => {
  assert.equal(activityFromBridgeSnapshot(null), "disconnected");
  assert.equal(activityFromBridgeSnapshot({ ok: true }), "idle");
  assert.equal(activityFromBridgeSnapshot({ ok: true, activeTurnId: "turn-1" }), "working");
  assert.equal(
    activityFromBridgeSnapshot({ ok: true, activeTurnId: "turn-1", pendingApprovalCount: 1 }),
    "waiting",
  );
});

test("sentinel frame scheduling stays below the Stream Deck update budget", () => {
  assert.equal(sentinelFrameDelay("working", 1), 250);
  assert.equal(sentinelFrameDelay("working", 2), 250);
  assert.equal(sentinelFrameDelay("working", 4), 500);
  assert.equal(sentinelFramePath("working", 5), "imgs/sentinel/working-1.png");
  assert.equal(sentinelFramePath("unknown", 0), "imgs/sentinel/disconnected-0.png");
});

test("every sentinel state has four unique 144-pixel frames", async () => {
  assert.deepEqual(SENTINEL_STATES, ["idle", "working", "waiting", "disconnected"]);
  const allHashes = [];
  for (const state of SENTINEL_STATES) {
    assert.equal(SENTINEL_ANIMATIONS[state].frames, 4);
    const stateHashes = [];
    for (let index = 0; index < 4; index += 1) {
      const image = await readFile(join(pluginRoot, sentinelFramePath(state, index)));
      assert.equal(image.subarray(1, 4).toString("ascii"), "PNG");
      assert.equal(image.readUInt32BE(16), 144);
      assert.equal(image.readUInt32BE(20), 144);
      stateHashes.push(hash(image));
    }
    assert.equal(new Set(stateHashes).size, 4);
    allHashes.push(...stateHashes);
  }
  assert.equal(new Set(allHashes).size, 16);
});
