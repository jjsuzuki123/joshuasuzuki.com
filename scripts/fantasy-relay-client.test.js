"use strict";

const assert = require("node:assert/strict");

const modulePath = require.resolve("../fantasy/espn-client.js");
delete require.cache[modulePath];
global.RosterLabConfig = {
  importEndpoint: "https://api.example.test/production/league/import",
};

const client = require(modulePath);

const scoringItems = [2, 5, 20, 21, 23, 41, 47, 48, 53, 57].map(
  (statId) => ({ statId })
);
const player = (id, name) => ({
  playerPoolEntry: {
    player: {
      id,
      fullName: name,
      proTeamId: 10,
      defaultPositionId: 9,
      eligibleSlots: [5],
      injuryStatus: "ACTIVE",
      ownership: { percentOwned: 80, percentChange: 0 },
      draftRanksByRankType: { STANDARD: { overallRank: 50 } },
      stats: [
        {
          statSourceId: 1,
          statSplitTypeId: 0,
          stats: {
            0: 500,
            2: 0.275,
            5: 20,
            20: 80,
            21: 75,
            23: 10,
          },
        },
      ],
    },
  },
});
const espnPayload = {
  id: 123456,
  seasonId: 2026,
  settings: {
    name: "Private Test League",
    scoringSettings: {
      scoringType: "ROTO",
      scoringItems,
    },
  },
  teams: [
    {
      id: 1,
      name: "First Team",
      playoffSeed: 1,
      roster: { entries: [player(101, "First Player")] },
    },
    {
      id: 2,
      name: "Second Team",
      playoffSeed: 2,
      roster: { entries: [player(202, "Second Player")] },
    },
  ],
};

async function run() {
  assert.equal(client.hasImportRelay, true);

  let relayRequest;
  global.fetch = async (url, options) => {
    relayRequest = { url, options };
    return new Response(JSON.stringify({ payload: espnPayload, teamId: "1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const league = await client.fetchLeague({
    leagueId: "123456",
    season: "2026",
    teamId: "1",
    espnS2: "one-time-session",
    swid: "{11111111-2222-3333-4444-555555555555}",
  });
  assert.equal(
    relayRequest.url,
    "https://api.example.test/production/league/import"
  );
  assert.equal(relayRequest.options.method, "POST");
  const requestBody = JSON.parse(relayRequest.options.body);
  assert.equal(requestBody.espnS2, "one-time-session");
  assert.equal(
    requestBody.swid,
    "{11111111-2222-3333-4444-555555555555}"
  );
  assert.equal(requestBody.teamId, "1");
  assert.equal(league.league.name, "Private Test League");
  assert.equal(league.activeTeamId, "1");
  assert.doesNotMatch(
    JSON.stringify(league),
    /one-time-session|11111111-2222/
  );

  global.fetch = async () =>
    new Response(JSON.stringify({ message: "ESPN rejected these values." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  await assert.rejects(
    () =>
      client.fetchLeague({
        leagueId: "123456",
        season: "2026",
        espnS2: "expired",
        swid: "{11111111-2222-3333-4444-555555555555}",
      }),
    (error) =>
      error.message === "ESPN rejected these values." &&
      error.code === "IMPORT_FAILED"
  );

  delete global.RosterLabConfig;
  console.log("Fantasy relay client tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
