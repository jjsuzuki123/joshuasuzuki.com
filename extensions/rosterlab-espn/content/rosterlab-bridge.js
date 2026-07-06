(function installRosterLabBridge() {
  "use strict";

  const PAGE_SOURCE = "rosterlab-page";
  const EXTENSION_SOURCE = "rosterlab-espn-connector";
  const WORKER_SCOPE = "rosterlab-espn-worker";
  const VERSION = 1;
  const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
  const TRUSTED_GESTURE_WINDOW_MS = 1_500;
  const WORKER_TO_PAGE = Object.freeze({
    "connector-ready": "CONNECTOR_READY",
    "connector-status": "CONNECTOR_STATUS",
    "connector-success": "CONNECTOR_SUCCESS",
    "connector-error": "CONNECTOR_ERROR",
  });

  let trustedGestureExpiresAt = 0;

  function isPlainObject(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.prototype.toString.call(value) === "[object Object]"
    );
  }

  function validRequestId(value) {
    return REQUEST_ID_PATTERN.test(String(value || ""));
  }

  function postToPage(type, fields) {
    window.postMessage(
      {
        source: EXTENSION_SOURCE,
        version: VERSION,
        type,
        ...(fields || {}),
      },
      window.location.origin
    );
  }

  function safeLeagueReference(value) {
    if (!isPlainObject(value)) return null;
    const reference = {};
    ["leagueId", "season", "teamId"].forEach((key) => {
      if (value[key] == null) return;
      const candidate = String(value[key]).trim();
      if (candidate.length <= 20) reference[key] = candidate;
    });
    return Object.keys(reference).length > 0 ? reference : null;
  }

  async function sendToWorker(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      postToPage("CONNECTOR_ERROR", {
        requestId: message.requestId,
        code: "EXTENSION_UNAVAILABLE",
        message: "The ESPN connector was reloaded. Refresh RosterLab and try again.",
      });
      return null;
    }
  }

  document.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      if (event.target.closest("[data-espn-connector-trigger]")) {
        trustedGestureExpiresAt = Date.now() + TRUSTED_GESTURE_WINDOW_MS;
      }
    },
    true
  );

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (
      !isPlainObject(message) ||
      message.source !== PAGE_SOURCE ||
      message.version !== VERSION
    ) {
      return;
    }

    if (message.type === "CONNECTOR_PING") {
      void sendToWorker({
        scope: WORKER_SCOPE,
        type: "connector-ping",
      }).then((response) => {
        if (response?.scope === WORKER_SCOPE) {
          postToPage("CONNECTOR_READY", { extensionVersion: VERSION });
        }
      });
      return;
    }

    if (!validRequestId(message.requestId)) return;

    if (message.type === "CONNECTOR_CONNECT") {
      if (Date.now() > trustedGestureExpiresAt) {
        postToPage("CONNECTOR_ERROR", {
          requestId: message.requestId,
          code: "USER_GESTURE_REQUIRED",
          message: "Click Connect ESPN again to start the browser connector.",
        });
        return;
      }
      trustedGestureExpiresAt = 0;
      void sendToWorker({
        scope: WORKER_SCOPE,
        type: "connector-connect",
        requestId: message.requestId,
        userGesture: true,
        preferredLeague: safeLeagueReference(message.preferredLeague),
        defaultSeason: String(message.defaultSeason || "").slice(0, 4),
      });
      return;
    }

    if (message.type === "CONNECTOR_CANCEL") {
      void sendToWorker({
        scope: WORKER_SCOPE,
        type: "connector-cancel",
        requestId: message.requestId,
      });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      sender.id !== chrome.runtime.id ||
      !isPlainObject(message) ||
      message.scope !== WORKER_SCOPE ||
      !WORKER_TO_PAGE[message.type]
    ) {
      return;
    }
    if (
      message.type !== "connector-ready" &&
      !validRequestId(message.requestId)
    ) {
      return;
    }

    const { scope, type, ...fields } = message;
    postToPage(WORKER_TO_PAGE[type], fields);
  });

  postToPage("CONNECTOR_READY", { extensionVersion: VERSION });
})();
