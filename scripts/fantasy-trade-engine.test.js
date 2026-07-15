"use strict";

const assert = require("node:assert/strict");
const data = require("../fantasy/data.js");
const {
  computeLeagueContext,
  evaluateTrade,
  findTradeOpportunities,
  getTeamAnalysis,
  ratePlayer,
} = require("../fantasy/trade-engine.js");

const forceCompete = {
  [data.activeTeamId]: {
    competeCategories: data.categories.map((category) => category.id),
  },
};
const context = computeLeagueContext({
  players: data.players,
  teams: data.teams,
  categories: data.categories,
  teamStrategies: forceCompete,
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
  teamStrategies: forceCompete,
  context,
});
assert.ok(analysis);
assert.equal(analysis.roster.length, 10);
assert.equal(analysis.categoryRows.length, 10);
assert.ok(
  analysis.categoryRows.find((category) => category.id === "stolenBases")
    .priority > 0
);
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
assert.ok(speedTrade.fairness >= 80);
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
const missingRatePlayers = [
  {
    id: "missing-era",
    ownerTeamId: "a",
    marketValue: 50,
    trend: 0,
    scores: {},
    categoryValues: {},
    categoryWeights: {},
  },
  {
    id: "known-era",
    ownerTeamId: "b",
    marketValue: 50,
    trend: 0,
    scores: { era: 70 },
    categoryValues: { era: 3.0 },
    categoryWeights: { era: 450 },
  },
];
const missingRateContext = computeLeagueContext({
  players: missingRatePlayers,
  teams: [{ id: "a" }, { id: "b" }],
  categories: [missingRateCategory],
});
assert.equal(missingRateContext.profiles.get("b").categories.era.rank, 1);
assert.equal(missingRateContext.profiles.get("a").categories.era.rank, 2);
const missingRateTrade = evaluateTrade({
  teamId: "a",
  partnerTeamId: "b",
  sendingIds: ["missing-era"],
  receivingIds: ["known-era"],
  players: missingRatePlayers,
  teams: [{ id: "a" }, { id: "b" }],
  categories: [missingRateCategory],
  context: missingRateContext,
});
assert.equal(missingRateTrade.deltas[0].valueChange, null);
assert.equal(missingRateTrade.deltas[0].raw, 70);
assert.equal(missingRateTrade.deltas[0].partnerRaw, -70);

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

const catcherHoleTrade = evaluateTrade({
  teamId: data.activeTeamId,
  partnerTeamId: "northside",
  sendingIds: ["tanner-scott"],
  receivingIds: ["logan-ohoppe"],
  players: data.players,
  teams: data.teams,
  categories: data.categories,
});
assert.ok(catcherHoleTrade.partnerRosterFitPenalty >= 10);
assert.ok(
  catcherHoleTrade.partnerMissingPositions.some(
    (position) => position.position === "C"
  )
);
assert.equal(catcherHoleTrade.realistic, false);

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

assert.equal(data.teamStrategies, undefined);
const inferredContext = computeLeagueContext({
  players: data.players,
  teams: data.teams,
  categories: data.categories,
});
const inferredAnalysis = getTeamAnalysis({
  teamId: data.activeTeamId,
  players: data.players,
  teams: data.teams,
  categories: data.categories,
  context: inferredContext,
});
const inferredStolenBases = inferredAnalysis.categoryRows.find(
  (category) => category.id === "stolenBases"
);
assert.equal(inferredStolenBases.strategy, "inferred-punt");
assert.equal(inferredStolenBases.priority, 0);
assert.ok(inferredStolenBases.inference.confidence >= 0.5);
assert.ok(inferredStolenBases.inference.difficulty >= 0.3);
assert.equal(
  inferredAnalysis.needs.some((category) => category.id === "stolenBases"),
  false
);
assert.equal(
  analysis.categoryRows.find((category) => category.id === "stolenBases")
    .strategy,
  "compete"
);

const renamedCategories = data.categories.map((category) =>
  category.id === "stolenBases"
    ? { ...category, id: "outlierCategory", label: "OUT" }
    : category
);
const renamedPlayers = data.players.map((player) => {
  if (!Number.isFinite(player.scores.stolenBases)) return player;
  const scores = { ...player.scores, outlierCategory: player.scores.stolenBases };
  delete scores.stolenBases;
  return { ...player, scores };
});
const renamedInference = getTeamAnalysis({
  teamId: data.activeTeamId,
  players: renamedPlayers,
  teams: data.teams,
  categories: renamedCategories,
});
assert.equal(
  renamedInference.categoryRows.find(
    (category) => category.id === "outlierCategory"
  ).strategy,
  "inferred-punt"
);

const teamStrategies = {
  [data.activeTeamId]: {
    puntCategories: ["stolenBases"],
    focusCategories: ["saves"],
  },
};
const puntContext = computeLeagueContext({
  players: data.players,
  teams: data.teams,
  categories: data.categories,
  teamStrategies,
});
const puntAnalysis = getTeamAnalysis({
  teamId: data.activeTeamId,
  players: data.players,
  teams: data.teams,
  categories: data.categories,
  teamStrategies,
  context: puntContext,
});
assert.equal(
  puntAnalysis.categoryRows.find((category) => category.id === "stolenBases")
    .priority,
  0
);
assert.equal(
  puntAnalysis.categoryRows.find((category) => category.id === "stolenBases")
    .strategy,
  "punt"
);
assert.equal(
  puntAnalysis.needs.some((category) => category.id === "stolenBases"),
  false
);
assert.equal(
  puntAnalysis.categoryRows.find((category) => category.id === "saves").strategy,
  "focus"
);

const puntSpeedTrade = evaluateTrade({
  teamId: data.activeTeamId,
  partnerTeamId: "northside",
  sendingIds: ["teoscar-hernandez"],
  receivingIds: ["brice-turang"],
  players: data.players,
  teams: data.teams,
  categories: data.categories,
  teamStrategies,
  context: puntContext,
});
const puntSpeedDelta = puntSpeedTrade.deltas.find(
  (category) => category.id === "stolenBases"
);
assert.equal(puntSpeedDelta.teamPriority, 0);
assert.equal(puntSpeedDelta.teamWeighted, 0);
assert.equal(
  puntSpeedTrade.gains.some((category) => category.id === "stolenBases"),
  false
);
assert.ok(
  puntSpeedTrade.puntEffects.some((category) => category.id === "stolenBases")
);

const wrongOwnerTrade = evaluateTrade({
  teamId: data.activeTeamId,
  partnerTeamId: "northside",
  sendingIds: ["brice-turang"],
  receivingIds: ["teoscar-hernandez"],
  players: data.players,
  teams: data.teams,
  categories: data.categories,
});
assert.equal(wrongOwnerTrade.valid, false);
assert.match(wrongOwnerTrade.reason, /belong/);

const mutualCategories = [
  {
    id: "power",
    label: "PWR",
    name: "Power",
    group: "batting",
    aggregation: "count",
  },
  {
    id: "speed",
    label: "SPD",
    name: "Speed",
    group: "batting",
    aggregation: "count",
  },
];
const mutualTeams = [
  { id: "a", name: "Power team" },
  { id: "b", name: "Speed team" },
  { id: "c", name: "Middle team" },
];
const mutualPlayers = [
  {
    id: "a-power",
    name: "Power bat",
    ownerTeamId: "a",
    type: "hitter",
    positions: ["OF"],
    marketValue: 70,
    status: "Healthy",
    scores: { power: 95, speed: 10 },
  },
  {
    id: "a-empty",
    name: "Empty bat",
    ownerTeamId: "a",
    type: "hitter",
    positions: ["OF"],
    marketValue: 70,
    status: "Healthy",
    scores: { power: 10, speed: 10 },
  },
  {
    id: "b-speed",
    name: "Speed bat",
    ownerTeamId: "b",
    type: "hitter",
    positions: ["OF"],
    marketValue: 70,
    status: "Healthy",
    scores: { power: 10, speed: 95 },
  },
  {
    id: "c-middle",
    name: "Middle bat",
    ownerTeamId: "c",
    type: "hitter",
    positions: ["OF"],
    marketValue: 70,
    status: "Healthy",
    scores: { power: 55, speed: 55 },
  },
];
const mutuallyUsefulTrade = evaluateTrade({
  teamId: "a",
  partnerTeamId: "b",
  sendingIds: ["a-power"],
  receivingIds: ["b-speed"],
  players: mutualPlayers,
  teams: mutualTeams,
  categories: mutualCategories,
});
const partnerUnhelpfulTrade = evaluateTrade({
  teamId: "a",
  partnerTeamId: "b",
  sendingIds: ["a-empty"],
  receivingIds: ["b-speed"],
  players: mutualPlayers,
  teams: mutualTeams,
  categories: mutualCategories,
});
assert.ok(mutuallyUsefulTrade.partnerNeedGain > partnerUnhelpfulTrade.partnerNeedGain);
assert.ok(mutuallyUsefulTrade.acceptance > partnerUnhelpfulTrade.acceptance);
assert.ok(
  mutuallyUsefulTrade.deltas.find((category) => category.id === "power")
    .partnerPointDelta > 0
);
assert.ok(mutuallyUsefulTrade.partnerRotoPointGain >= 0);

const healthyRating = ratePlayer(
  {
    marketValue: 80,
    status: "Healthy",
    trend: 0,
    type: "hitter",
    scores: { power: 80, speed: 60 },
  },
  mutualCategories
);
const injuredRating = ratePlayer(
  {
    marketValue: 80,
    status: "INJURY_RESERVE",
    trend: 0,
    type: "hitter",
    scores: { power: 80, speed: 60 },
    insights: {
      qualitative: [
        {
          sourceId: "rotowire",
          impact: "negative",
          confidence: 0.9,
          freshness: 1,
        },
      ],
    },
  },
  mutualCategories
);
assert.ok(healthyRating.value > injuredRating.value);
assert.ok(injuredRating.components.qualitative < 0);

const packageTeams = [
  { id: "buyers", name: "Buyers" },
  { id: "sellers", name: "Sellers" },
];
const packageCategories = [
  {
    id: "runs",
    label: "R",
    name: "Runs",
    group: "batting",
    aggregation: "count",
  },
];
const packagePlayers = [
  {
    id: "mid-one",
    name: "Mid one",
    ownerTeamId: "buyers",
    type: "hitter",
    positions: ["OF"],
    marketValue: 58,
    status: "Healthy",
    scores: { runs: 68 },
  },
  {
    id: "mid-two",
    name: "Mid two",
    ownerTeamId: "buyers",
    type: "hitter",
    positions: ["1B"],
    marketValue: 56,
    status: "Healthy",
    scores: { runs: 66 },
  },
  {
    id: "buyer-filler",
    name: "Buyer filler",
    ownerTeamId: "buyers",
    type: "hitter",
    positions: ["2B"],
    marketValue: 25,
    status: "Healthy",
    scores: { runs: 25 },
  },
  {
    id: "star",
    name: "Star",
    ownerTeamId: "sellers",
    type: "hitter",
    positions: ["OF"],
    marketValue: 92,
    status: "Healthy",
    scores: { runs: 94 },
  },
  {
    id: "seller-filler",
    name: "Seller filler",
    ownerTeamId: "sellers",
    type: "hitter",
    positions: ["SS"],
    marketValue: 24,
    status: "Healthy",
    scores: { runs: 24 },
  },
];
const packageOpportunities = findTradeOpportunities({
  teamId: "buyers",
  players: packagePlayers,
  teams: packageTeams,
  categories: packageCategories,
  realisticOnly: false,
  includePackages: true,
  limit: 20,
});
assert.ok(
  packageOpportunities.some(
    (opportunity) =>
      opportunity.sending.length === 2 && opportunity.receiving.length === 1
  )
);

const threeForOne = evaluateTrade({
  teamId: "sellers",
  partnerTeamId: "buyers",
  sendingIds: ["star"],
  receivingIds: ["mid-one", "mid-two", "buyer-filler"],
  players: packagePlayers,
  teams: packageTeams,
  categories: packageCategories,
});
const twoForOne = evaluateTrade({
  teamId: "sellers",
  partnerTeamId: "buyers",
  sendingIds: ["star"],
  receivingIds: ["mid-one", "mid-two"],
  players: packagePlayers,
  teams: packageTeams,
  categories: packageCategories,
});
assert.equal(threeForOne.droppedPlayers.length, 2);
assert.ok(
  threeForOne.discardedIncoming.some(
    (player) => player.id === "buyer-filler"
  )
);
assert.equal(threeForOne.partnerReplacementPlayers.length, 2);
assert.equal(threeForOne.partnerDepthPenalty, 0);
assert.ok(
  threeForOne.teamValueDelta <= twoForOne.teamValueDelta + 0.1
);
assert.ok(threeForOne.teamScore < twoForOne.teamScore);
assert.ok(
  threeForOne.teamValueDelta <
    threeForOne.listedValueIn - threeForOne.listedValueOut
);
assert.ok(
  packageOpportunities.some(
    (opportunity) =>
      opportunity.sending.length === 3 &&
      opportunity.receiving.length === 1
  )
);

console.log("Fantasy trade engine tests passed.");
