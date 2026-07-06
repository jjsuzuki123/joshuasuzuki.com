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
    scoringSettings: { scoringType: "ROTO" },
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
                defaultPositionId: 5,
                eligibleSlots: [5, 11],
                injuryStatus: "ACTIVE",
                ownership: { percentOwned: 93, percentChange: 2.4 },
                draftRanksByRankType: {
                  STANDARD: { overallRank: 31 },
                },
                stats: [
                  {
                    statSourceId: 1,
                    statSplitTypeId: 1,
                    stats: {
                      2: 0.286,
                      5: 28,
                      12: 82,
                      13: 91,
                      14: 17,
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
                defaultPositionId: 14,
                eligibleSlots: [13, 14],
                injuryStatus: "ACTIVE",
                ownership: { percentOwned: 97, percentChange: 1.1 },
                draftRanksByRankType: {
                  STANDARD: { overallRank: 18 },
                },
                stats: [
                  {
                    statSourceId: 1,
                    statSplitTypeId: 1,
                    stats: {
                      32: 2.92,
                      33: 1.03,
                      34: 184,
                      37: 0,
                      39: 12,
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
assert.equal(league.teams.length, 2);
assert.equal(league.players.length, 2);

const hitter = league.players.find((player) => player.id === "101");
const pitcher = league.players.find((player) => player.id === "202");
assert.equal(hitter.type, "hitter");
assert.equal(pitcher.type, "pitcher");
assert.ok(hitter.scores.homeRuns > 50);
assert.ok(hitter.scores.stolenBases > 20);
assert.ok(pitcher.scores.era > 60);
assert.ok(pitcher.scores.strikeouts > 50);
assert.match(hitter.projection, /HR/);
assert.match(pitcher.projection, /ERA/);

assert.throws(
  () => parseLeague({ teams: [] }, { leagueId: "1", season: "2026" }),
  /at least two teams/
);

console.log("Fantasy ESPN client tests passed.");
