import test from "node:test";
import assert from "node:assert/strict";

function eventTarget() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
  };
}

function chromeHarness() {
  const sessionStorage = {};
  const sentMessages = [];
  const createdAlarms = [];
  const removedTabs = [];
  const runtimeOnMessage = eventTarget();
  let tabFetchHandler = async () => ({
    ok: true,
    payload: { teams: [{ id: 1 }, { id: 2 }] },
  });
  let tabCancelHandler = () => {};
  let tabCreateHandler = async ({ url, active }) => ({ id: 20, url, active });
  const chrome = {
    storage: {
      session: {
        async get(key) {
          return { [key]: sessionStorage[key] };
        },
        async set(values) {
          Object.assign(sessionStorage, values);
        },
        async remove(key) {
          delete sessionStorage[key];
        },
      },
    },
    alarms: {
      async create(name, options) {
        createdAlarms.push({ name, options });
      },
      async clear() {
        return true;
      },
      onAlarm: eventTarget(),
    },
    tabs: {
      async query() {
        return [];
      },
      async create({ url, active }) {
        return tabCreateHandler({ url, active });
      },
      async update(id, update) {
        return { id, ...update };
      },
      async sendMessage(tabId, message) {
        sentMessages.push({ tabId, message });
        if (message.type === "fetch-league") {
          return tabFetchHandler(message);
        }
        if (message.type === "cancel-fetch") {
          tabCancelHandler(message);
          return { ok: true };
        }
        return undefined;
      },
      async remove(tabId) {
        removedTabs.push(tabId);
      },
      onUpdated: eventTarget(),
      onRemoved: eventTarget(),
    },
    runtime: {
      onMessage: runtimeOnMessage,
      onInstalled: eventTarget(),
    },
  };
  return {
    chrome,
    createdAlarms,
    removedTabs,
    runtimeOnMessage,
    sentMessages,
    sessionStorage,
    setTabFetchHandler(handler) {
      tabFetchHandler = handler;
    },
    setTabCancelHandler(handler) {
      tabCancelHandler = handler;
    },
    setTabCreateHandler(handler) {
      tabCreateHandler = handler;
    },
  };
}

function sendRuntimeMessage(listener, message, sender) {
  return new Promise((resolve) => {
    const keepChannelOpen = listener(message, sender, resolve);
    assert.equal(keepChannelOpen, true);
  });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for connector test state.");
}

test("service worker fetches a preferred league and cleans up state", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const harness = chromeHarness();
  let fetchRequest = null;
  let fetchMode = "success";
  let deferredWorkerFetchStarted = false;
  globalThis.chrome = harness.chrome;
  globalThis.fetch = async (url, options) => {
    fetchRequest = { url, options };
    if (fetchMode === "deferred") {
      deferredWorkerFetchStarted = true;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true }
        );
      });
    }
    if (fetchMode === "auth-required") {
      return {
        ok: false,
        status: 403,
        async json() {
          return {};
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { teams: [{ id: 1 }, { id: 2 }] };
      },
    };
  };

  try {
    await import(
      new URL(`../service-worker.js?test=${Date.now()}`, import.meta.url)
    );
    const listener = harness.runtimeOnMessage.listeners[0];
    assert.equal(typeof listener, "function");

    const response = await new Promise((resolve) => {
      const keepChannelOpen = listener(
        {
          scope: "rosterlab-espn-worker",
          type: "connector-connect",
          requestId: "request_12345678",
          userGesture: true,
          preferredLeague: {
            leagueId: "42",
            season: "2026",
            teamId: "1",
          },
        },
        {
          url: "https://www.joshuasuzuki.com/fantasy/",
          tab: {
            id: 10,
            url: "https://www.joshuasuzuki.com/fantasy/",
          },
        },
        resolve
      );
      assert.equal(keepChannelOpen, true);
    });

    assert.deepEqual(response, { accepted: true });
    assert.equal(fetchRequest.options.credentials, "include");
    assert.equal(fetchRequest.options.method, "GET");
    assert.match(
      fetchRequest.url,
      /^https:\/\/lm-api-reads\.fantasy\.espn\.com\/apis\/v3\/games\/flb\/seasons\/2026\/segments\/0\/leagues\/42\?/
    );
    assert.equal("body" in fetchRequest.options, false);
    assert.equal(
      harness.sentMessages.some(
        ({ message }) => message.type === "connector-success"
      ),
      true
    );
    assert.deepEqual(harness.sessionStorage, {});

    fetchMode = "auth-required";
    await new Promise((resolve) => {
      listener(
        {
          scope: "rosterlab-espn-worker",
          type: "connector-connect",
          requestId: "request_87654321",
          userGesture: true,
          preferredLeague: {
            leagueId: "43",
            season: "2026",
            teamId: "2",
          },
        },
        {
          url: "https://www.joshuasuzuki.com/fantasy/",
          tab: {
            id: 10,
            url: "https://www.joshuasuzuki.com/fantasy/",
          },
        },
        resolve
      );
    });
    const waiting = harness.sessionStorage.pendingRosterLabConnection;
    assert.equal(waiting.espnTabId, 20);
    assert.equal(waiting.awaitingEspn, true);
    assert.equal(waiting.defaultSeason, "2026");
    assert.equal(
      harness.createdAlarms.at(-1).options.when - waiting.startedAt,
      10 * 60 * 1_000
    );
    assert.equal(
      harness.sentMessages.some(
        ({ message }) => message.status === "login-required"
      ),
      true
    );

    fetchMode = "success";
    await new Promise((resolve) => {
      listener(
        {
          scope: "rosterlab-espn-worker",
          type: "espn-location",
          url: "https://fantasy.espn.com/baseball/team?leagueId=43&seasonId=2026&teamId=2",
        },
        {
          url: "https://fantasy.espn.com/baseball/team?leagueId=43&seasonId=2026&teamId=2",
          tab: {
            id: 20,
            url: "https://fantasy.espn.com/baseball/team?leagueId=43&seasonId=2026&teamId=2",
          },
        },
        resolve
      );
    });
    assert.equal(
      harness.sentMessages.filter(
        ({ message }) => message.type === "connector-success"
      ).length,
      2
    );
    assert.equal(
      harness.sentMessages.some(
        ({ message }) => message.type === "fetch-league"
      ),
      true
    );
    assert.deepEqual(harness.sessionStorage, {});

    const sourceSender = {
      url: "https://www.joshuasuzuki.com/fantasy/",
      tab: {
        id: 10,
        url: "https://www.joshuasuzuki.com/fantasy/",
      },
    };
    const espnSender = (url) => ({
      url,
      tab: { id: 20, url },
    });
    const deferredFetches = new Map();
    harness.setTabFetchHandler(
      (message) =>
        new Promise((resolve) => {
          deferredFetches.set(message.reference.leagueId, resolve);
        })
    );

    const raceRequestId = "request_race_1234";
    await sendRuntimeMessage(
      listener,
      {
        scope: "rosterlab-espn-worker",
        type: "connector-connect",
        requestId: raceRequestId,
        userGesture: true,
        defaultSeason: "2026",
      },
      sourceSender
    );
    const firstUrl =
      "https://fantasy.espn.com/baseball/team?leagueId=100&seasonId=2026&teamId=1";
    const secondUrl =
      "https://fantasy.espn.com/baseball/team?leagueId=200&seasonId=2026&teamId=2";
    const firstLocation = sendRuntimeMessage(
      listener,
      {
        scope: "rosterlab-espn-worker",
        type: "espn-location",
        url: firstUrl,
      },
      espnSender(firstUrl)
    );
    await waitFor(() => deferredFetches.has("100"));
    const secondLocation = sendRuntimeMessage(
      listener,
      {
        scope: "rosterlab-espn-worker",
        type: "espn-location",
        url: secondUrl,
      },
      espnSender(secondUrl)
    );
    await waitFor(() => deferredFetches.has("200"));

    deferredFetches.get("100")({
      ok: true,
      payload: { teams: [{ id: 1 }, { id: 2 }] },
    });
    await firstLocation;
    deferredFetches.get("200")({
      ok: true,
      payload: { teams: [{ id: 1 }, { id: 2 }] },
    });
    await secondLocation;
    const raceSuccesses = harness.sentMessages.filter(
      ({ message }) =>
        message.type === "connector-success" &&
        message.requestId === raceRequestId
    );
    assert.equal(raceSuccesses.length, 1);
    assert.equal(raceSuccesses[0].message.reference.leagueId, "200");
    assert.deepEqual(harness.sessionStorage, {});

    const cancelRequestId = "request_cancel_1234";
    const canceledFetches = new Map();
    harness.setTabFetchHandler(
      (message) =>
        new Promise((resolve) => {
          canceledFetches.set(message.attemptToken, resolve);
        })
    );
    harness.setTabCancelHandler((message) => {
      canceledFetches.get(message.attemptToken)?.({
        ok: false,
        code: "CANCELED",
        message: "Canceled.",
      });
    });
    await sendRuntimeMessage(
      listener,
      {
        scope: "rosterlab-espn-worker",
        type: "connector-connect",
        requestId: cancelRequestId,
        userGesture: true,
        defaultSeason: "2026",
      },
      sourceSender
    );
    const cancelUrl =
      "https://fantasy.espn.com/baseball/team?leagueId=300&seasonId=2026&teamId=3";
    const pendingLocation = sendRuntimeMessage(
      listener,
      {
        scope: "rosterlab-espn-worker",
        type: "espn-location",
        url: cancelUrl,
      },
      espnSender(cancelUrl)
    );
    await waitFor(() => canceledFetches.size === 1);
    await sendRuntimeMessage(
      listener,
      {
        scope: "rosterlab-espn-worker",
        type: "connector-cancel",
        requestId: cancelRequestId,
      },
      sourceSender
    );
    await pendingLocation;
    assert.deepEqual(harness.sessionStorage, {});
    assert.equal(
      harness.sentMessages.some(
        ({ message }) =>
          message.type === "connector-success" &&
          message.requestId === cancelRequestId
      ),
      false
    );

    let resolveCreatedTab;
    let tabCreationStarted = false;
    harness.setTabCreateHandler(
      ({ url, active }) =>
        new Promise((resolve) => {
          tabCreationStarted = true;
          resolveCreatedTab = () => resolve({ id: 21, url, active });
        })
    );
    const staleRequestId = "request_stale_1234";
    const staleConnect = sendRuntimeMessage(
      listener,
      {
        scope: "rosterlab-espn-worker",
        type: "connector-connect",
        requestId: staleRequestId,
        userGesture: true,
        defaultSeason: "2026",
      },
      sourceSender
    );
    await waitFor(() => tabCreationStarted);
    await sendRuntimeMessage(
      listener,
      {
        scope: "rosterlab-espn-worker",
        type: "connector-cancel",
        requestId: staleRequestId,
      },
      sourceSender
    );
    resolveCreatedTab();
    await staleConnect;
    assert.deepEqual(harness.sessionStorage, {});
    assert.equal(harness.removedTabs.includes(21), true);

    fetchMode = "deferred";
    const directCancelRequestId = "request_direct_cancel_1234";
    const directConnect = sendRuntimeMessage(
      listener,
      {
        scope: "rosterlab-espn-worker",
        type: "connector-connect",
        requestId: directCancelRequestId,
        userGesture: true,
        preferredLeague: {
          leagueId: "400",
          season: "2026",
          teamId: "4",
        },
      },
      sourceSender
    );
    await waitFor(() => deferredWorkerFetchStarted);
    await sendRuntimeMessage(
      listener,
      {
        scope: "rosterlab-espn-worker",
        type: "connector-cancel",
        requestId: directCancelRequestId,
      },
      sourceSender
    );
    await directConnect;
    assert.equal(fetchRequest.options.signal.aborted, true);
    assert.deepEqual(harness.sessionStorage, {});
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
