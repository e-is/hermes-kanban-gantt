// src/core/ws-core.ts
var WS_FIRST_FRAME_MS = 5e3;
var WS_HEARTBEAT_MS = 2e4;
var WS_IDLE_MS = Math.round(WS_HEARTBEAT_MS * 2.5);
var WS_BACKOFF_BASE_MS = 500;
var WS_BACKOFF_MAX_MS = 1e4;
var WS_MAX_ATTEMPTS = 1;
var WS_REARM_MS = 5 * 6e4;
var WS_STATE = {
  off: "off",
  // not attempted (flag off, oauth/2nd backend, no board)
  connecting: "connecting",
  live: "live",
  // at least one snapshot applied
  dead: "dead"
  // gave up → polling only
};
function nextBackoff(attempt, rand = Math.random) {
  const capped = Math.min(WS_BACKOFF_MAX_MS, WS_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(capped / 2 + capped / 2 * rand());
}
function classifyFrame(frame, lastVersion) {
  if (!frame || typeof frame !== "object") return { kind: "ignore" };
  if (frame.type === "heartbeat") {
    return { kind: "heartbeat", version: Number(frame.version) || 0 };
  }
  if (frame.type !== "snapshot") return { kind: "ignore" };
  const version = Number(frame.version);
  if (!Number.isFinite(version) || !Array.isArray(frame.tasks)) return { kind: "ignore" };
  if (lastVersion != null && version === lastVersion) return { kind: "stale", version };
  if (lastVersion != null && version < lastVersion) {
    return { kind: "snapshot", version, gap: false, restart: true };
  }
  const gap = lastVersion != null && version > lastVersion + 1;
  return { kind: "snapshot", version, gap, restart: false };
}
function frameToQueryData(frame) {
  return {
    board: frame.board,
    generated_at: frame.generated_at,
    tasks: frame.tasks || [],
    labels: frame.labels || []
  };
}
function canPush(board) {
  return !!board && board !== "all" && board !== "*";
}
function eventsPath(board) {
  return `/events?board=${encodeURIComponent(board || "")}`;
}
export {
  WS_BACKOFF_BASE_MS,
  WS_BACKOFF_MAX_MS,
  WS_FIRST_FRAME_MS,
  WS_HEARTBEAT_MS,
  WS_IDLE_MS,
  WS_MAX_ATTEMPTS,
  WS_REARM_MS,
  WS_STATE,
  canPush,
  classifyFrame,
  eventsPath,
  frameToQueryData,
  nextBackoff
};
