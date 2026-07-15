export const SENTINEL_STATES = Object.freeze([
  "idle",
  "working",
  "waiting",
  "disconnected",
]);

export const SENTINEL_ANIMATIONS = Object.freeze({
  idle: Object.freeze({ frameMs: 700, frames: 4 }),
  working: Object.freeze({ frameMs: 250, frames: 4 }),
  waiting: Object.freeze({ frameMs: 400, frames: 4 }),
  disconnected: Object.freeze({ frameMs: 800, frames: 4 }),
});

export function activityFromBridgeSnapshot(snapshot) {
  if (!snapshot?.ok) return "disconnected";
  if ((snapshot.pendingApprovalCount || 0) > 0) return "waiting";
  if (snapshot.activeTurnId) return "working";
  return "idle";
}

export function sentinelFramePath(state, frameIndex) {
  const selected = SENTINEL_ANIMATIONS[state] ? state : "disconnected";
  const count = SENTINEL_ANIMATIONS[selected].frames;
  const index = ((Math.trunc(frameIndex) % count) + count) % count;
  return `imgs/sentinel/${selected}-${index}.png`;
}

export function sentinelFrameDelay(state, visibleTargetCount = 1) {
  const selected = SENTINEL_ANIMATIONS[state] ? state : "disconnected";
  const targets = Math.max(1, Math.trunc(visibleTargetCount) || 1);
  const eightCallsPerSecond = Math.ceil((targets * 1_000) / 8);
  return Math.max(SENTINEL_ANIMATIONS[selected].frameMs, eightCallsPerSecond);
}
