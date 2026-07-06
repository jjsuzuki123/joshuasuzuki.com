"use strict";

const assert = require("node:assert/strict");

process.env.ALLOWED_ORIGINS =
  "https://www.joshuasuzuki.com,http://localhost:4173";

const { handler } = require("../fantasy-backend/import-league/index.js");

const allowedOrigin = "https://www.joshuasuzuki.com";
const payload = {
  id: 123456,
  settings: {
    scoringSettings: { scoringType: "ROTO" },
  },
  teams: [{ id: 1 }, { id: 2 }],
};

function event(body, overrides = {}) {
  return {
    requestContext: { http: { method: "POST" } },
    headers: { origin: allowedOrigin },
    body: JSON.stringify(body),
    ...overrides,
  };
}

async function run() {
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const forbidden = await handler({
    ...event({ leagueId: "1", season: "2026" }),
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(fetchCalls, 0);

  const preflight = await handler({
    requestContext: { http: { method: "OPTIONS" } },
    headers: { origin: allowedOrigin },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["Access-Control-Allow-Origin"], allowedOrigin);

  let publicRequest;
  global.fetch = async (url, options) => {
    publicRequest = { url: String(url), options };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const publicResult = await handler(
    event({ leagueId: "123456", season: "2026", teamId: "1" })
  );
  assert.equal(publicResult.statusCode, 200);
  assert.equal(publicResult.headers["Cache-Control"], "no-store, max-age=0");
  assert.equal(publicRequest.options.headers.Cookie, undefined);
  assert.match(publicRequest.url, /leagues\/123456/);
  assert.equal(new URL(publicRequest.url).searchParams.getAll("view").length, 4);
  assert.deepEqual(JSON.parse(publicResult.body), { payload, teamId: "1" });

  const espnS2 = "session-value-without-separators";
  const swid = "{11111111-2222-3333-4444-555555555555}";
  let privateRequest;
  global.fetch = async (url, options) => {
    privateRequest = { url: String(url), options };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const privateResult = await handler(
    event({
      leagueId: "123456",
      season: "2026",
      teamId: "1",
      espnS2,
      swid,
    })
  );
  assert.equal(privateResult.statusCode, 200);
  assert.equal(
    privateRequest.options.headers.Cookie,
    `espn_s2=${espnS2}; SWID=${swid}`
  );
  assert.doesNotMatch(privateResult.body, /session-value/);

  const incompleteCredentials = await handler(
    event({ leagueId: "123456", season: "2026", espnS2 })
  );
  assert.equal(incompleteCredentials.statusCode, 400);
  assert.doesNotMatch(incompleteCredentials.body, new RegExp(espnS2));

  const injectedCookie = await handler(
    event({
      leagueId: "123456",
      season: "2026",
      espnS2: "bad; injected=value",
      swid,
    })
  );
  assert.equal(injectedCookie.statusCode, 400);

  global.fetch = async () =>
    new Response("Unauthorized", {
      status: 401,
      headers: { "content-type": "text/plain" },
    });
  const expired = await handler(
    event({ leagueId: "123456", season: "2026", espnS2, swid })
  );
  assert.equal(expired.statusCode, 401);
  assert.match(expired.body, /copy fresh values/);
  assert.doesNotMatch(expired.body, new RegExp(espnS2));

  const invalidId = await handler(
    event({ leagueId: "../admin", season: "2026" })
  );
  assert.equal(invalidId.statusCode, 400);

  console.log("Fantasy private import relay tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
