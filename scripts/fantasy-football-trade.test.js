const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const data = require(path.join(__dirname, "..", "fantasy", "football-data.js"));
const value = require(path.join(__dirname, "..", "fantasy", "football-value.js"));
const trade = require(path.join(__dirname, "..", "fantasy", "football-trade.js"));

test("football data ships a usable universe", () => {
  assert.ok(data.players.length >= 60);
  assert.equal(data.defaultSettings.ppr, 1);
  assert.ok(data.sources.some((source) => source.kind === "quantitative"));
  assert.ok(data.sources.some((source) => source.kind === "qualitative"));
});

test("ppr and superflex change relative values", () => {
  const standard = value.ratePlayers(data.players, {
    leagueSize: 12,
    ppr: 0,
    superflex: false,
    tep: false,
  });
  const ppr = value.ratePlayers(data.players, {
    leagueSize: 12,
    ppr: 1,
    superflex: false,
    tep: false,
  });
  const superflex = value.ratePlayers(data.players, {
    leagueSize: 12,
    ppr: 1,
    superflex: true,
    tep: false,
  });

  const kamaraStd = value.getPlayerRating(standard, "alvin-kamara").value;
  const kamaraPpr = value.getPlayerRating(ppr, "alvin-kamara").value;
  assert.ok(kamaraPpr > kamaraStd, "PPR should lift pass-catching RBs");

  const allen1qb = value.getPlayerRating(ppr, "josh-allen").value;
  const allenSf = value.getPlayerRating(superflex, "josh-allen").value;
  assert.ok(allenSf > allen1qb, "Superflex should lift QBs");
});

test("tep lifts tight ends", () => {
  const base = value.ratePlayers(data.players, {
    leagueSize: 12,
    ppr: 1,
    tep: false,
  });
  const tep = value.ratePlayers(data.players, {
    leagueSize: 12,
    ppr: 1,
    tep: true,
  });
  const bowersBase = value.getPlayerRating(base, "brock-bowers").value;
  const bowersTep = value.getPlayerRating(tep, "brock-bowers").value;
  assert.ok(bowersTep > bowersBase);
});

test("equal-count trades have no slot tax", () => {
  const rated = value.ratePlayers(data.players, { leagueSize: 12, ppr: 1 });
  const map = value.valueMap(rated);
  const result = trade.evaluateTrade({
    sideA: [{ id: "jamarr-chase" }],
    sideB: [{ id: "justin-jefferson" }],
    valueById: map,
    slotCost: 14,
  });
  assert.equal(result.sideA.slotDelta, 0);
  assert.equal(result.sideA.slotAdjustment, 0);
  assert.equal(result.sideB.slotAdjustment, 0);
});

test("2-for-1 applies roster-space tax and consolidation premium", () => {
  const rated = value.ratePlayers(data.players, { leagueSize: 12, ppr: 1 });
  const map = value.valueMap(rated);
  const slotCost = 14;
  const result = trade.evaluateTrade({
    // Team One sends Chase, receives two mids
    sideA: [{ id: "jamarr-chase" }],
    sideB: [{ id: "tee-higgins" }, { id: "devonta-smith" }],
    valueById: map,
    slotCost: slotCost,
  });

  assert.equal(result.sideA.slotDelta, 1);
  assert.ok(result.sideA.slotAdjustment < 0, "side getting two pays tax");
  assert.equal(result.sideB.slotDelta, -1);
  assert.ok(result.sideB.slotAdjustment > 0, "side consolidating earns premium");

  // Without slot math, raw sum of two mids can beat the stud.
  assert.ok(result.sideA.raw > result.sideB.raw);
  // After slot math, consolidating into Chase should win or be close.
  assert.ok(
    result.sideB.adjusted >= result.sideA.adjusted - 5,
    "consolidation should close or flip the gap"
  );
});

test("3-for-2 taxes the side receiving more players", () => {
  const rated = value.ratePlayers(data.players, { leagueSize: 12, ppr: 1 });
  const map = value.valueMap(rated);
  const result = trade.evaluateTrade({
    sideA: ["bijan-robinson", "amon-ra"],
    sideB: ["tee-higgins", "devonta-smith", "josh-downs"],
    valueById: map,
    slotCost: 14,
  });
  assert.equal(result.sideA.slotDelta, 1);
  assert.ok(result.sideA.slotAdjustment < 0);
  assert.equal(result.sideB.slotDelta, -1);
  assert.ok(result.sideB.slotAdjustment > 0);
});

test("4-for-2 doubles the roster-space tax", () => {
  const rated = value.ratePlayers(data.players, { leagueSize: 12, ppr: 1 });
  const map = value.valueMap(rated);
  const slotCost = 14;
  const result = trade.evaluateTrade({
    sideA: ["jamarr-chase", "bijan-robinson"],
    sideB: ["tee-higgins", "devonta-smith", "josh-downs", "romeo-doubs"],
    valueById: map,
    slotCost: slotCost,
  });
  assert.equal(result.sideA.slotDelta, 2);
  assert.equal(result.sideA.slotAdjustment, -2 * slotCost);
});
