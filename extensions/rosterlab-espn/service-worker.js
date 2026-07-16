import {
  ESPN_DASHBOARD_URL,
  buildEspnApiUrl,
  buildEspnLeaguePageUrl,
  isEspnPageUrl,
  isReadableLeaguePayload,
  isRosterLabPageUrl,
  normalizeLeagueReference,
  parseEspnLeagueReference,
} from "./lib/espn.js";
import { isValidWorkerRequest, workerEvent } from "./lib/protocol.js";
import {
  CONNECTION_TTL_MS,
  createConnectionSession,
  isConnectionExpired,
  isValidConnectionSession,
  referenceAttemptKey,
} from "./lib/session.js";

const SESSION_KEY = "pendingRosterLabConnection";
const TIMEOUT_ALARM = "rosterlab-connection-timeout";
const FETCH_TIMEOUT_MS = 20_000;
const WORKER_SCOPE = "rosterlab-espn-worker";
const activeFetches = new Map();
let sessionLock = Promise.resolve();

class ConnectorFetchError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ConnectorFetchError";
    this.code = code;
  }
}

function senderUrl(sender) {
  return sender?.url || sender?.tab?.url || "";
}

function newAttemptToken() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

function withSessionLock(operation) {
  const result = sessionLock.then(operation, operation);
  sessionLock = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function loadSessionLocked() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  const value = stored[SESSION_KEY];
  if (!isValidConnectionSession(value)) {
    if (value != null) await chrome.storage.session.remove(SESSION_KEY);
    return { session: null, expired: null };
  }
  if (isConnectionExpired(value)) {
    await chrome.storage.session.remove(SESSION_KEY);
    await chrome.alarms.clear(TIMEOUT_ALARM);
    return { session: null, expired: value };
  }
  return { session: value, expired: null };
}

async function writeSessionLocked(session) {
  if (!isValidConnectionSession(session) || isConnectionExpired(session)) {
    throw new Error("Cannot persist an invalid or expired connector session.");
  }
  await chrome.storage.session.set({ [SESSION_KEY]: session });
  await chrome.alarms.create(TIMEOUT_ALARM, {
    when: session.startedAt + CONNECTION_TTL_MS,
  });
  return session;
}

async function notifyExpiredSession(session) {
  if (!session) return;
  abortActiveFetch(session.requestId);
  await sendToRosterLab(session, "connector-error", {
    code: "CONNECTION_TIMEOUT",
    message: "The ESPN connection expired. Start again when you are ready.",
  });
}

async function readSession() {
  const result = await withSessionLock(loadSessionLocked);
  await notifyExpiredSession(result.expired);
  return result.session;
}

async function replaceSession(session) {
  const result = await withSessionLock(async () => {
    const current = await loadSessionLocked();
    await writeSessionLocked(session);
    return { previous: current.session, expired: current.expired };
  });
  await notifyExpiredSession(result.expired);
  return result.previous;
}

async function updateSession(requestId, updater) {
  const result = await withSessionLock(async () => {
    const current = await loadSessionLocked();
    if (current.session?.requestId !== requestId) {
      return { session: null, expired: current.expired };
    }
    const next = updater({ ...current.session });
    if (next === null) {
      return { session: null, expired: current.expired };
    }
    if (!isValidConnectionSession(next)) {
      throw new Error("Connector session update was invalid.");
    }
    await writeSessionLocked(next);
    return { session: next, expired: current.expired };
  });
  await notifyExpiredSession(result.expired);
  return result.session;
}

async function clearSession(requestId) {
  const result = await withSessionLock(async () => {
    const current = await loadSessionLocked();
    if (
      !current.session ||
      (requestId && current.session.requestId !== requestId)
    ) {
      return { cleared: null, expired: current.expired };
    }
    await chrome.storage.session.remove(SESSION_KEY);
    await chrome.alarms.clear(TIMEOUT_ALARM);
    return { cleared: current.session, expired: current.expired };
  });
  await notifyExpiredSession(result.expired);
  if (result.cleared) abortActiveFetch(result.cleared.requestId);
  return result.cleared;
}

async function beginAttempt(requestId, reference, keepAwaiting) {
  const token = newAttemptToken();
  const key = referenceAttemptKey(reference);
  const result = await withSessionLock(async () => {
    const current = await loadSessionLocked();
    const session = current.session;
    if (session?.requestId !== requestId) {
      return { attempt: null, expired: current.expired };
    }
    const active = activeFetches.get(requestId);
    if (
      session.activeReferenceKey === key &&
      session.attemptToken &&
      active?.attemptToken === session.attemptToken
    ) {
      return {
        attempt: { session, duplicate: true, previousToken: null },
        expired: current.expired,
      };
    }
    const previousToken = session.attemptToken;
    const next = {
      ...session,
      attemptToken: token,
      activeReferenceKey: key,
      awaitingEspn: keepAwaiting,
      navigationToken: null,
    };
    await writeSessionLocked(next);
    return {
      attempt: {
        session: next,
        duplicate: false,
        previousToken,
      },
      expired: current.expired,
    };
  });
  await notifyExpiredSession(result.expired);
  if (result.attempt?.previousToken) {
    abortActiveFetch(requestId, result.attempt.previousToken);
  }
  return result.attempt;
}

async function currentSessionFor(requestId) {
  const current = await readSession();
  return current?.requestId === requestId ? current : null;
}

async function currentSessionForAttempt(requestId, attemptToken) {
  const current = await currentSessionFor(requestId);
  return current?.attemptToken === attemptToken ? current : null;
}

async function resetAttempt(requestId, attemptToken, awaitingEspn) {
  return updateSession(requestId, (current) => {
    if (current.attemptToken !== attemptToken) return null;
    return {
      ...current,
      attemptToken: null,
      activeReferenceKey: null,
      awaitingEspn,
    };
  });
}

async function takeSessionForAttempt(requestId, attemptToken) {
  const result = await withSessionLock(async () => {
    const current = await loadSessionLocked();
    if (
      current.session?.requestId !== requestId ||
      current.session.attemptToken !== attemptToken
    ) {
      return { session: null, expired: current.expired };
    }
    await chrome.storage.session.remove(SESSION_KEY);
    await chrome.alarms.clear(TIMEOUT_ALARM);
    return { session: current.session, expired: current.expired };
  });
  await notifyExpiredSession(result.expired);
  if (result.session) activeFetches.delete(requestId);
  return result.session;
}

function abortActiveFetch(requestId, attemptToken = null) {
  const active = activeFetches.get(requestId);
  if (!active || (attemptToken && active.attemptToken !== attemptToken)) return;
  if (active.controller) active.controller.abort();
  if (active.transport === "espn-tab" && Number.isInteger(active.tabId)) {
    void chrome.tabs
      .sendMessage(active.tabId, {
        scope: WORKER_SCOPE,
        type: "cancel-fetch",
        requestId,
        attemptToken: active.attemptToken,
      })
      .catch(() => {});
  }
  activeFetches.delete(requestId);
}

async function sendToRosterLab(session, type, fields = {}) {
  if (!isValidConnectionSession(session)) return false;
  try {
    await chrome.tabs.sendMessage(
      session.sourceTabId,
      workerEvent(type, {
        requestId: session.requestId,
        ...fields,
      })
    );
    return true;
  } catch (error) {
    return false;
  }
}

async function failConnection(session, code, message) {
  const cleared = await clearSession(session.requestId);
  if (!cleared) return;
  await sendToRosterLab(cleared, "connector-error", { code, message });
}

async function fetchLeaguePayload(reference, controller) {
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  const requestUrl = buildEspnApiUrl(reference);

  try {
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    return await parseEspnResponse(response);
  } catch (error) {
    if (error?.name === "AbortError") {
      if (!timedOut) {
        throw new ConnectorFetchError(
          "The ESPN request was canceled.",
          "CANCELED"
        );
      }
      throw new ConnectorFetchError(
        "ESPN took too long to respond. Try again.",
        "ESPN_TIMEOUT"
      );
    }
    if (error instanceof ConnectorFetchError) throw error;
    throw new ConnectorFetchError(
      "RosterLab could not reach ESPN. Check your connection and try again.",
      "ESPN_UNAVAILABLE"
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseEspnResponse(response) {
  if (response.status === 401 || response.status === 403) {
    throw new ConnectorFetchError(
      "Sign in to ESPN to access this league.",
      "ESPN_AUTH_REQUIRED"
    );
  }
  if (response.status === 404) {
    throw new ConnectorFetchError(
      "ESPN could not find that league for this season.",
      "ESPN_LEAGUE_NOT_FOUND"
    );
  }
  if (!response.ok) {
    throw new ConnectorFetchError(
      `ESPN returned ${response.status}. Try again in a moment.`,
      "ESPN_REQUEST_FAILED"
    );
  }
  const contentType = response.headers?.get?.("content-type") || "";
  if (
    response.redirected ||
    (contentType && !contentType.toLowerCase().includes("json"))
  ) {
    throw new ConnectorFetchError(
      "Sign in to ESPN to access this league.",
      "ESPN_AUTH_REQUIRED"
    );
  }
  const payload = await response.json().catch(() => null);
  if (!isReadableLeaguePayload(payload)) {
    throw new ConnectorFetchError(
      "ESPN returned league data RosterLab could not read.",
      "ESPN_INVALID_RESPONSE"
    );
  }
  return payload;
}

async function fetchLeagueFromEspnTab(session, reference, attemptToken) {
  if (!Number.isInteger(session.espnTabId)) {
    throw new ConnectorFetchError(
      "Open the ESPN league tab and try again.",
      "ESPN_TAB_UNAVAILABLE"
    );
  }
  let response;
  try {
    response = await chrome.tabs.sendMessage(session.espnTabId, {
      scope: WORKER_SCOPE,
      type: "fetch-league",
      requestId: session.requestId,
      attemptToken,
      reference,
    });
  } catch (error) {
    throw new ConnectorFetchError(
      "The ESPN tab closed or could not run the league request.",
      "ESPN_TAB_UNAVAILABLE"
    );
  }
  if (!response?.ok) {
    throw new ConnectorFetchError(
      String(response?.message || "The ESPN league request failed."),
      String(response?.code || "ESPN_REQUEST_FAILED")
    );
  }
  if (!isReadableLeaguePayload(response.payload)) {
    throw new ConnectorFetchError(
      "ESPN returned league data RosterLab could not read.",
      "ESPN_INVALID_RESPONSE"
    );
  }
  return response.payload;
}

async function focusRosterLab(session) {
  try {
    await chrome.tabs.update(session.sourceTabId, { active: true });
  } catch (error) {
    // The source tab may have closed while ESPN was loading.
  }
}

async function waitForEspn(session, reference = null) {
  const targetUrl = reference
    ? buildEspnLeaguePageUrl(reference)
    : ESPN_DASHBOARD_URL;
  const navigationToken = newAttemptToken();
  let current = await updateSession(session.requestId, (latest) => ({
    ...latest,
    awaitingEspn: true,
    attemptToken: null,
    activeReferenceKey: null,
    navigationToken,
  }));
  if (!current) return;

  if (Number.isInteger(current.espnTabId)) {
    try {
      await chrome.tabs.update(current.espnTabId, {
        url: targetUrl,
        active: true,
      });
      const latest = await currentSessionFor(current.requestId);
      if (latest?.navigationToken === navigationToken) {
        await sendWaitingStatus(latest, reference);
      }
      return;
    } catch (error) {
      current = await updateSession(current.requestId, (latest) =>
        latest.navigationToken === navigationToken
          ? { ...latest, espnTabId: null }
          : null
      );
      if (!current) return;
    }
  }

  let tab;
  try {
    tab = await chrome.tabs.create({ url: "about:blank", active: true });
  } catch (error) {
    const latest = await currentSessionFor(current.requestId);
    if (latest?.navigationToken === navigationToken) {
      await failConnection(
        latest,
        "ESPN_TAB_UNAVAILABLE",
        "RosterLab could not open an ESPN tab."
      );
    }
    return;
  }

  const bound = await updateSession(current.requestId, (latest) =>
    latest.navigationToken === navigationToken
      ? { ...latest, espnTabId: tab.id }
      : null
  );
  if (!bound) {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (error) {
      // The tab may already have closed.
    }
    return;
  }

  try {
    await chrome.tabs.update(tab.id, { url: targetUrl, active: true });
  } catch (error) {
    const latest = await currentSessionFor(bound.requestId);
    if (latest?.navigationToken === navigationToken) {
      await failConnection(
        latest,
        "ESPN_TAB_UNAVAILABLE",
        "RosterLab could not open ESPN."
      );
    }
    return;
  }
  const latest = await currentSessionFor(bound.requestId);
  if (
    latest?.espnTabId === tab.id &&
    latest.navigationToken === navigationToken
  ) {
    await sendWaitingStatus(latest, reference);
  }
}

async function sendWaitingStatus(session, reference) {
  await sendToRosterLab(session, "connector-status", {
    status: reference ? "login-required" : "choose-league",
    message: reference
      ? "Sign in on ESPN. RosterLab will sync this league after ESPN opens it."
      : "Sign in on ESPN, then open the baseball league you want to sync.",
  });
}

async function syncReference(session, reference, options = {}) {
  const current = await currentSessionFor(session.requestId);
  if (!current) return;

  let normalized;
  try {
    normalized = normalizeLeagueReference(reference, {
      defaultSeason: current.defaultSeason,
    });
  } catch (error) {
    await failConnection(
      current,
      "INVALID_LEAGUE_REFERENCE",
      "ESPN did not provide a valid baseball league link."
    );
    return;
  }

  const transport =
    options.transport === "espn-tab" ? "espn-tab" : "worker";
  const attempt = await beginAttempt(
    current.requestId,
    normalized,
    transport === "espn-tab"
  );
  if (!attempt || attempt.duplicate) return;

  await sendToRosterLab(attempt.session, "connector-status", {
    status: "syncing",
    message: "Syncing your league from ESPN...",
  });

  const active = {
    attemptToken: attempt.session.attemptToken,
    transport,
    tabId: attempt.session.espnTabId,
    controller: transport === "worker" ? new AbortController() : null,
  };
  activeFetches.set(current.requestId, active);
  const stillCurrent = await currentSessionForAttempt(
    current.requestId,
    active.attemptToken
  );
  if (!stillCurrent) {
    abortActiveFetch(current.requestId, active.attemptToken);
    return;
  }

  try {
    const payload =
      transport === "espn-tab"
        ? await fetchLeagueFromEspnTab(
            stillCurrent,
            normalized,
            active.attemptToken
          )
        : await fetchLeaguePayload(normalized, active.controller);
    const completed = await takeSessionForAttempt(
      current.requestId,
      active.attemptToken
    );
    if (!completed) return;
    await sendToRosterLab(completed, "connector-success", {
      payload,
      reference: normalized,
    });
    await focusRosterLab(completed);
  } catch (error) {
    const latest = await currentSessionForAttempt(
      current.requestId,
      active.attemptToken
    );
    if (!latest || error?.code === "CANCELED") return;

    if (error?.code === "ESPN_AUTH_REQUIRED") {
      const waiting = await resetAttempt(
        latest.requestId,
        active.attemptToken,
        true
      );
      abortActiveFetch(latest.requestId, active.attemptToken);
      if (!waiting) return;
      if (options.openLogin !== false) {
        await waitForEspn(waiting, normalized);
      } else {
        await sendToRosterLab(waiting, "connector-status", {
          status: "login-required",
          message: "Finish signing in on ESPN, then open this baseball league.",
        });
      }
      return;
    }

    const failed = await takeSessionForAttempt(
      latest.requestId,
      active.attemptToken
    );
    if (!failed) return;
    await sendToRosterLab(failed, "connector-error", {
      code: error?.code || "ESPN_REQUEST_FAILED",
      message: error instanceof Error ? error.message : "The ESPN sync failed.",
    });
  } finally {
    const activeNow = activeFetches.get(current.requestId);
    if (activeNow?.attemptToken === active.attemptToken) {
      activeFetches.delete(current.requestId);
    }
  }
}

async function startConnection(message, sender) {
  const sourceTabId = sender?.tab?.id;
  if (
    !Number.isInteger(sourceTabId) ||
    !isRosterLabPageUrl(senderUrl(sender)) ||
    message.userGesture !== true
  ) {
    return;
  }

  const session = createConnectionSession({
    requestId: message.requestId,
    sourceTabId,
    defaultSeason: message.defaultSeason,
  });
  const previous = await replaceSession(session);
  if (previous) {
    abortActiveFetch(previous.requestId);
    await sendToRosterLab(previous, "connector-error", {
      code: "CONNECTION_REPLACED",
      message: "A newer ESPN connection replaced this attempt.",
    });
  }

  await sendToRosterLab(session, "connector-status", {
    status: "starting",
    message: "Checking for your ESPN league...",
  });

  if (message.preferredLeague) {
    await syncReference(session, message.preferredLeague, {
      openLogin: true,
      transport: "worker",
    });
    return;
  }
  await waitForEspn(session);
}

async function cancelConnection(message, sender) {
  const session = await readSession();
  if (
    !session ||
    session.requestId !== message.requestId ||
    sender?.tab?.id !== session.sourceTabId ||
    !isRosterLabPageUrl(senderUrl(sender))
  ) {
    return;
  }
  await clearSession(session.requestId);
}

async function handleEspnLocation(message, sender) {
  const session = await readSession();
  if (
    !session ||
    session.awaitingEspn !== true ||
    !Number.isInteger(sender?.tab?.id) ||
    sender.tab.id !== session.espnTabId ||
    !isEspnPageUrl(senderUrl(sender)) ||
    !isEspnPageUrl(message.url)
  ) {
    return;
  }

  const reference = parseEspnLeagueReference(message.url, {
    defaultSeason: session.defaultSeason,
  });
  if (!reference) {
    await sendToRosterLab(session, "connector-status", {
      status: "choose-league",
      message: "On ESPN, open the baseball league you want to sync.",
    });
    return;
  }
  await syncReference(session, reference, {
    openLogin: false,
    transport: "espn-tab",
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isValidWorkerRequest(message)) return false;

  if (
    message.type === "connector-ping" &&
    isRosterLabPageUrl(senderUrl(sender))
  ) {
    sendResponse(workerEvent("connector-ready", { version: 1 }));
    return false;
  }

  let task = null;
  if (message.type === "connector-connect") {
    task = startConnection(message, sender);
  } else if (message.type === "connector-cancel") {
    task = cancelConnection(message, sender);
  } else if (message.type === "espn-location") {
    task = handleEspnLocation(message, sender);
  }
  if (!task) return false;

  task
    .then(() => sendResponse({ accepted: true }))
    .catch(async () => {
      if (message.requestId) {
        const session = await currentSessionFor(message.requestId);
        if (session) {
          await failConnection(
            session,
            "CONNECTOR_FAILED",
            "The ESPN connector stopped unexpectedly. Try again."
          );
        }
      }
      sendResponse({ accepted: false });
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const session = await readSession();
    if (!session) return;
    if (session.sourceTabId === tabId) {
      await clearSession(session.requestId);
      return;
    }
    if (session.espnTabId === tabId) {
      await failConnection(
        session,
        "ESPN_TAB_CLOSED",
        "The ESPN tab closed before the league finished syncing."
      );
    }
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TIMEOUT_ALARM) return;
  void (async () => {
    const session = await readSession();
    if (session) {
      await chrome.alarms.create(TIMEOUT_ALARM, {
        when: session.startedAt + CONNECTION_TTL_MS,
      });
    }
  })();
});

chrome.runtime.onInstalled.addListener(() => {
  void clearSession();
});
