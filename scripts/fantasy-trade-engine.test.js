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

const largePackageTeams = [
  { id: "star-team", name: "Star team" },
  { id: "depth-team", name: "Depth team" },
];
const largePackagePlayers = [
  {
    id: "large-star",
    name: "Large-package star",
    ownerTeamId: "star-team",
    type: "hitter",
    positions: ["OF"],
    marketValue: 96,
    status: "Healthy",
    scores: { runs: 96 },
  },
  ...Array.from({ length: 7 }, (_value, index) => ({
    id: `incumbent-${index}`,
    name: `Incumbent ${index}`,
    ownerTeamId: "star-team",
    type: "hitter",
    positions: ["UTIL"],
    marketValue: 55,
    status: "Healthy",
    scores: { runs: 55 },
  })),
  {
    id: "useful-depth",
    name: "Useful depth",
    ownerTeamId: "depth-team",
    type: "hitter",
    positions: ["OF"],
    marketValue: 65,
    status: "Healthy",
    scores: { runs: 65 },
  },
  ...Array.from({ length: 8 }, (_value, index) => ({
    id: `marginal-${index}`,
    name: `Marginal ${index}`,
    ownerTeamId: "depth-team",
    type: "hitter",
    positions: ["UTIL"],
    marketValue: 10,
    status: "Healthy",
    scores: { runs: 10 },
  })),
];
const eightPlayerIds = [
  "useful-depth",
  ...Array.from({ length: 7 }, (_value, index) => `marginal-${index}`),
];
const eightForOne = evaluateTrade({
  teamId: "star-team",
  partnerTeamId: "depth-team",
  sendingIds: ["large-star"],
  receivingIds: eightPlayerIds,
  players: largePackagePlayers,
  teams: largePackageTeams,
  categories: packageCategories,
});
const reorderedEightForOne = evaluateTrade({
  teamId: "star-team",
  partnerTeamId: "depth-team",
  sendingIds: ["large-star"],
  receivingIds: [
    "marginal-0",
    "marginal-1",
    "useful-depth",
    "marginal-2",
    "marginal-3",
    "marginal-4",
    "marginal-5",
    "marginal-6",
  ],
  players: largePackagePlayers,
  teams: largePackageTeams,
  categories: packageCategories,
});
const oneForOneDepth = evaluateTrade({
  teamId: "star-team",
  partnerTeamId: "depth-team",
  sendingIds: ["large-star"],
  receivingIds: ["useful-depth"],
  players: largePackagePlayers,
  teams: largePackageTeams,
  categories: packageCategories,
});
assert.equal(eightForOne.valid, true);
assert.equal(eightForOne.droppedPlayers.length, 7);
assert.equal(eightForOne.discardedIncoming.length, 7);
assert.ok(eightForOne.valueIn - oneForOneDepth.valueIn < 17);
assert.ok(
  Math.abs(eightForOne.teamValueDelta - oneForOneDepth.teamValueDelta) <
    0.1
);
assert.ok(eightForOne.teamScore < oneForOneDepth.teamScore);
assert.equal(reorderedEightForOne.valueIn, eightForOne.valueIn);
assert.equal(reorderedEightForOne.fairness, eightForOne.fairness);
assert.equal(reorderedEightForOne.score, eightForOne.score);
assert.deepEqual(
  reorderedEightForOne.discardedIncoming
    .map((player) => player.id)
    .sort(),
  eightForOne.discardedIncoming.map((player) => player.id).sort()
);

const nineForOne = evaluateTrade({
  teamId: "star-team",
  partnerTeamId: "depth-team",
  sendingIds: ["large-star"],
  receivingIds: [...eightPlayerIds, "marginal-7"],
  players: largePackagePlayers,
  teams: largePackageTeams,
  categories: packageCategories,
});
assert.equal(nineForOne.valid, false);
assert.match(nineForOne.reason, /up to 8 players/);

const elitePackageTeams = [
  { id: "ohtani-team", name: "Ohtani team" },
  { id: "elite-depth", name: "Elite depth" },
];
const elitePackagePlayers = [
  {
    id: "ohtani",
    name: "Shohei Ohtani",
    ownerTeamId: "ohtani-team",
    type: "hitter",
    positions: ["UTIL"],
    marketValue: 99,
    status: "Healthy",
    scores: { runs: 99 },
  },
  {
    id: "ohtani-bench",
    name: "Ohtani team bench",
    ownerTeamId: "ohtani-team",
    type: "hitter",
    positions: ["OF"],
    marketValue: 35,
    status: "Healthy",
    scores: { runs: 35 },
  },
  {
    id: "elite-one",
    name: "Elite one",
    ownerTeamId: "elite-depth",
    type: "hitter",
    positions: ["OF"],
    marketValue: 90,
    status: "Healthy",
    scores: { runs: 90 },
  },
  {
    id: "elite-two",
    name: "Elite two",
    ownerTeamId: "elite-depth",
    type: "hitter",
    positions: ["SS"],
    marketValue: 90,
    status: "Healthy",
    scores: { runs: 90 },
  },
];
const oneEliteForOhtani = evaluateTrade({
  teamId: "ohtani-team",
  partnerTeamId: "elite-depth",
  sendingIds: ["ohtani"],
  receivingIds: ["elite-one"],
  players: elitePackagePlayers,
  teams: elitePackageTeams,
  categories: packageCategories,
});
const twoEliteForOhtani = evaluateTrade({
  teamId: "ohtani-team",
  partnerTeamId: "elite-depth",
  sendingIds: ["ohtani"],
  receivingIds: ["elite-one", "elite-two"],
  players: elitePackagePlayers,
  teams: elitePackageTeams,
  categories: packageCategories,
});
const reorderedEliteForOhtani = evaluateTrade({
  teamId: "ohtani-team",
  partnerTeamId: "elite-depth",
  sendingIds: ["ohtani"],
  receivingIds: ["elite-two", "elite-one"],
  players: elitePackagePlayers,
  teams: elitePackageTeams,
  categories: packageCategories,
});
assert.ok(
  twoEliteForOhtani.valueIn - oneEliteForOhtani.valueIn > 75
);
assert.ok(
  twoEliteForOhtani.teamValueDelta >
    oneEliteForOhtani.teamValueDelta
);
assert.equal(
  reorderedEliteForOhtani.valueIn,
  twoEliteForOhtani.valueIn
);
assert.equal(
  reorderedEliteForOhtani.score,
  twoEliteForOhtani.score
);

function calibrationPlayer({
  id,
  ownerTeamId,
  value,
  type = "hitter",
  positions = ["UTIL"],
}) {
  return {
    id,
    name: id,
    ownerTeamId,
    type,
    positions,
    marketValue: value,
    status: "Healthy",
    trend: 0,
    scores: { runs: value },
    signals: {
      projection: value,
      underlying: value,
      consensus: value,
    },
  };
}

const redditCalibrationTeams = [
  { id: "package-side", name: "Package side" },
  { id: "star-side", name: "Star side" },
];
const redditCalibrationPlayers = [
  calibrationPlayer({
    id: "ozzie-albies",
    ownerTeamId: "package-side",
    value: 40,
    positions: ["2B"],
  }),
  calibrationPlayer({
    id: "jackson-chourio",
    ownerTeamId: "package-side",
    value: 67,
    positions: ["OF"],
  }),
  calibrationPlayer({
    id: "oneil-cruz",
    ownerTeamId: "package-side",
    value: 57,
    positions: ["SS"],
  }),
  calibrationPlayer({
    id: "max-fried",
    ownerTeamId: "package-side",
    value: 52,
    type: "pitcher",
    positions: ["SP"],
  }),
  calibrationPlayer({
    id: "rafael-devers",
    ownerTeamId: "package-side",
    value: 44,
    positions: ["1B"],
  }),
  calibrationPlayer({
    id: "dylan-cease",
    ownerTeamId: "package-side",
    value: 50,
    type: "pitcher",
    positions: ["SP"],
  }),
  calibrationPlayer({
    id: "ronald-acuna",
    ownerTeamId: "star-side",
    value: 80,
    positions: ["OF"],
  }),
  calibrationPlayer({
    id: "corbin-carroll",
    ownerTeamId: "star-side",
    value: 73,
    positions: ["OF"],
  }),
  calibrationPlayer({
    id: "nick-kurtz",
    ownerTeamId: "star-side",
    value: 65,
    positions: ["1B"],
  }),
  ...Array.from({ length: 6 }, (_value, index) =>
    calibrationPlayer({
      id: `package-calibration-filler-${index}`,
      ownerTeamId: "package-side",
      value: 28,
      type: index % 2 === 0 ? "hitter" : "pitcher",
      positions: [index % 2 === 0 ? "UTIL" : "P"],
    })
  ),
  ...Array.from({ length: 9 }, (_value, index) =>
    calibrationPlayer({
      id: `star-calibration-filler-${index}`,
      ownerTeamId: "star-side",
      value: 28,
      type: index % 2 === 0 ? "hitter" : "pitcher",
      positions: [index % 2 === 0 ? "UTIL" : "P"],
    })
  ),
  calibrationPlayer({
    id: "jordan-westburg-waiver",
    ownerTeamId: null,
    value: 39,
    positions: ["2B", "3B"],
  }),
];

// These package shapes were the persistent misses in the July 2026 Reddit
// pressure test. Category scores are held neutral to isolate consolidation.
const acunaConsolidation = evaluateTrade({
  teamId: "package-side",
  partnerTeamId: "star-side",
  sendingIds: ["ozzie-albies", "jackson-chourio"],
  receivingIds: ["ronald-acuna"],
  players: redditCalibrationPlayers,
  teams: redditCalibrationTeams,
  categories: packageCategories,
});
const carrollConsolidation = evaluateTrade({
  teamId: "package-side",
  partnerTeamId: "star-side",
  sendingIds: ["oneil-cruz", "max-fried"],
  receivingIds: ["corbin-carroll"],
  players: redditCalibrationPlayers,
  teams: redditCalibrationTeams,
  categories: packageCategories,
});
const kurtzConsolidation = evaluateTrade({
  teamId: "package-side",
  partnerTeamId: "star-side",
  sendingIds: ["rafael-devers", "dylan-cease"],
  receivingIds: ["nick-kurtz"],
  players: redditCalibrationPlayers,
  teams: redditCalibrationTeams,
  categories: packageCategories,
});
assert.ok(acunaConsolidation.valueIn > acunaConsolidation.valueOut);
assert.ok(carrollConsolidation.valueIn >= carrollConsolidation.valueOut);
assert.ok(kurtzConsolidation.valueIn > kurtzConsolidation.valueOut);
assert.equal(
  acunaConsolidation.replacementPlayers[0].sourcePlayerId,
  "jordan-westburg-waiver"
);
assert.equal(
  acunaConsolidation.replacementPlayers[0].replacementSource,
  "available-player"
);

const estimatedReplacementTrade = evaluateTrade({
  teamId: "package-side",
  partnerTeamId: "star-side",
  sendingIds: ["ozzie-albies", "jackson-chourio"],
  receivingIds: ["ronald-acuna"],
  players: redditCalibrationPlayers.filter(
    (player) => player.id !== "jordan-westburg-waiver"
  ),
  teams: redditCalibrationTeams,
  categories: packageCategories,
});
assert.equal(
  estimatedReplacementTrade.replacementPlayers[0].replacementSource,
  "depth-estimate"
);
assert.ok(
  acunaConsolidation.teamDecisionValueDelta >
    estimatedReplacementTrade.teamDecisionValueDelta
);

const twoCatcherTeams = [
  { id: "two-catcher", name: "Two-catcher team" },
  { id: "other-team", name: "Other team" },
];
const twoCatcherPlayers = [
  calibrationPlayer({
    id: "catcher-one",
    ownerTeamId: "two-catcher",
    value: 60,
    positions: ["C"],
  }),
  calibrationPlayer({
    id: "catcher-two",
    ownerTeamId: "two-catcher",
    value: 55,
    positions: ["C"],
  }),
  calibrationPlayer({
    id: "two-catcher-filler",
    ownerTeamId: "two-catcher",
    value: 30,
  }),
  calibrationPlayer({
    id: "incoming-outfielder",
    ownerTeamId: "other-team",
    value: 60,
    positions: ["OF"],
  }),
  calibrationPlayer({
    id: "other-filler",
    ownerTeamId: "other-team",
    value: 30,
  }),
  calibrationPlayer({
    id: "other-catcher",
    ownerTeamId: "other-team",
    value: 30,
    positions: ["C"],
  }),
];
const defaultCatcherRequirement = evaluateTrade({
  teamId: "two-catcher",
  partnerTeamId: "other-team",
  sendingIds: ["catcher-one"],
  receivingIds: ["incoming-outfielder"],
  players: twoCatcherPlayers,
  teams: twoCatcherTeams,
  categories: packageCategories,
});
const configuredCatcherRequirement = evaluateTrade({
  teamId: "two-catcher",
  partnerTeamId: "other-team",
  sendingIds: ["catcher-one"],
  receivingIds: ["incoming-outfielder"],
  players: twoCatcherPlayers,
  teams: twoCatcherTeams,
  categories: packageCategories,
  rosterSettings: { positionRequirements: { C: 2 } },
});
assert.equal(defaultCatcherRequirement.rosterFitPenalty, 0);
assert.equal(configuredCatcherRequirement.rosterFitPenalty, 10);

const injuryCalibrationTeams = [
  { id: "okamoto-side", name: "Okamoto side" },
  { id: "holmes-side", name: "Holmes side" },
];
const injuryRosterSettings = { positionRequirements: { "3B": 1 } };
const injuryCategory = {
  id: "impact",
  label: "IMP",
  name: "Neutral impact",
  group: "all",
  aggregation: "count",
};
function injuryPlayer({
  id,
  ownerTeamId,
  value,
  type = "hitter",
  positions = ["UTIL"],
}) {
  return {
    id,
    name: id,
    ownerTeamId,
    type,
    positions,
    marketValue: value,
    status: "Healthy",
    trend: 0,
    rateWeight: 100,
    scores: { impact: value },
    signals: {
      projection: value,
      underlying: value,
      consensus: value,
    },
  };
}
const healthyOkamoto = {
  ...injuryPlayer({
    id: "kazuma-okamoto",
    ownerTeamId: "okamoto-side",
    value: 88,
    positions: ["3B"],
  }),
  provenance: { espn: { rank: 5 } },
};
const healthyHolmes = injuryPlayer({
  id: "clay-holmes",
  ownerTeamId: "holmes-side",
  value: 88,
  type: "pitcher",
  positions: ["SP"],
});
const injuredHolmes = {
  ...healthyHolmes,
  status: "60-day IL",
  isInjuredReserve: true,
  injury: {
    status: "60-day IL",
    severity: "long-term",
    ilDays: 60,
    source: "Licensed injury feed",
    updated: "2026-07-11T14:00:00.000Z",
  },
};
const injuryFillers = [
  injuryPlayer({
    id: "okamoto-spare-third",
    ownerTeamId: "okamoto-side",
    value: 40,
    positions: ["3B"],
  }),
  injuryPlayer({
    id: "okamoto-filler",
    ownerTeamId: "okamoto-side",
    value: 35,
  }),
  injuryPlayer({
    id: "holmes-spare-pitcher",
    ownerTeamId: "holmes-side",
    value: 40,
    type: "pitcher",
    positions: ["SP"],
  }),
  injuryPlayer({
    id: "holmes-filler",
    ownerTeamId: "holmes-side",
    value: 35,
  }),
];
const healthyInjuryCalibrationPlayers = [
  healthyOkamoto,
  healthyHolmes,
  ...injuryFillers,
];
const injuryCalibrationPlayers = [
  healthyOkamoto,
  injuredHolmes,
  ...injuryFillers,
];
assert.equal(healthyOkamoto.provenance.espn.rank, 5);
const okamotoRating = ratePlayer(healthyOkamoto, [injuryCategory]);
const healthyHolmesRating = ratePlayer(healthyHolmes, [injuryCategory]);
const holmesRating = ratePlayer(injuredHolmes, [injuryCategory]);
assert.equal(healthyHolmesRating.value, okamotoRating.value);
const contextOnlyHolmesRating = ratePlayer(
  {
    ...healthyHolmes,
    insights: {
      qualitative: [
        {
          impact: -1,
          confidence: 1,
          freshness: 1,
          modelEligible: false,
        },
      ],
    },
  },
  [injuryCategory]
);
assert.equal(contextOnlyHolmesRating.value, healthyHolmesRating.value);
const contextOnlyNewsRating = ratePlayer(
  {
    ...healthyHolmes,
    news: {
      impact: "negative",
      modelEligible: false,
    },
  },
  [injuryCategory]
);
assert.equal(contextOnlyNewsRating.value, healthyHolmesRating.value);
const staleQuantitativeRating = ratePlayer(
  {
    ...healthyHolmes,
    baseSignals: healthyHolmes.signals,
    baseModelScores: healthyHolmes.scores,
    signals: { projection: 99, underlying: 99, consensus: 99 },
    modelScores: { neutral: 99 },
    insights: {
      quantitative: [
        {
          overall: 99,
          categoryScores: { neutral: 99 },
          confidence: 1,
          freshness: 1,
          asOf: "2000-01-01T00:00:00.000Z",
        },
      ],
      qualitative: [],
    },
  },
  [injuryCategory]
);
assert.equal(staleQuantitativeRating.value, healthyHolmesRating.value);
assert.equal(holmesRating.availability.kind, "long-term");
assert.equal(holmesRating.availability.factor, 0.38);
assert.ok(holmesRating.value < okamotoRating.value * 0.5);

const genericIlRating = ratePlayer(
  {
    ...injuredHolmes,
    status: "INJURY_RESERVE",
    isInjuredReserve: false,
    injury: undefined,
  },
  [injuryCategory]
);
const lineupIlRating = ratePlayer(
  {
    ...healthyOkamoto,
    status: "Healthy",
    isInjuredReserve: true,
  },
  [injuryCategory]
);
assert.equal(genericIlRating.availability.factor, 0.65);
assert.equal(lineupIlRating.availability.factor, 0.65);
assert.ok(genericIlRating.value < okamotoRating.value);

const expiredInjuryRating = ratePlayer(
  {
    ...injuredHolmes,
    status: "60-day IL",
    baseStatus: "Healthy",
    isInjuredReserve: false,
    injury: {
      ...injuredHolmes.injury,
      expiresAt: "2020-01-01T00:00:00.000Z",
    },
  },
  [injuryCategory]
);
assert.equal(expiredInjuryRating.availability.factor, 1);

const healthyInjuryContext = computeLeagueContext({
  teams: injuryCalibrationTeams,
  categories: [injuryCategory],
  players: healthyInjuryCalibrationPlayers,
  rosterSettings: injuryRosterSettings,
});
const injuredCategoryContext = computeLeagueContext({
  teams: injuryCalibrationTeams,
  categories: [injuryCategory],
  players: injuryCalibrationPlayers,
  rosterSettings: injuryRosterSettings,
});
const healthyHolmesForOkamoto = evaluateTrade({
  teamId: "okamoto-side",
  partnerTeamId: "holmes-side",
  sendingIds: ["kazuma-okamoto"],
  receivingIds: ["clay-holmes"],
  players: healthyInjuryCalibrationPlayers,
  teams: injuryCalibrationTeams,
  categories: [injuryCategory],
  context: healthyInjuryContext,
  rosterSettings: injuryRosterSettings,
});
const holmesForOkamoto = evaluateTrade({
  teamId: "okamoto-side",
  partnerTeamId: "holmes-side",
  sendingIds: ["kazuma-okamoto"],
  receivingIds: ["clay-holmes"],
  players: injuryCalibrationPlayers,
  teams: injuryCalibrationTeams,
  categories: [injuryCategory],
  context: injuredCategoryContext,
  rosterSettings: injuryRosterSettings,
});
assert.equal(
  healthyHolmesForOkamoto.realistic,
  true,
  JSON.stringify({
    fairness: healthyHolmesForOkamoto.fairness,
    acceptance: healthyHolmesForOkamoto.acceptance,
    teamScore: healthyHolmesForOkamoto.teamScore,
    teamDecisionValueDelta: healthyHolmesForOkamoto.teamDecisionValueDelta,
    partnerDecisionValueDelta:
      healthyHolmesForOkamoto.partnerDecisionValueDelta,
    teamNeedGain: healthyHolmesForOkamoto.teamNeedGain,
    partnerNeedGain: healthyHolmesForOkamoto.partnerNeedGain,
    rosterFitPenalty: healthyHolmesForOkamoto.rosterFitPenalty,
    partnerRosterFitPenalty:
      healthyHolmesForOkamoto.partnerRosterFitPenalty,
  })
);
assert.ok(healthyHolmesForOkamoto.fairness >= 90);
assert.ok(holmesForOkamoto.valueIn < holmesForOkamoto.valueOut * 0.5);
assert.equal(holmesForOkamoto.realistic, false);
assert.equal(holmesForOkamoto.incomingAvailability.length, 1);
assert.equal(holmesForOkamoto.incomingAvailability[0].longTerm, true);
const injuryAwareOpportunities = findTradeOpportunities({
  teamId: "okamoto-side",
  players: injuryCalibrationPlayers,
  teams: injuryCalibrationTeams,
  categories: [injuryCategory],
  realisticOnly: true,
  includePackages: false,
  rosterSettings: injuryRosterSettings,
});
assert.equal(
  injuryAwareOpportunities.some(
    (opportunity) =>
      opportunity.sending.some((player) => player.id === "kazuma-okamoto") &&
      opportunity.receiving.some((player) => player.id === "clay-holmes")
  ),
  false
);

const countAvailabilityPlayers = [
  {
    ...injuryPlayer({
      id: "healthy-count",
      ownerTeamId: "healthy-count-team",
      value: 100,
    }),
    scores: { impact: 100 },
  },
  {
    ...injuryPlayer({
      id: "injured-count",
      ownerTeamId: "injured-count-team",
      value: 100,
    }),
    scores: { impact: 100 },
    status: "60-day IL",
    injury: { status: "60-day IL", ilDays: 60 },
  },
];
const countAvailabilityContext = computeLeagueContext({
  teams: [{ id: "healthy-count-team" }, { id: "injured-count-team" }],
  categories: [injuryCategory],
  players: countAvailabilityPlayers,
});
assert.equal(
  countAvailabilityContext.profiles.get("healthy-count-team").categories.impact
    .score,
  100
);
assert.equal(
  countAvailabilityContext.profiles.get("injured-count-team").categories.impact
    .score,
  38
);

const injuryRateCategory = {
  ...injuryCategory,
  id: "rateImpact",
  aggregation: "rate",
};
const rateAvailabilityPlayers = [
  ...["healthy-rate-team", "injured-rate-team"].map((ownerTeamId) => ({
    ...injuryPlayer({
      id: `${ownerTeamId}-core`,
      ownerTeamId,
      value: 50,
    }),
    scores: { rateImpact: 50 },
  })),
  {
    ...injuryPlayer({
      id: "healthy-rate-contributor",
      ownerTeamId: "healthy-rate-team",
      value: 100,
    }),
    scores: { rateImpact: 100 },
  },
  {
    ...injuryPlayer({
      id: "injured-rate-contributor",
      ownerTeamId: "injured-rate-team",
      value: 100,
    }),
    scores: { rateImpact: 100 },
    status: "60-day IL",
    injury: { status: "60-day IL", ilDays: 60 },
  },
];
const rateAvailabilityContext = computeLeagueContext({
  teams: [{ id: "healthy-rate-team" }, { id: "injured-rate-team" }],
  categories: [injuryRateCategory],
  players: rateAvailabilityPlayers,
});
assert.equal(
  rateAvailabilityContext.profiles.get("healthy-rate-team").categories
    .rateImpact.score,
  75
);
assert.ok(
  rateAvailabilityContext.profiles.get("injured-rate-team").categories
    .rateImpact.score < 65
);

const coverageTeams = [{ id: "coverage-a" }, { id: "coverage-b" }];
const outgoingThirdBaseman = injuryPlayer({
  id: "outgoing-third-baseman",
  ownerTeamId: "coverage-a",
  value: 70,
  positions: ["3B"],
});
const healthyIncomingThirdBaseman = injuryPlayer({
  id: "incoming-third-baseman",
  ownerTeamId: "coverage-b",
  value: 70,
  positions: ["3B"],
});
const healthyCoverageTrade = evaluateTrade({
  teamId: "coverage-a",
  partnerTeamId: "coverage-b",
  sendingIds: ["outgoing-third-baseman"],
  receivingIds: ["incoming-third-baseman"],
  players: [outgoingThirdBaseman, healthyIncomingThirdBaseman],
  teams: coverageTeams,
  categories: [injuryCategory],
});
const injuredCoverageTrade = evaluateTrade({
  teamId: "coverage-a",
  partnerTeamId: "coverage-b",
  sendingIds: ["outgoing-third-baseman"],
  receivingIds: ["incoming-third-baseman"],
  players: [
    outgoingThirdBaseman,
    {
      ...healthyIncomingThirdBaseman,
      status: "60-day IL",
      injury: { status: "60-day IL", ilDays: 60 },
    },
  ],
  teams: coverageTeams,
  categories: [injuryCategory],
});
const lineupIlCoverageTrade = evaluateTrade({
  teamId: "coverage-a",
  partnerTeamId: "coverage-b",
  sendingIds: ["outgoing-third-baseman"],
  receivingIds: ["incoming-third-baseman"],
  players: [
    outgoingThirdBaseman,
    {
      ...healthyIncomingThirdBaseman,
      status: "Day-to-day",
      isInjuredReserve: true,
    },
  ],
  teams: coverageTeams,
  categories: [injuryCategory],
});
assert.equal(healthyCoverageTrade.rosterFitPenalty, 0);
assert.ok(injuredCoverageTrade.rosterFitPenalty > 0);
assert.ok(lineupIlCoverageTrade.rosterFitPenalty > 0);

console.log("Fantasy trade engine tests passed.");
