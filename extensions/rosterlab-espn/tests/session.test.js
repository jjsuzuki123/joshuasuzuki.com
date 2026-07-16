import test from "node:test";
import assert from "node:assert/strict";

import {
  CONNECTION_TTL_MS,
  createConnectionSession,
  isConnectionExpired,
  isValidConnectionSession,
  normalizeDefaultSeason,
  referenceAttemptKey,
} from "../lib/session.js";

const requestId = "request_12345678";
const reference = { leagueId: "42", season: "2026", teamId: "7" };

test("creates only valid ephemeral connection state", () => {
  const session = createConnectionSession({
    requestId,
    sourceTabId: 12,
    defaultSeason: "2026",
    now: 1_000,
  });
  assert.equal(isValidConnectionSession(session), true);
  assert.equal(session.espnTabId, null);
  assert.equal(session.attemptToken, null);
  assert.equal(session.activeReferenceKey, null);
  assert.equal(session.navigationToken, null);
  assert.equal(session.defaultSeason, "2026");
  assert.throws(
    () =>
      createConnectionSession({
        requestId: "bad",
        sourceTabId: 12,
      }),
    TypeError
  );
});

test("expires stale connector state", () => {
  const session = createConnectionSession({
    requestId,
    sourceTabId: 12,
    defaultSeason: "2026",
    now: 1_000,
  });
  assert.equal(isConnectionExpired(session, 1_000 + CONNECTION_TTL_MS - 1), false);
  assert.equal(isConnectionExpired(session, 1_000 + CONNECTION_TTL_MS), true);
});

test("normalizes season and league attempt coordinates", () => {
  assert.equal(normalizeDefaultSeason("2025"), "2025");
  assert.equal(
    normalizeDefaultSeason("invalid", new Date("2026-07-06T00:00:00Z")),
    "2026"
  );
  assert.equal(referenceAttemptKey(reference), "42:2026:7");
});
