import { isValidRequestId } from "./protocol.js";

export const CONNECTION_TTL_MS = 10 * 60 * 1_000;
const SEASON_PATTERN = /^20\d{2}$/;

export function normalizeDefaultSeason(value, now = new Date()) {
  const candidate = String(value || "").trim();
  return SEASON_PATTERN.test(candidate)
    ? candidate
    : String(now.getFullYear());
}

export function isValidConnectionSession(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      isValidRequestId(value.requestId) &&
      Number.isInteger(value.sourceTabId) &&
      Number.isFinite(value.startedAt) &&
      SEASON_PATTERN.test(String(value.defaultSeason || "")) &&
      (value.espnTabId === null || Number.isInteger(value.espnTabId)) &&
      typeof value.awaitingEspn === "boolean" &&
      (value.attemptToken === null ||
        (typeof value.attemptToken === "string" &&
          value.attemptToken.length >= 8)) &&
      (value.activeReferenceKey === null ||
        typeof value.activeReferenceKey === "string") &&
      (value.navigationToken === null ||
        (typeof value.navigationToken === "string" &&
          value.navigationToken.length >= 8))
  );
}

export function createConnectionSession({
  requestId,
  sourceTabId,
  defaultSeason,
  now = Date.now(),
}) {
  const session = {
    requestId,
    sourceTabId,
    startedAt: now,
    defaultSeason: normalizeDefaultSeason(defaultSeason, new Date(now)),
    espnTabId: null,
    awaitingEspn: false,
    attemptToken: null,
    activeReferenceKey: null,
    navigationToken: null,
  };
  if (!isValidConnectionSession(session)) {
    throw new TypeError("Invalid connector session.");
  }
  return session;
}

export function isConnectionExpired(session, now = Date.now()) {
  return (
    !isValidConnectionSession(session) ||
    now - session.startedAt >= CONNECTION_TTL_MS
  );
}

export function referenceAttemptKey(reference) {
  return [
    String(reference?.leagueId || ""),
    String(reference?.season || ""),
    String(reference?.teamId || ""),
  ].join(":");
}
