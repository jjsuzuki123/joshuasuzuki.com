import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const bridgeSource = await readFile(
  new URL("../content/rosterlab-bridge.js", import.meta.url),
  "utf8"
);
const requestId = "request_12345678";

function bridgeHarness() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const runtimeListeners = [];
  const pageMessages = [];
  const workerMessages = [];

  class FakeElement {
    closest(selector) {
      return selector === "[data-espn-connector-trigger]" ? this : null;
    }
  }

  const window = {
    location: { origin: "https://www.joshuasuzuki.com" },
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    postMessage(message, targetOrigin) {
      pageMessages.push({ message, targetOrigin });
    },
  };
  const document = {
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
  };
  const chrome = {
    runtime: {
      id: "extension-id",
      async sendMessage(message) {
        workerMessages.push(message);
        if (message.type === "connector-ping") {
          return { scope: "rosterlab-espn-worker", type: "connector-ready" };
        }
        return { accepted: true };
      },
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        },
      },
    },
  };

  vm.runInNewContext(bridgeSource, {
    Element: FakeElement,
    Object,
    chrome,
    document,
    window,
  });

  return {
    FakeElement,
    pageMessages,
    workerMessages,
    click(event) {
      documentListeners.get("click")(event);
    },
    pageRequest(message) {
      windowListeners.get("message")({
        source: window,
        origin: window.location.origin,
        data: message,
      });
    },
    workerEvent(message) {
      runtimeListeners[0](message, { id: chrome.runtime.id });
    },
  };
}

function connectRequest() {
  return {
    source: "rosterlab-page",
    version: 1,
    type: "CONNECTOR_CONNECT",
    requestId,
  };
}

test("requires a trusted click before forwarding a connection", () => {
  const bridge = bridgeHarness();
  bridge.pageRequest(connectRequest());

  assert.equal(
    bridge.pageMessages.at(-1).message.code,
    "USER_GESTURE_REQUIRED"
  );
  assert.equal(
    bridge.workerMessages.some((message) => message.type === "connector-connect"),
    false
  );
});

test("forwards a connection after the connector button receives a trusted click", () => {
  const bridge = bridgeHarness();
  bridge.click({
    isTrusted: true,
    target: new bridge.FakeElement(),
  });
  bridge.pageRequest(connectRequest());

  const forwarded = bridge.workerMessages.at(-1);
  assert.equal(forwarded.type, "connector-connect");
  assert.equal(forwarded.requestId, requestId);
  assert.equal(forwarded.userGesture, true);
});

test("returns only extension-owned worker events to the page", () => {
  const bridge = bridgeHarness();
  bridge.workerEvent({
    scope: "rosterlab-espn-worker",
    type: "connector-status",
    requestId,
    status: "syncing",
    message: "Syncing...",
  });
  assert.equal(bridge.pageMessages.at(-1).message.type, "CONNECTOR_STATUS");

  const messageCount = bridge.pageMessages.length;
  bridge.workerEvent({
    scope: "unknown-worker",
    type: "connector-success",
    requestId,
  });
  assert.equal(bridge.pageMessages.length, messageCount);
});
