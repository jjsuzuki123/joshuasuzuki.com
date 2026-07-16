"use strict";

const assert = require("node:assert/strict");
const {
  buildLeagueUrl,
  parseLeagueReference,
  parseLeague,
} = require("../fantasy/espn-client.js");

const url = buildLeagueUrl({ leagueId: "123456", season: "2026" });
assert.equal(url.pathname.endsWith("/leagues/123456"), true);
assert.equal(url.searchParams.getAll("view").length, 5);
assert.ok(url.searchParams.getAll("view").includes("kona_player_info"));
assert.throws(
  () => buildLeagueUrl({ leagueId: "abc", season: "2026" }),
  /numbers only/
);

assert.deepEqual(parseLeagueReference("123456"), {
  leagueId: "123456",
  season: null,
  teamId: null,
});
assert.deepEqual(
  parseLeagueReference(
    "https://fantasy.espn.com/baseball/team?leagueId=987654&teamId=4&seasonId=2025"
  ),
  {
    leagueId: "987654",
    season: "2025",
    teamId: "4",
  }
);
assert.deepEqual(
  parseLeagueReference(
    "fantasy.espn.com/baseball/league#/?leagueId=555&teamId=2"
  ),
  {
    leagueId: "555",
    season: null,
    teamId: "2",
  }
);
assert.deepEqual(
  parseLeagueReference(
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leagues/777"
  ),
  {
    leagueId: "777",
    season: "2026",
    teamId: null,
  }
);
assert.throws(
  () => parseLeagueReference("https://fantasy.espn.com/baseball/league"),
  /readable ESPN league ID/
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
    rosterSettings: {
      lineupSlotCounts: {
        0: 2,
        1: 1,
        2: 1,
        3: 1,
        4: 1,
        5: 5,
        12: 1,
        13: 2,
        14: 4,
        15: 3,
        16: 5,
        17: 2,
      },
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
            lineupSlotId: 5,
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
            lineupSlotId: 14,
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
  players: [
    {
      id: 303,
      status: "FREEAGENT",
      player: {
        id: 303,
        fullName: "Available Hitter",
        proTeamId: 15,
        defaultPositionId: 9,
        eligibleSlots: [5, 11],
        injuryStatus: "ACTIVE",
        ownership: { percentOwned: 44, percentChange: 2.3 },
        draftRanksByRankType: {
          STANDARD: { overallRank: 145 },
        },
        stats: [
          {
            statSourceId: 1,
            statSplitTypeId: 0,
            stats: {
              0: 510,
              2: 0.268,
              5: 19,
              20: 72,
              21: 68,
              23: 12,
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
assert.equal(league.players.length, 3);

const hitter = league.players.find((player) => player.id === "101");
const pitcher = league.players.find((player) => player.id === "202");
const availableHitter = league.players.find((player) => player.id === "303");
assert.equal(hitter.type, "hitter");
assert.equal(pitcher.type, "pitcher");
assert.deepEqual(hitter.positions, ["OF", "DH"]);
assert.deepEqual(pitcher.positions, ["SP"]);
assert.equal(hitter.mlbTeam, "NYY");
assert.equal(pitcher.mlbTeam, "WSH");
assert.equal(hitter.externalIds.espn, "101");
assert.equal(pitcher.externalIds.espn, "202");
assert.equal(hitter.lineupSlot, "OF");
assert.equal(pitcher.lineupSlot, "SP");
assert.equal(availableHitter.ownerTeamId, null);
assert.equal(availableHitter.availability, "freeagent");
assert.equal(availableHitter.type, "hitter");
assert.equal(hitter.trend, 0);
assert.equal(hitter.rateWeight, 545);
assert.equal(pitcher.rateWeight, 510);
assert.equal(hitter.scores.homeRuns, 56);
assert.equal(hitter.scores.stolenBases, 34);
assert.equal(pitcher.scores.era, 74);
assert.equal(pitcher.scores.strikeouts, 66);
assert.ok(hitter.scores.homeRuns > 50);
assert.ok(hitter.scores.stolenBases > 20);
assert.ok(pitcher.scores.era > 60);
assert.ok(pitcher.scores.strikeouts > 50);
assert.match(hitter.projection, /HR/);
assert.match(pitcher.projection, /ERA/);
assert.equal(hitter.signals.consensus, hitter.marketValue);
assert.equal(pitcher.signals.consensus, pitcher.marketValue);
assert.ok(hitter.dataQuality.categoryCoverage > 0.9);
assert.equal(hitter.provenance.espn.playerId, "101");
assert.equal(league.model.version, "2.1 evidence model");
assert.equal(league.sourceSnapshot.schemaVersion, 1);
assert.equal(league.sourceSnapshot.categorySources.homeRuns, "projection");
assert.equal(league.sourceSnapshot.matchedPlayers, 2);
assert.equal(league.sourceSnapshot.availablePlayers, 1);
assert.equal(league.league.scoringType, "ROTO");
assert.equal(league.league.rosterSettings.positionRequirements.C, 2);
assert.equal(league.league.rosterSettings.positionRequirements.OF, 5);
assert.equal(league.league.rosterSettings.benchSlots, 5);

const dualRoleFixture = JSON.parse(JSON.stringify(fixture));
const dualRolePlayer =
  dualRoleFixture.teams[0].roster.entries[0].playerPoolEntry.player;
dualRolePlayer.defaultPositionId = 10;
dualRolePlayer.eligibleSlots = [11, 14];
const dualRoleLeague = parseLeague(dualRoleFixture, {
  leagueId: "123456",
  season: "2026",
  teamId: "1",
});
const dualRoleHitter = dualRoleLeague.players.find(
  (player) => player.id === "101"
);
assert.equal(dualRoleHitter.type, "hitter");
assert.ok(Number.isFinite(dualRoleHitter.scores.homeRuns));
assert.equal(dualRoleHitter.scores.era, undefined);

const unselectedLeague = parseLeague(fixture, {
  leagueId: "123456",
  season: "2026",
});
assert.equal(unselectedLeague.teamSelectionRequired, true);

const recentOnlyFixture = JSON.parse(JSON.stringify(fixture));
recentOnlyFixture.teams[0].roster.entries[0].playerPoolEntry.player.stats[0].statSplitTypeId = 1;
recentOnlyFixture.teams[1].roster.entries[0].playerPoolEntry.player.stats[0].statSplitTypeId = 1;
assert.throws(
  () =>
    parseLeague(recentOnlyFixture, {
      leagueId: "123456",
      season: "2026",
      teamId: "1",
    }),
  /usable data/
);

const pointsFixture = JSON.parse(JSON.stringify(fixture));
pointsFixture.settings.scoringSettings.scoringType = "H2H_POINTS";
assert.throws(
  () => parseLeague(pointsFixture, { leagueId: "1", season: "2026" }),
  /category leagues, not ESPN points leagues/
);

const customFixture = JSON.parse(JSON.stringify(fixture));
customFixture.settings.scoringSettings.scoringItems = [
  { statId: 5 },
  { statId: 9 },
  { statId: 17 },
  { statId: 20 },
  { statId: 21 },
  { statId: 23 },
  { statId: 41, isReverseItem: true },
  { statId: 47, isReverseItem: true },
  { statId: 48 },
  { statId: 53 },
  { statId: 57 },
  { statId: 60 },
];
const customHitterStats =
  customFixture.teams[0].roster.entries[0].playerPoolEntry.player.stats[0].stats;
customHitterStats[9] = 0.52;
customHitterStats[17] = 0.38;
const customPitcherStats =
  customFixture.teams[1].roster.entries[0].playerPoolEntry.player.stats[0].stats;
customPitcherStats[60] = 22;

const customLeague = parseLeague(customFixture, {
  leagueId: "1",
  season: "2026",
  teamId: "1",
});
assert.equal(customLeague.league.scoring, "6x6 rotisserie");
assert.equal(customLeague.categories.length, 12);
assert.deepEqual(
  customLeague.categories.map((category) => category.id),
  [
    "homeRuns",
    "slugging",
    "onBasePercentage",
    "runs",
    "rbi",
    "stolenBases",
    "whip",
    "era",
    "strikeouts",
    "wins",
    "saves",
    "holds",
  ]
);
assert.equal(
  customLeague.categories.find((category) => category.id === "era").direction,
  "lower"
);
assert.ok(
  customLeague.players.find((player) => player.id === "101").scores
    .onBasePercentage > 60
);
assert.ok(
  customLeague.players.find((player) => player.id === "202").scores.holds > 50
);
assert.equal(
  customLeague.players.find((player) => player.id === "101").categoryValues
    .onBasePercentage,
  0.38
);
assert.equal(
  customLeague.players.find((player) => player.id === "101").categoryWeights
    .onBasePercentage,
  545
);
assert.equal(
  customLeague.players.find((player) => player.id === "202").categoryValues
    .holds,
  22
);
assert.match(
  customLeague.players.find((player) => player.id === "101").projection,
  /OBP/
);

const mixedSourceFixture = JSON.parse(JSON.stringify(customFixture));
const mixedSourcePitcher =
  mixedSourceFixture.teams[1].roster.entries[0].playerPoolEntry.player;
delete mixedSourcePitcher.stats[0].stats[60];
mixedSourcePitcher.stats.push({
  statSourceId: 0,
  statSplitTypeId: 0,
  stats: { 34: 300, 60: 18 },
});
const mixedSourceLeague = parseLeague(mixedSourceFixture, {
  leagueId: "1",
  season: "2026",
});
const mixedSourcePlayer = mixedSourceLeague.players.find(
  (player) => player.id === "202"
);
assert.equal(mixedSourcePlayer.categoryValues.holds, 18);
assert.equal(mixedSourcePlayer.statSource, "mixed");

const missingDataFixture = JSON.parse(JSON.stringify(customFixture));
missingDataFixture.settings.scoringSettings.scoringItems.push({ statId: 63 });
const missingDataLeague = parseLeague(missingDataFixture, {
  leagueId: "1",
  season: "2026",
});
assert.equal(
  missingDataLeague.categories.some(
    (category) => category.id === "qualityStarts"
  ),
  false
);
assert.match(
  missingDataLeague.unmodeledCategories.find(
    (category) => category.id === "qualityStarts"
  ).reason,
  /no season or projection data/
);

const zeroDenominatorFixture = JSON.parse(JSON.stringify(customFixture));
zeroDenominatorFixture.settings.scoringSettings.scoringItems.push({
  statId: 59,
});
const zeroDenominatorStats =
  zeroDenominatorFixture.teams[1].roster.entries[0].playerPoolEntry.player
    .stats[0].stats;
zeroDenominatorStats[56] = 0;
zeroDenominatorStats[59] = 0.9;
const zeroDenominatorLeague = parseLeague(zeroDenominatorFixture, {
  leagueId: "1",
  season: "2026",
});
assert.equal(
  zeroDenominatorLeague.categories.some(
    (category) => category.id === "savePercentage"
  ),
  false
);

const denominatorFallbackFixture = JSON.parse(
  JSON.stringify(zeroDenominatorFixture)
);
const denominatorFallbackPlayer =
  denominatorFallbackFixture.teams[1].roster.entries[0].playerPoolEntry.player;
denominatorFallbackPlayer.stats.push({
  statSourceId: 0,
  statSplitTypeId: 0,
  stats: { 56: 20, 59: 0.8 },
});
const denominatorFallbackLeague = parseLeague(
  denominatorFallbackFixture,
  { leagueId: "1", season: "2026" }
);
const denominatorFallbackResult = denominatorFallbackLeague.players.find(
  (player) => player.id === "202"
);
assert.equal(denominatorFallbackResult.categoryValues.savePercentage, 0.8);
assert.equal(denominatorFallbackResult.categoryWeights.savePercentage, 20);

const unknownCategoryFixture = JSON.parse(JSON.stringify(customFixture));
unknownCategoryFixture.settings.scoringSettings.scoringItems.push({
  statId: 777,
  isReverseItem: true,
});
const unknownCategoryLeague = parseLeague(unknownCategoryFixture, {
  leagueId: "1",
  season: "2026",
});
const unknownCategory = unknownCategoryLeague.unmodeledCategories.find(
  (category) => category.statId === 777
);
assert.equal(unknownCategory.id, "espnStat777");
assert.equal(unknownCategory.direction, "lower");
assert.equal(unknownCategory.known, false);
assert.match(unknownCategory.reason, /does not recognize/);
assert.equal(
  unknownCategoryLeague.categories.some((category) => category.statId === 777),
  false
);

const allUnknownFixture = JSON.parse(JSON.stringify(fixture));
allUnknownFixture.settings.scoringSettings.scoringItems = [{ statId: 777 }];
assert.throws(
  () => parseLeague(allUnknownFixture, { leagueId: "1", season: "2026" }),
  /all active categories have unknown ESPN stat IDs/
);

assert.throws(
  () => parseLeague({ teams: [] }, { leagueId: "1", season: "2026" }),
  /at least two teams/
);

console.log("Fantasy ESPN client tests passed.");
