(function createEspnBrowserConnector(root) {
  "use strict";

  const PAGE_SOURCE = "rosterlab-page";
  const EXTENSION_SOURCE = "rosterlab-espn-connector";
  const VERSION = 1;
  const CONNECTION_TIMEOUT_MS = 11 * 60 * 1_000;
  const EVENT_TYPES = new Set([
    "CONNECTOR_READY",
    "CONNECTOR_STATUS",
    "CONNECTOR_SUCCESS",
    "CONNECTOR_ERROR",
  ]);
  const pendingConnections = new Map();
  const pendingPings = new Set();
  let available = false;

  class BrowserConnectorError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "BrowserConnectorError";
      this.code = code || "CONNECTOR_ERROR";
    }
  }

  function isPlainObject(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.prototype.toString.call(value) === "[object Object]"
    );
  }

  function requestId() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      return `rl_${root.crypto.randomUUID()}`;
    }
    return `rl_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
  }

  function post(type, fields) {
    root.postMessage(
      {
        source: PAGE_SOURCE,
        version: VERSION,
        type,
        ...(fields || {}),
      },
      root.location.origin
    );
  }

  function resolvePings() {
    available = true;
    pendingPings.forEach((ping) => {
      root.clearTimeout(ping.timeoutId);
      ping.resolve(true);
    });
    pendingPings.clear();
  }

  function settleConnection(id, action, value) {
    const pending = pendingConnections.get(id);
    if (!pending) return;
    root.clearTimeout(pending.timeoutId);
    pendingConnections.delete(id);
    pending[action](value);
  }

  root.addEventListener("message", (event) => {
    if (event.source !== root || event.origin !== root.location.origin) return;
    const message = event.data;
    if (
      !isPlainObject(message) ||
      message.source !== EXTENSION_SOURCE ||
      message.version !== VERSION ||
      !EVENT_TYPES.has(message.type)
    ) {
      return;
    }

    if (message.type === "CONNECTOR_READY") {
      resolvePings();
      return;
    }

    const pending = pendingConnections.get(message.requestId);
    if (!pending) return;

    if (message.type === "CONNECTOR_STATUS") {
      if (typeof pending.onStatus === "function") {
        try {
          pending.onStatus({
            status: String(message.status || ""),
            message: String(message.message || ""),
          });
        } catch (error) {
          // UI callbacks must not interrupt the connector protocol.
        }
      }
      return;
    }

    if (message.type === "CONNECTOR_SUCCESS") {
      settleConnection(message.requestId, "resolve", {
        payload: message.payload,
        reference: message.reference,
      });
      return;
    }

    if (message.code === "EXTENSION_UNAVAILABLE") available = false;
    settleConnection(
      message.requestId,
      "reject",
      new BrowserConnectorError(
        String(message.message || "The ESPN connector could not finish."),
        String(message.code || "CONNECTOR_ERROR")
      )
    );
  });

  function ping(timeout = 700) {
    return new Promise((resolve) => {
      const pingRequest = {
        resolve,
        timeoutId: root.setTimeout(() => {
          pendingPings.delete(pingRequest);
          available = false;
          resolve(false);
        }, timeout),
      };
      pendingPings.add(pingRequest);
      post("CONNECTOR_PING");
    });
  }

  function connect(options = {}) {
    const id = requestId();
    let resolveConnection;
    let rejectConnection;
    const result = new Promise((resolve, reject) => {
      resolveConnection = resolve;
      rejectConnection = reject;
    });
    const timeoutId = root.setTimeout(() => {
      post("CONNECTOR_CANCEL", { requestId: id });
      settleConnection(
        id,
        "reject",
        new BrowserConnectorError(
          "The ESPN connection expired. Start again when you are ready.",
          "CONNECTION_TIMEOUT"
        )
      );
    }, CONNECTION_TIMEOUT_MS);

    pendingConnections.set(id, {
      resolve: resolveConnection,
      reject: rejectConnection,
      timeoutId,
      onStatus: options.onStatus,
    });
    post("CONNECTOR_CONNECT", {
      requestId: id,
      userGesture: true,
      preferredLeague: options.preferredLeague || null,
      defaultSeason: options.defaultSeason || null,
    });

    return { requestId: id, result };
  }

  function cancel(id) {
    if (!pendingConnections.has(id)) return;
    post("CONNECTOR_CANCEL", { requestId: id });
    settleConnection(
      id,
      "reject",
      new BrowserConnectorError("The ESPN connection was canceled.", "CANCELED")
    );
  }

  root.RosterLabEspnConnector = Object.freeze({
    BrowserConnectorError,
    cancel,
    connect,
    get available() {
      return available;
    },
    ping,
  });
})(window);
