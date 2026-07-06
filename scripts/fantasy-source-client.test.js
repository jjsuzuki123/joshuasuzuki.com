"use strict";

const assert = require("node:assert/strict");
const data = require("../fantasy/data.js");

const modulePath = require.resolve("../fantasy/source-client.js");
delete require.cache[modulePath];
global.RosterLabConfig = {
  sourceEndpoint: "https://insights.example.test/v1/fantasy/baseball",
};
const client = require(modulePath);

const league = {
  ...data,
  league: { ...data.league },
  players: data.players.map((player) => ({
    ...player,
    scores: { ...player.scores },
    signals: { ...player.signals },
  })),
  sources: data.sources.map((source) => ({ ...source })),
};
const now = new Date("2026-07-06T19:00:00.000Z");
const snapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-06T18:55:00.000Z",
  sources: [
    {
      id: "fangraphs",
      name: "FanGraphs licensed export",
      url: "https://www.fangraphs.com/projections",
      kind: "quantitative",
      access: "licensed",
      coverage: "Rest-of-season projections",
      cadence: "Daily",
      updatedAt: "2026-07-06T18:30:00.000Z",
    },
    {
      id: "savant",
      name: "Baseball Savant",
      url: "https://baseballsavant.mlb.com/",
      kind: "quantitative",
      access: "official",
      coverage: "Expected performance",
      cadence: "Daily",
      updatedAt: "2026-07-06T18:20:00.000Z",
    },
    {
      id: "rotowire",
      name: "RotoWire",
      url: "https://www.rotowire.com/baseball/",
      kind: "qualitative",
      access: "licensed",
      coverage: "Injuries and roles",
      cadence: "Near real time",
      updatedAt: "2026-07-06T18:45:00.000Z",
    },
  ],
  players: [
    {
      playerId: "will-smith",
      quantitative: [
        {
          sourceId: "fangraphs",
          asOf: "2026-07-06T18:30:00.000Z",
          confidence: 0.9,
          overall: 86,
          projection: 88,
          categoryScores: {
            runs: 85,
            homeRuns: 96,
            rbi: 92,
            stolenBases: 14,
            average: 84,
            unknownCategory: 100,
          },
          horizon: "rest-of-season",
        },
        {
          sourceId: "savant",
          asOf: "2026-07-06T18:20:00.000Z",
          confidence: 0.75,
          underlying: 91,
          categoryScores: {
            homeRuns: 92,
            average: 87,
          },
          sampleSize: 280,
        },
      ],
      qualitative: [
        {
          sourceId: "rotowire",
          asOf: "2026-07-06T18:45:00.000Z",
          confidence: 0.95,
          type: "lineup",
          summary: "Moved into the heart of the order.",
          impact: "positive",
          role: "Everyday catcher",
          status: "Healthy",
        },
      ],
    },
    {
      playerId: "tanner-scott",
      qualitative: [
        {
          sourceId: "rotowire",
          asOf: "2026-07-06T18:40:00.000Z",
          confidence: 0.9,
          type: "role",
          summary: "Removed from the ninth inning after recent struggles.",
          impact: -0.9,
          role: "Middle relief",
          status: "Day-to-day",
        },
      ],
    },
    {
      playerId: "does-not-exist",
      quantitative: [
        {
          sourceId: "fangraphs",
          asOf: "2026-07-06T18:30:00.000Z",
          overall: 99,
        },
      ],
    },
  ],
};

const enriched = client.applySnapshot(league, snapshot, { now });
const willSmith = enriched.players.find((player) => player.id === "will-smith");
const tannerScott = enriched.players.find(
  (player) => player.id === "tanner-scott"
);
assert.equal(enriched.sourceSnapshot.matchedPlayers, 2);
assert.equal(enriched.sourceSnapshot.schemaVersion, 1);
assert.equal(
  enriched.league.insightsUpdatedAt,
  "2026-07-06T18:55:00.000Z"
);
assert.equal(enriched.model.version, "2.0 evidence model");
assert.ok(willSmith.modelScores.homeRuns > willSmith.scores.homeRuns);
assert.equal(willSmith.modelScores.unknownCategory, undefined);
assert.ok(willSmith.signals.projection > league.players[0].signals.projection);
assert.equal(willSmith.insights.quantitative.length, 2);
assert.equal(willSmith.news.source, "RotoWire");
assert.equal(willSmith.news.headline, "Moved into the heart of the order.");
assert.equal(tannerScott.status, "Day-to-day");
assert.ok(tannerScott.insights.qualitative[0].impact < 0);
assert.equal(
  enriched.sources.find((source) => source.id === "fangraphs").status,
  "connected"
);
assert.equal(
  enriched.sources.find((source) => source.id === "rotowire").access,
  "licensed"
);

const staleSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-06T18:55:00.000Z",
  sources: [
    {
      id: "rotowire",
      name: "RotoWire",
      kind: "qualitative",
      access: "licensed",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
  ],
  players: [
    {
      playerId: "tanner-scott",
      qualitative: [
        {
          sourceId: "rotowire",
          asOf: "2026-06-01T00:00:00.000Z",
          summary: "Old note",
          impact: "negative",
          status: "Out",
        },
      ],
    },
  ],
};
const stale = client.applySnapshot(league, staleSnapshot, { now });
assert.equal(
  stale.sources.find((source) => source.id === "rotowire").status,
  "stale"
);
assert.equal(
  stale.players.find((player) => player.id === "tanner-scott").status,
  "Healthy"
);

const unlicensedSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-06T18:55:00.000Z",
  sources: [
    {
      id: "rotowire",
      name: "RotoWire scrape",
      kind: "qualitative",
      access: "scraped",
      updatedAt: "2026-07-06T18:45:00.000Z",
    },
  ],
  players: [
    {
      playerId: "tanner-scott",
      qualitative: [
        {
          sourceId: "rotowire",
          summary: "This must not be applied.",
          impact: "negative",
          status: "Out",
        },
      ],
    },
  ],
};
const unlicensed = client.applySnapshot(league, unlicensedSnapshot, { now });
assert.equal(
  unlicensed.players.find((player) => player.id === "tanner-scott").status,
  "Healthy"
);
assert.equal(
  unlicensed.sources.find((source) => source.id === "rotowire").status,
  "fixture"
);

assert.throws(
  () =>
    client.applySnapshot(
      league,
      { schemaVersion: 2, sources: [], players: [] },
      { now }
    ),
  (error) => error.code === "INVALID_SOURCE_DATA"
);

async function runFetchTest() {
  assert.equal(client.hasSourceEndpoint, true);
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const fetched = await client.enrichLeague({ league, now });
  assert.equal(
    request.url,
    "https://insights.example.test/v1/fantasy/baseball"
  );
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.cache, "no-store");
  const body = JSON.parse(request.options.body);
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.players.length, league.players.length);
  assert.equal(body.players[0].name, league.players[0].name);
  assert.equal(fetched.sourceSnapshot.matchedPlayers, 2);
  delete global.RosterLabConfig;
  console.log("Fantasy source client tests passed.");
}

runFetchTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
