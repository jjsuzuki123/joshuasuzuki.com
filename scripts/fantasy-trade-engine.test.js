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
