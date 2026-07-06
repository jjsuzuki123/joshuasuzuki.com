const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const clientSource = fs.readFileSync(
  path.join(__dirname, "..", "fantasy", "espn-client.js"),
  "utf8"
);

function rawLeague() {
  const player = (id, name, stats) => ({
    playerPoolEntry: {
      player: {
        id,
        fullName: name,
        proTeamId: id,
        defaultPositionId: 3,
        eligibleSlots: [1],
        ownership: { percentOwned: 75 },
        stats: [
          {
            statSourceId: 1,
            statSplitTypeId: 0,
            stats,
          },
        ],
      },
    },
  });

  return {
    id: 42,
    seasonId: 2026,
    settings: {
      name: "Connector test league",
      scoringSettings: {
        scoringType: "ROTO",
        scoringItems: [{ statId: 5 }, { statId: 20 }],
      },
    },
    teams: [
      {
        id: 1,
        name: "Test Team One",
        playoffSeed: 1,
        roster: {
          entries: [player(1, "First Player", { 0: 500, 5: 30, 20: 80 })],
        },
      },
      {
        id: 2,
        name: "Test Team Two",
        playoffSeed: 2,
        roster: {
          entries: [player(2, "Second Player", { 0: 480, 5: 22, 20: 70 })],
        },
      },
    ],
  };
}

function loadClient(fetch) {
  const context = {
    AbortController,
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    fetch,
    RosterLabConfig: {
      importEndpoint: "https://relay.example.test/league/import",
    },
    setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(clientSource, context);
  return context.EspnFantasyClient;
}

test("public relay requests contain league coordinates only", async () => {
  let request = null;
  const client = loadClient(async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return { payload: rawLeague() };
      },
    };
  });

  const league = await client.fetchLeague({
    leagueId: "42",
    season: "2026",
    teamId: "1",
  });
  const body = JSON.parse(request.options.body);

  assert.equal(request.url, "https://relay.example.test/league/import");
  assert.deepEqual(Object.keys(body).sort(), ["leagueId", "season", "teamId"]);
  assert.deepEqual(body, {
    leagueId: "42",
    season: "2026",
    teamId: "1",
  });
  assert.equal(league.league.id, "42");
  assert.equal(league.teams.length, 2);
  assert.equal(league.players.length, 2);
});

test("public league references require exact ESPN baseball URLs", () => {
  const client = loadClient(async () => {
    throw new Error("No request expected.");
  });

  const reference = client.parseLeagueReference(
    "https://fantasy.espn.com/baseball/team?leagueId=42&seasonId=2026&teamId=1"
  );
  assert.equal(reference.leagueId, "42");
  assert.equal(reference.season, "2026");
  assert.equal(reference.teamId, "1");
  assert.throws(
    () =>
      client.parseLeagueReference(
        "https://fantasy.espn.com.evil.example/baseball/team?leagueId=42"
      ),
    /ESPN fantasy baseball/
  );
  assert.throws(
    () =>
      client.parseLeagueReference(
        "http://fantasy.espn.com/baseball/team?leagueId=42"
      ),
    /HTTPS/
  );
  assert.throws(
    () =>
      client.parseLeagueReference(
        "https://www.espn.com/fantasy/football/team?leagueId=42"
      ),
    /ESPN fantasy baseball/
  );
});
