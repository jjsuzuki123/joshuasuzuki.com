"use strict";

const assert = require("node:assert/strict");
const data = require("../fantasy/data.js");
const {
  computeLeagueContext,
  evaluateTrade,
  findTradeOpportunities,
  getTeamAnalysis,
} = require("../fantasy/trade-engine.js");

const context = computeLeagueContext({
  players: data.players,
  teams: data.teams,
  categories: data.categories,
});
assert.equal(context.profiles.size, data.teams.length);

const countCategory = {
  id: "runs",
  label: "R",
  name: "Runs",
  group: "batting",
  aggregation: "count",
};
const countContext = computeLeagueContext({
  teams: [{ id: "a" }, { id: "b" }],
  categories: [countCategory],
  players: [
    { id: "a1", ownerTeamId: "a", marketValue: 1, scores: { runs: 60 } },
    { id: "a2", ownerTeamId: "a", marketValue: 1, scores: { runs: 60 } },
    { id: "b1", ownerTeamId: "b", marketValue: 1, scores: { runs: 100 } },
  ],
});
assert.equal(countContext.profiles.get("a").categories.runs.score, 120);
assert.equal(countContext.profiles.get("a").categories.runs.rank, 1);

const tiedContext = computeLeagueContext({
  teams: [{ id: "a" }, { id: "b" }],
  categories: [countCategory],
  players: [
    { id: "a1", ownerTeamId: "a", marketValue: 1, scores: { runs: 100 } },
    { id: "b1", ownerTeamId: "b", marketValue: 1, scores: { runs: 100 } },
  ],
});
assert.equal(tiedContext.profiles.get("a").categories.runs.rank, 1);
assert.equal(tiedContext.profiles.get("b").categories.runs.rank, 1);
assert.equal(
  tiedContext.profiles.get("a").categories.runs.need,
  tiedContext.profiles.get("b").categories.runs.need
);

const analysis = getTeamAnalysis({
  teamId: data.activeTeamId,
  players: data.players,
  teams: data.teams,
  categories: data.categories,
  context,
});
assert.ok(analysis);
assert.equal(analysis.roster.length, 10);
assert.equal(analysis.categoryRows.length, 10);
assert.ok(analysis.needs.some((category) => category.id === "stolenBases"));
assert.ok(analysis.needs.some((category) => category.id === "saves"));

const opportunities = findTradeOpportunities({
  teamId: data.activeTeamId,
  players: data.players,
  teams: data.teams,
  categories: data.categories,
  realisticOnly: true,
});
assert.ok(opportunities.length >= 3);
assert.ok(opportunities.every((opportunity) => opportunity.result.valid));
assert.ok(opportunities.every((opportunity) => opportunity.result.realistic));
assert.ok(
  opportunities.every(
    (opportunity) => opportunity.partnerTeam.id !== data.activeTeamId
  )
);
assert.ok(
  new Set(opportunities.slice(0, 5).map((opportunity) => opportunity.partnerTeam.id))
    .size >= 4
);

const speedTrade = evaluateTrade({
  teamId: data.activeTeamId,
  partnerTeamId: "northside",
  sendingIds: ["teoscar-hernandez"],
  receivingIds: ["brice-turang"],
  players: data.players,
  teams: data.teams,
  categories: data.categories,
  context,
});
assert.equal(speedTrade.valid, true);
assert.ok(speedTrade.fairness >= 90);
assert.ok(speedTrade.gains.some((category) => category.id === "stolenBases"));
assert.ok(speedTrade.losses.some((category) => category.id === "homeRuns"));

const multiPlayerTrade = evaluateTrade({
  teamId: data.activeTeamId,
  partnerTeamId: "northside",
  sendingIds: ["matt-olson", "teoscar-hernandez"],
  receivingIds: ["brice-turang"],
  players: data.players,
  teams: data.teams,
  categories: data.categories,
  context,
});
const averageImpact = multiPlayerTrade.deltas.find(
  (category) => category.id === "average"
);
assert.ok(averageImpact.raw > 0);
assert.ok(
  multiPlayerTrade.deltas
    .filter((category) => ["average", "era", "whip"].includes(category.id))
    .every((category) => Math.abs(category.raw) <= 100)
);

const rateCategory = {
  id: "average",
  label: "AVG",
  name: "Batting average",
  group: "batting",
  aggregation: "rate",
};
const ratePlayers = [
  {
    id: "a-core",
    ownerTeamId: "a",
    marketValue: 50,
    trend: 0,
    rateWeight: 100,
    scores: { average: 100 },
  },
  {
    id: "a-send",
    ownerTeamId: "a",
    marketValue: 50,
    trend: 0,
    rateWeight: 100,
    scores: { average: 20 },
  },
  {
    id: "b-core",
    ownerTeamId: "b",
    marketValue: 50,
    trend: 0,
    rateWeight: 100,
    scores: { average: 40 },
  },
  {
    id: "b-receive",
    ownerTeamId: "b",
    marketValue: 50,
    trend: 0,
    rateWeight: 100,
    scores: { average: 60 },
  },
];
const fullRosterRateTrade = evaluateTrade({
  teamId: "a",
  partnerTeamId: "b",
  sendingIds: ["a-send"],
  receivingIds: ["b-receive"],
  players: ratePlayers,
  teams: [{ id: "a" }, { id: "b" }],
  categories: [rateCategory],
});
assert.equal(fullRosterRateTrade.deltas[0].raw, 20);
assert.equal(fullRosterRateTrade.deltas[0].partnerRaw, -20);

const weightedObpCategory = {
  id: "onBasePercentage",
  label: "OBP",
  name: "On-base percentage",
  group: "batting",
  aggregation: "rate",
  direction: "higher",
  rangeMinimum: 0.25,
  rangeMaximum: 0.45,
};
const weightedObpPlayers = [
  {
    id: "a-core-obp",
    ownerTeamId: "a",
    marketValue: 50,
    trend: 0,
    scores: { onBasePercentage: 75 },
    categoryValues: { onBasePercentage: 0.4 },
    categoryWeights: { onBasePercentage: 100 },
  },
  {
    id: "a-send-obp",
    ownerTeamId: "a",
    marketValue: 50,
    trend: 0,
    scores: { onBasePercentage: 25 },
    categoryValues: { onBasePercentage: 0.3 },
    categoryWeights: { onBasePercentage: 900 },
  },
  {
    id: "b-core-obp",
    ownerTeamId: "b",
    marketValue: 50,
    trend: 0,
    scores: { onBasePercentage: 35 },
    categoryValues: { onBasePercentage: 0.32 },
    categoryWeights: { onBasePercentage: 900 },
  },
  {
    id: "b-receive-obp",
    ownerTeamId: "b",
    marketValue: 50,
    trend: 0,
    scores: { onBasePercentage: 50 },
    categoryValues: { onBasePercentage: 0.35 },
    categoryWeights: { onBasePercentage: 100 },
  },
];
const weightedObpTrade = evaluateTrade({
  teamId: "a",
  partnerTeamId: "b",
  sendingIds: ["a-send-obp"],
  receivingIds: ["b-receive-obp"],
  players: weightedObpPlayers,
  teams: [{ id: "a" }, { id: "b" }],
  categories: [weightedObpCategory],
});
assert.ok(
  Math.abs(weightedObpTrade.deltas[0].valueChange - 0.065) < 0.000001
);
assert.ok(Math.abs(weightedObpTrade.deltas[0].raw - 32.5) < 0.000001);

const reverseCategory = {
  id: "losses",
  label: "L",
  name: "Losses",
  group: "pitching",
  aggregation: "count",
  direction: "lower",
  rangeMinimum: 0,
  rangeMaximum: 18,
};
const reversePlayers = [
  {
    id: "zero-losses",
    ownerTeamId: "a",
    marketValue: 50,
    trend: 0,
    scores: { losses: 100 },
    categoryValues: { losses: 0 },
  },
  {
    id: "nine-losses",
    ownerTeamId: "b",
    marketValue: 50,
    trend: 0,
    scores: { losses: 50 },
    categoryValues: { losses: 9 },
  },
];
const reverseContext = computeLeagueContext({
  players: reversePlayers,
  teams: [{ id: "a" }, { id: "b" }],
  categories: [reverseCategory],
});
assert.equal(reverseContext.profiles.get("a").categories.losses.rank, 1);
assert.equal(reverseContext.profiles.get("b").categories.losses.rank, 2);
const reverseTrade = evaluateTrade({
  teamId: "a",
  partnerTeamId: "b",
  sendingIds: ["zero-losses"],
  receivingIds: ["nine-losses"],
  players: reversePlayers,
  teams: [{ id: "a" }, { id: "b" }],
  categories: [reverseCategory],
  context: reverseContext,
});
assert.equal(reverseTrade.deltas[0].valueChange, 9);
assert.equal(reverseTrade.deltas[0].raw, -50);
assert.equal(reverseTrade.deltas[0].partnerRaw, 50);

const missingRateCategory = {
  id: "era",
  label: "ERA",
  name: "Earned run average",
  group: "pitching",
  aggregation: "rate",
  direction: "lower",
  rangeMinimum: 2.1,
  rangeMaximum: 5.3,
};
const missingRateContext = computeLeagueContext({
  players: [
    {
      id: "missing-era",
      ownerTeamId: "a",
      marketValue: 50,
      scores: {},
      categoryValues: {},
      categoryWeights: {},
    },
    {
      id: "known-era",
      ownerTeamId: "b",
      marketValue: 50,
      scores: { era: 70 },
      categoryValues: { era: 3.0 },
      categoryWeights: { era: 450 },
    },
  ],
  teams: [{ id: "a" }, { id: "b" }],
  categories: [missingRateCategory],
});
assert.equal(missingRateContext.profiles.get("b").categories.era.rank, 1);
assert.equal(missingRateContext.profiles.get("a").categories.era.rank, 2);

const lopsidedTrade = evaluateTrade({
  teamId: data.activeTeamId,
  partnerTeamId: "northside",
  sendingIds: ["aaron-judge"],
  receivingIds: ["david-bednar"],
  players: data.players,
  teams: data.teams,
  categories: data.categories,
  context,
});
assert.equal(lopsidedTrade.valid, true);
assert.ok(lopsidedTrade.fairness <= 50);
assert.equal(lopsidedTrade.realistic, false);

const incompleteTrade = evaluateTrade({
  teamId: data.activeTeamId,
  partnerTeamId: "northside",
  sendingIds: [],
  receivingIds: ["brice-turang"],
  players: data.players,
  teams: data.teams,
  categories: data.categories,
  context,
});
assert.equal(incompleteTrade.valid, false);

console.log("Fantasy trade engine tests passed.");
