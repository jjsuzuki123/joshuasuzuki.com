const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "fantasy", "espn-connector.js"),
  "utf8"
);

function harness() {
  const listeners = new Map();
  const posted = [];
  let nextId = 1;
  const window = {
    location: { origin: "https://www.joshuasuzuki.com" },
    crypto: {
      randomUUID() {
        return `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
      },
    },
    setTimeout,
    clearTimeout,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    postMessage(message, targetOrigin) {
      posted.push({ message, targetOrigin });
    },
  };
  vm.runInNewContext(source, { window });

  return {
    connector: window.RosterLabEspnConnector,
    posted,
    dispatch(message, origin = window.location.origin) {
      listeners.get("message")({
        source: window,
        origin,
        data: message,
      });
    },
  };
}

function extensionEvent(type, fields = {}) {
  return {
    source: "rosterlab-espn-connector",
    version: 1,
    type,
    ...fields,
  };
}

test("detects the installed browser connector", async () => {
  const testPage = harness();
  const pending = testPage.connector.ping(100);
  assert.equal(testPage.posted[0].message.type, "CONNECTOR_PING");
  assert.equal(
    testPage.posted[0].targetOrigin,
    "https://www.joshuasuzuki.com"
  );

  testPage.dispatch(extensionEvent("CONNECTOR_READY"));
  assert.equal(await pending, true);
  assert.equal(testPage.connector.available, true);

  const messageCount = testPage.posted.length;
  const missingAfterReload = testPage.connector.ping(5);
  assert.equal(testPage.posted.length, messageCount + 1);
  assert.equal(await missingAfterReload, false);
  assert.equal(testPage.connector.available, false);
});

test("hands connector status and league payload back to the caller", async () => {
  const testPage = harness();
  let status = null;
  const connection = testPage.connector.connect({
    defaultSeason: "2026",
    onStatus(update) {
      status = update;
    },
  });
  const request = testPage.posted[0].message;
  assert.equal(request.type, "CONNECTOR_CONNECT");
  assert.equal(request.userGesture, true);

  testPage.dispatch(
    extensionEvent("CONNECTOR_STATUS", {
      requestId: connection.requestId,
      status: "syncing",
      message: "Syncing your league from ESPN...",
    })
  );
  assert.equal(status.status, "syncing");
  assert.equal(status.message, "Syncing your league from ESPN...");

  const payload = { teams: [{ id: 1 }, { id: 2 }] };
  const reference = { leagueId: "42", season: "2026", teamId: "1" };
  testPage.dispatch(
    extensionEvent("CONNECTOR_SUCCESS", {
      requestId: connection.requestId,
      payload,
      reference,
    })
  );
  const result = await connection.result;
  assert.equal(result.payload.teams.length, 2);
  assert.equal(result.reference.leagueId, reference.leagueId);
  assert.equal(result.reference.season, reference.season);
  assert.equal(result.reference.teamId, reference.teamId);
});

test("rejects failed and canceled connection attempts", async () => {
  const failedPage = harness();
  const failed = failedPage.connector.connect();
  testPageError(failedPage, failed.requestId, "ESPN_AUTH_REQUIRED");
  await assert.rejects(failed.result, (error) => {
    assert.equal(error.code, "ESPN_AUTH_REQUIRED");
    return true;
  });

  const canceledPage = harness();
  const canceled = canceledPage.connector.connect();
  canceledPage.connector.cancel(canceled.requestId);
  assert.equal(
    canceledPage.posted.at(-1).message.type,
    "CONNECTOR_CANCEL"
  );
  await assert.rejects(canceled.result, (error) => {
    assert.equal(error.code, "CANCELED");
    return true;
  });
});

function testPageError(testPage, requestId, code) {
  testPage.dispatch(
    extensionEvent("CONNECTOR_ERROR", {
      requestId,
      code,
      message: "The connector failed.",
    })
  );
}
