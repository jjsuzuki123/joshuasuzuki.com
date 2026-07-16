"use strict";

const assert = require("node:assert/strict");
const data = require("../fantasy/data.js");

const modulePath = require.resolve("../fantasy/source-client.js");
delete require.cache[modulePath];
global.RosterLabConfig = {
  sourceEndpoint: "https://insights.example.test/v1/fantasy/baseball",
  researchEndpoint: "https://insights.example.test/v1/fantasy/baseball",
};
const client = require(modulePath);

const league = {
  ...data,
  researchToken: "abc.def",
  league: { ...data.league },
  players: data.players.map((player) => ({
    ...player,
    scores: { ...player.scores },
    signals: { ...player.signals },
  })),
  sources: data.sources.map((source) => ({ ...source })),
};
const now = new Date("2026-07-06T19:00:00.000Z");
const cappedResearchBody = client.requestBody({
  ...league,
  researchToken: "",
  players: Array.from({ length: 501 }, (_value, index) => ({
    ...league.players[0],
    id: String(index + 1),
    externalIds: { espn: String(index + 1) },
    name: `Player ${index + 1}`,
    mlbTeam: "FA",
    ownerTeamId: index < 25 ? league.activeTeamId : null,
    marketValue: 50,
  })),
});
assert.equal(cappedResearchBody.players.length, 500);
const snapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-06T18:55:00.000Z",
  research: {
    provider: "firecrawl",
    status: "refreshing",
    requested: 100,
    cached: 3,
    queued: 25,
  },
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
      playerId: "zack-wheeler",
      qualitative: [
        {
          sourceId: "rotowire",
          asOf: "2026-07-06T18:35:00.000Z",
          confidence: 0.98,
          type: "injury",
          summary: "Transferred to the 60-day injured list.",
          impact: "injured",
          injuryStatus: "60-day IL",
          severity: "long-term",
          ilDays: 60,
          expectedReturn: "2026-08-15T00:00:00.000Z",
          sourceUrl: "https://www.rotowire.com/baseball/player/example",
          evidenceQuote: "Transferred to the 60-day injured list.",
          publisher: "RotoWire",
          modelEligible: true,
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
const zackWheeler = enriched.players.find(
  (player) => player.id === "zack-wheeler"
);
assert.equal(enriched.sourceSnapshot.matchedPlayers, 3);
assert.equal(enriched.sourceSnapshot.schemaVersion, 1);
assert.deepEqual(enriched.sourceSnapshot.research, {
  provider: "firecrawl",
  status: "refreshing",
  requested: 100,
  cached: 3,
  queued: 25,
  pending: 0,
  authorized: false,
  returned: 0,
  truncated: false,
});
assert.equal(
  enriched.league.insightsUpdatedAt,
  "2026-07-06T18:55:00.000Z"
);
assert.equal(enriched.model.version, "2.2 evidence model");
assert.ok(willSmith.modelScores.homeRuns > willSmith.scores.homeRuns);
assert.equal(willSmith.modelScores.unknownCategory, undefined);
assert.ok(willSmith.signals.projection > league.players[0].signals.projection);
assert.equal(willSmith.insights.quantitative.length, 2);
assert.equal(willSmith.news.source, "RotoWire");
assert.equal(willSmith.news.headline, "Moved into the heart of the order.");
assert.equal(tannerScott.status, "Day-to-day");
assert.ok(tannerScott.insights.qualitative[0].impact < 0);
assert.equal(zackWheeler.status, "60-day IL");
assert.equal(zackWheeler.injury.severity, "long-term");
assert.equal(zackWheeler.injury.ilDays, 60);
assert.equal(
  zackWheeler.injury.expectedReturn,
  "2026-08-15T00:00:00.000Z"
);
assert.equal(
  zackWheeler.news.sourceUrl,
  "https://www.rotowire.com/baseball/player/example"
);
assert.equal(
  zackWheeler.news.evidenceQuote,
  "Transferred to the 60-day injured list."
);
assert.equal(zackWheeler.news.modelEligible, true);
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

const persistentInjurySnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-06T18:55:00.000Z",
  sources: [
    {
      id: "rotowire",
      name: "RotoWire",
      url: "https://www.rotowire.com/baseball/",
      kind: "qualitative",
      access: "licensed",
      updatedAt: "2026-07-06T18:45:00.000Z",
    },
  ],
  players: [
    {
      playerId: "zack-wheeler",
      qualitative: [
        {
          sourceId: "rotowire",
          asOf: "2026-05-19T18:00:00.000Z",
          type: "injury",
          summary: "Moved to the 60-day IL.",
          injuryStatus: "60-day IL",
          severity: "long-term",
          ilDays: 60,
          expectedReturn: "2026-08-15T00:00:00.000Z",
        },
      ],
    },
  ],
};
const persistentInjury = client.applySnapshot(
  league,
  persistentInjurySnapshot,
  { now }
);
const persistentWheeler = persistentInjury.players.find(
  (player) => player.id === "zack-wheeler"
);
assert.equal(persistentWheeler.status, "60-day IL");
assert.equal(persistentWheeler.injury.ilDays, 60);
assert.ok(persistentWheeler.injury.freshness > 0);
assert.equal(persistentWheeler.news, null);

const espnIlLeague = {
  ...league,
  players: league.players.map((player) =>
    player.id === "tanner-scott"
      ? {
          ...player,
          status: "IL",
          isInjuredReserve: true,
        }
      : player
  ),
};
const roleStatusSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-06T18:55:00.000Z",
  sources: snapshot.sources,
  players: [
    {
      playerId: "tanner-scott",
      qualitative: [
        {
          sourceId: "rotowire",
          asOf: "2026-07-06T18:45:00.000Z",
          type: "role",
          summary: "Expected to close when active.",
          status: "Day-to-day",
          ilDays: null,
        },
      ],
    },
  ],
};
const roleNoteOnIl = client.applySnapshot(espnIlLeague, roleStatusSnapshot, {
  now,
});
assert.equal(
  roleNoteOnIl.players.find((player) => player.id === "tanner-scott").status,
  "IL"
);

const clearedSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-06T18:56:00.000Z",
  sources: snapshot.sources,
  players: [],
};
const cleared = client.applySnapshot(enriched, clearedSnapshot, { now });
const clearedWheeler = cleared.players.find(
  (player) => player.id === "zack-wheeler"
);
assert.equal(clearedWheeler.status, "Healthy");
assert.equal(clearedWheeler.injury, null);
assert.equal(clearedWheeler.news, null);

const recoverySnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-06T18:56:00.000Z",
  sources: snapshot.sources,
  players: [
    {
      playerId: "zack-wheeler",
      qualitative: [
        {
          sourceId: "rotowire",
          asOf: "2026-07-05T18:00:00.000Z",
          confidence: 1,
          type: "injury",
          injuryStatus: "60-day IL",
          severity: "long-term",
          ilDays: 60,
        },
        {
          sourceId: "rotowire",
          asOf: "2026-07-06T18:00:00.000Z",
          confidence: 0.6,
          type: "transaction",
          injuryStatus: "Active",
          severity: "active",
        },
      ],
    },
  ],
};
const recovered = client.applySnapshot(league, recoverySnapshot, { now });
const recoveredWheeler = recovered.players.find(
  (player) => player.id === "zack-wheeler"
);
assert.equal(recoveredWheeler.status, "Active");
assert.equal(recoveredWheeler.injury.severity, "active");

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

["official", "user-provided"].forEach((access) => {
  const mislabeledRotowire = client.applySnapshot(
    league,
    {
      ...unlicensedSnapshot,
      sources: [
        {
          ...unlicensedSnapshot.sources[0],
          access,
          updatedAt: "2026-07-06T18:45:00.000Z",
        },
      ],
    },
    { now }
  );
  assert.equal(
    mislabeledRotowire.players.find((player) => player.id === "tanner-scott")
      .status,
    "Healthy"
  );
});

const contextOnly = client.applySnapshot(
  league,
  {
    schemaVersion: 1,
    generatedAt: "2026-07-06T18:55:00.000Z",
    sources: [
      {
        id: "web-espn",
        name: "ESPN",
        kind: "qualitative",
        access: "user-provided",
        updatedAt: "2026-07-06T18:45:00.000Z",
      },
    ],
    players: [
      {
        playerId: "tanner-scott",
        qualitative: [
          {
            sourceId: "web-espn",
            type: "injury",
            summary: "Context-only injury report",
            status: "Out for season",
            severity: "season-ending",
            impact: -1,
            modelEligible: false,
            sourceUrl: "https://www.espn.com/mlb/story/example",
            asOf: "2026-07-06T18:45:00.000Z",
          },
        ],
      },
    ],
  },
  { now }
);
const contextOnlyScott = contextOnly.players.find(
  (player) => player.id === "tanner-scott"
);
assert.equal(contextOnlyScott.status, "Healthy");
assert.equal(contextOnlyScott.injury, null);
assert.equal(contextOnlyScott.news.modelEligible, false);
assert.equal(contextOnlyScott.insights.qualitative[0].modelEligible, false);

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
  assert.equal(body.researchToken, "abc.def");
  assert.equal(body.players.length, league.players.length);
  assert.equal(body.players[0].name, league.players[0].name);
  assert.equal(body.players[0].ownerTeamId, league.players[0].ownerTeamId);
  assert.equal(body.players[0].status, league.players[0].status);
  assert.equal(
    body.players[0].activeRoster,
    String(league.players[0].ownerTeamId) === String(league.activeTeamId)
  );
  assert.equal(body.players[0].priority, league.players[0].marketValue);
  assert.equal(fetched.sourceSnapshot.matchedPlayers, 3);

  delete require.cache[modulePath];
  global.RosterLabConfig = {
    sourceEndpoints: [
      "https://licensed.example.test/evidence",
      "https://research.example.test/evidence",
    ],
  };
  const multiSourceClient = require(modulePath);
  const multiSourceInput = {
    ...league,
    players: league.players.map((player, index) =>
      index === 0
        ? { ...player, externalIds: { espn: "999001" } }
        : player
    ),
  };
  const multiSourceBodies = [];
  global.fetch = async (url, options) => {
    multiSourceBodies.push(JSON.parse(options.body));
    if (url.includes("licensed")) {
      return new Response(JSON.stringify(snapshot), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: "2026-07-06T18:58:00.000Z",
        research: {
          provider: "firecrawl",
          status: "current",
          requested: league.players.length,
          cached: 1,
          queued: 0,
          pending: 0,
          authorized: true,
        },
        sources: [
          {
            id: "web-espn",
            name: "ESPN",
            kind: "qualitative",
            access: "user-provided",
            updatedAt: "2026-07-06T18:58:00.000Z",
          },
        ],
        players: [
          {
            externalIds: { espn: "999001" },
            qualitative: [
              {
                sourceId: "web-espn",
                type: "report",
                summary: "Cited context",
                impact: 0,
                modelEligible: false,
                sourceUrl: "https://www.espn.com/mlb/story/example",
                asOf: "2026-07-06T18:58:00.000Z",
              },
            ],
          },
        ],
      }),
      { status: 200 }
    );
  };
  const multiSourceLeague = await multiSourceClient.enrichLeague({
    league: multiSourceInput,
    now,
  });
  assert.equal(
    multiSourceLeague.sources.some((source) => source.id === "rotowire"),
    true
  );
  assert.equal(
    multiSourceLeague.sources.some((source) => source.id === "web-espn"),
    true
  );
  assert.equal(
    multiSourceLeague.players[0].insights.qualitative.some(
      (item) => item.summary === "Cited context"
    ),
    true
  );
  assert.equal(
    multiSourceBodies.every((body) => body.researchToken === undefined),
    true
  );
  const priorQuantitativeCount = multiSourceLeague.players.reduce(
    (total, player) =>
      total + (player.insights?.quantitative?.length || 0),
    0
  );
  global.fetch = async (url) => {
    if (url.includes("licensed")) {
      throw new TypeError("licensed endpoint unavailable");
    }
    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: "2026-07-06T18:59:00.000Z",
        sources: [],
        players: [],
      }),
      { status: 200 }
    );
  };
  const partialLeague = await multiSourceClient.enrichLeague({
    league: multiSourceLeague,
    now,
  });
  assert.equal(partialLeague.sourceSnapshot.partial, true);
  assert.equal(
    partialLeague.players.reduce(
      (total, player) =>
        total + (player.insights?.quantitative?.length || 0),
      0
    ),
    priorQuantitativeCount
  );
  delete global.RosterLabConfig;
  console.log("Fantasy source client tests passed.");
}

runFetchTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
