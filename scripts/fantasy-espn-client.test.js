"use strict";

const assert = require("node:assert/strict");
const {
  buildLeagueUrl,
  parseLeague,
} = require("../fantasy/espn-client.js");

const url = buildLeagueUrl({ leagueId: "123456", season: "2026" });
assert.equal(url.pathname.endsWith("/leagues/123456"), true);
assert.equal(url.searchParams.getAll("view").length, 4);
assert.throws(
  () => buildLeagueUrl({ leagueId: "abc", season: "2026" }),
  /numbers only/
);

const fixture = {
  id: 123456,
  seasonId: 2026,
  settings: {
    name: "Test League",
    scoringSettings: {
      scoringType: "ROTO",
      scoringItems: [2, 5, 20, 21, 23, 41, 47, 48, 53, 57].map(
        (statId) => ({ statId })
      ),
    },
  },
  teams: [
    {
      id: 1,
      name: "Home Nine",
      abbrev: "HOM",
      playoffSeed: 2,
      owners: ["owner-1"],
      record: { overall: { wins: 12, losses: 8, ties: 0 } },
      roster: {
        entries: [
          {
            playerPoolEntry: {
              player: {
                id: 101,
                fullName: "Test Hitter",
                proTeamId: 10,
                defaultPositionId: 9,
                eligibleSlots: [5, 11],
                injuryStatus: "ACTIVE",
                ownership: { percentOwned: 93, percentChange: 0 },
                draftRanksByRankType: {
                  STANDARD: { overallRank: 31 },
                },
                stats: [
                  {
                    statSourceId: 1,
                    statSplitTypeId: 0,
                    stats: {
                      0: 545,
                      2: 0.286,
                      5: 28,
                      20: 91,
                      21: 82,
                      23: 17,
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
    {
      id: 2,
      location: "Away",
      nickname: "Arms",
      abbrev: "AWY",
      playoffSeed: 1,
      owners: ["owner-2"],
      record: { overall: { wins: 14, losses: 6, ties: 0 } },
      roster: {
        entries: [
          {
            playerPoolEntry: {
              player: {
                id: 202,
                fullName: "Test Pitcher",
                proTeamId: 20,
                defaultPositionId: 1,
                eligibleSlots: [13, 14],
                injuryStatus: "ACTIVE",
                ownership: { percentOwned: 97, percentChange: 1.1 },
                draftRanksByRankType: {
                  STANDARD: { overallRank: 18 },
                },
                stats: [
                  {
                    statSourceId: 1,
                    statSplitTypeId: 0,
                    stats: {
                      34: 510,
                      41: 1.03,
                      47: 2.92,
                      48: 184,
                      53: 12,
                      57: 0,
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  ],
};

const league = parseLeague(fixture, {
  leagueId: "123456",
  season: "2026",
  teamId: "1",
});
assert.equal(league.mode, "espn");
assert.equal(league.activeTeamId, "1");
assert.equal(league.teamSelectionRequired, false);
assert.equal(league.teams.length, 2);
assert.equal(league.players.length, 2);

const hitter = league.players.find((player) => player.id === "101");
const pitcher = league.players.find((player) => player.id === "202");
assert.equal(hitter.type, "hitter");
assert.equal(pitcher.type, "pitcher");
assert.deepEqual(hitter.positions, ["OF", "DH"]);
assert.deepEqual(pitcher.positions, ["SP"]);
assert.equal(hitter.mlbTeam, "NYY");
assert.equal(pitcher.mlbTeam, "WSH");
assert.equal(hitter.trend, 0);
assert.equal(hitter.rateWeight, 545);
assert.equal(pitcher.rateWeight, 510);
assert.ok(hitter.scores.homeRuns > 50);
assert.ok(hitter.scores.stolenBases > 20);
assert.ok(pitcher.scores.era > 60);
assert.ok(pitcher.scores.strikeouts > 50);
assert.match(hitter.projection, /HR/);
assert.match(pitcher.projection, /ERA/);

const unselectedLeague = parseLeague(fixture, {
  leagueId: "123456",
  season: "2026",
});
assert.equal(unselectedLeague.teamSelectionRequired, true);

const recentOnlyFixture = JSON.parse(JSON.stringify(fixture));
recentOnlyFixture.teams[0].roster.entries[0].playerPoolEntry.player.stats[0].statSplitTypeId = 1;
const recentOnlyLeague = parseLeague(recentOnlyFixture, {
  leagueId: "123456",
  season: "2026",
  teamId: "1",
});
assert.match(
  recentOnlyLeague.players.find((player) => player.id === "101").projection,
  /ESPN rank/
);

const pointsFixture = JSON.parse(JSON.stringify(fixture));
pointsFixture.settings.scoringSettings.scoringType = "H2H_POINTS";
assert.throws(
  () => parseLeague(pointsFixture, { leagueId: "1", season: "2026" }),
  /standard 5x5 category leagues/
);

const customFixture = JSON.parse(JSON.stringify(fixture));
customFixture.settings.scoringSettings.scoringItems.push({ statId: 60 });
assert.throws(
  () => parseLeague(customFixture, { leagueId: "1", season: "2026" }),
  /custom categories/
);

assert.throws(
  () => parseLeague({ teams: [] }, { leagueId: "1", season: "2026" }),
  /at least two teams/
);

console.log("Fantasy ESPN client tests passed.");
