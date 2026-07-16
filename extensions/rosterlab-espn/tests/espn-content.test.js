import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(
  new URL("../content/espn-location.js", import.meta.url),
  "utf8"
);

function contentHarness() {
  const runtimeListeners = [];
  const fetchCalls = [];
  const chrome = {
    runtime: {
      id: "extension-id",
      async sendMessage() {
        return { accepted: true };
      },
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        },
      },
    },
  };
  const window = {
    location: {
      href: "https://fantasy.espn.com/baseball/team?leagueId=42&seasonId=2026&teamId=1",
    },
    addEventListener() {},
    setInterval() {
      return 1;
    },
    setTimeout,
    clearTimeout,
  };
  const document = {
    visibilityState: "visible",
    addEventListener() {},
  };
  const fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      redirected: false,
      status: 200,
      headers: {
        get() {
          return "application/json";
        },
      },
      async json() {
        return { teams: [{ id: 1 }, { id: 2 }] };
      },
    };
  };

  vm.runInNewContext(source, {
    AbortController,
    Array,
    URL,
    chrome,
    document,
    fetch,
    window,
  });
  return { chrome, fetchCalls, runtimeListeners };
}

function sendToContent(testPage, message) {
  return new Promise((resolve) => {
    const keepChannelOpen = testPage.runtimeListeners[0](
      message,
      { id: testPage.chrome.runtime.id },
      resolve
    );
    assert.equal(keepChannelOpen, true);
  });
}

test("fetches only the fixed baseball endpoint from the ESPN tab", async () => {
  const testPage = contentHarness();
  const response = await sendToContent(testPage, {
    scope: "rosterlab-espn-worker",
    type: "fetch-league",
    requestId: "request_12345678",
    attemptToken: "attempt_12345678",
    reference: {
      leagueId: "42",
      season: "2026",
      teamId: "1",
    },
  });

  assert.equal(response.ok, true);
  assert.equal(testPage.fetchCalls.length, 1);
  assert.match(
    testPage.fetchCalls[0].url,
    /^https:\/\/lm-api-reads\.fantasy\.espn\.com\/apis\/v3\/games\/flb\/seasons\/2026\/segments\/0\/leagues\/42\?/
  );
  assert.equal(testPage.fetchCalls[0].options.credentials, "include");
  assert.equal(testPage.fetchCalls[0].options.method, "GET");
});

test("rejects malformed league coordinates before any request", async () => {
  const testPage = contentHarness();
  const response = await sendToContent(testPage, {
    scope: "rosterlab-espn-worker",
    type: "fetch-league",
    requestId: "request_12345678",
    attemptToken: "attempt_12345678",
    reference: {
      leagueId: "42/../../account",
      season: "2026",
      teamId: "1",
    },
  });

  assert.equal(response.ok, false);
  assert.equal(response.code, "INVALID_LEAGUE_REFERENCE");
  assert.equal(testPage.fetchCalls.length, 0);
});
