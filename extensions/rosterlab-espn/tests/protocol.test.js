import test from "node:test";
import assert from "node:assert/strict";

import {
  EXTENSION_SOURCE,
  PAGE_SOURCE,
  PROTOCOL_VERSION,
  WORKER_SCOPE,
  isValidPageEvent,
  isValidPageRequest,
  isValidRequestId,
  isValidWorkerEvent,
  isValidWorkerRequest,
  pageEvent,
  workerEvent,
} from "../lib/protocol.js";

const requestId = "request_12345678";

test("validates page requests and requires a user gesture to connect", () => {
  assert.equal(
    isValidPageRequest({
      source: PAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: "CONNECTOR_CONNECT",
      requestId,
      userGesture: true,
    }),
    true
  );
  assert.equal(
    isValidPageRequest({
      source: PAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: "CONNECTOR_CONNECT",
      requestId,
      userGesture: false,
    }),
    false
  );
  assert.equal(
    isValidPageRequest({
      source: PAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: "UNKNOWN",
      requestId,
    }),
    false
  );
});

test("rejects malformed and oversized request IDs", () => {
  assert.equal(isValidRequestId(requestId), true);
  assert.equal(isValidRequestId("../request"), false);
  assert.equal(isValidRequestId("short"), false);
  assert.equal(isValidRequestId("x".repeat(81)), false);
});

test("validates worker requests without permitting arbitrary messages", () => {
  assert.equal(
    isValidWorkerRequest({
      scope: WORKER_SCOPE,
      type: "connector-connect",
      requestId,
    }),
    true
  );
  assert.equal(
    isValidWorkerRequest({
      scope: WORKER_SCOPE,
      type: "espn-location",
      url: "https://fantasy.espn.com/baseball/",
    }),
    true
  );
  assert.equal(
    isValidWorkerRequest({
      scope: WORKER_SCOPE,
      type: "fetch-url",
      url: "https://example.com/",
    }),
    false
  );
});

test("builds and validates page events", () => {
  const event = pageEvent("CONNECTOR_STATUS", {
    requestId,
    status: "syncing",
  });
  assert.equal(event.source, EXTENSION_SOURCE);
  assert.equal(isValidPageEvent(event), true);
  assert.equal(
    isValidPageEvent({ ...event, source: "unknown-extension" }),
    false
  );
});

test("builds and validates worker events", () => {
  const event = workerEvent("connector-success", {
    requestId,
    payload: { teams: [{}, {}] },
  });
  assert.equal(event.scope, WORKER_SCOPE);
  assert.equal(isValidWorkerEvent(event), true);
  assert.throws(() => workerEvent("fetch-anything"), TypeError);
});
