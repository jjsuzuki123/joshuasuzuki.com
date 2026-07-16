export const PROTOCOL_VERSION = 1;
export const PAGE_SOURCE = "rosterlab-page";
export const EXTENSION_SOURCE = "rosterlab-espn-connector";
export const WORKER_SCOPE = "rosterlab-espn-worker";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const PAGE_REQUEST_TYPES = new Set([
  "CONNECTOR_PING",
  "CONNECTOR_CONNECT",
  "CONNECTOR_CANCEL",
]);
const PAGE_EVENT_TYPES = new Set([
  "CONNECTOR_READY",
  "CONNECTOR_STATUS",
  "CONNECTOR_SUCCESS",
  "CONNECTOR_ERROR",
]);
const WORKER_REQUEST_TYPES = new Set([
  "connector-ping",
  "connector-connect",
  "connector-cancel",
  "espn-location",
]);
const WORKER_EVENT_TYPES = new Set([
  "connector-ready",
  "connector-status",
  "connector-success",
  "connector-error",
]);

export function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.prototype.toString.call(value) === "[object Object]"
  );
}

export function isValidRequestId(value) {
  return REQUEST_ID_PATTERN.test(String(value || ""));
}

export function isValidPageRequest(value) {
  if (
    !isPlainObject(value) ||
    value.source !== PAGE_SOURCE ||
    value.version !== PROTOCOL_VERSION ||
    !PAGE_REQUEST_TYPES.has(value.type)
  ) {
    return false;
  }

  if (value.type === "CONNECTOR_PING") return true;
  if (!isValidRequestId(value.requestId)) return false;
  if (value.type === "CONNECTOR_CONNECT") {
    return value.userGesture === true;
  }
  return true;
}

export function isValidPageEvent(value) {
  return Boolean(
    isPlainObject(value) &&
      value.source === EXTENSION_SOURCE &&
      value.version === PROTOCOL_VERSION &&
      PAGE_EVENT_TYPES.has(value.type) &&
      (value.type === "CONNECTOR_READY" || isValidRequestId(value.requestId))
  );
}

export function isValidWorkerRequest(value) {
  if (
    !isPlainObject(value) ||
    value.scope !== WORKER_SCOPE ||
    !WORKER_REQUEST_TYPES.has(value.type)
  ) {
    return false;
  }

  if (value.type === "connector-ping") return true;
  if (value.type === "espn-location") {
    return typeof value.url === "string" && value.url.length <= 2048;
  }
  return isValidRequestId(value.requestId);
}

export function isValidWorkerEvent(value) {
  return Boolean(
    isPlainObject(value) &&
      value.scope === WORKER_SCOPE &&
      WORKER_EVENT_TYPES.has(value.type) &&
      (value.type === "connector-ready" || isValidRequestId(value.requestId))
  );
}

export function pageEvent(type, fields = {}) {
  if (!PAGE_EVENT_TYPES.has(type)) {
    throw new TypeError(`Unknown page event: ${type}`);
  }
  return {
    source: EXTENSION_SOURCE,
    version: PROTOCOL_VERSION,
    type,
    ...fields,
  };
}

export function workerEvent(type, fields = {}) {
  if (!WORKER_EVENT_TYPES.has(type)) {
    throw new TypeError(`Unknown worker event: ${type}`);
  }
  return {
    scope: WORKER_SCOPE,
    type,
    ...fields,
  };
}
