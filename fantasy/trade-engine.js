(function initTradeEngine(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.TradeEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTradeEngine() {
  "use strict";

  const VALUE_WEIGHTS = [1, 0.68, 0.45];
  const POSITION_REQUIREMENTS = {
    C: { minimum: 1, cost: 10 },
    "1B": { minimum: 1, cost: 4 },
    "2B": { minimum: 1, cost: 5 },
    "3B": { minimum: 1, cost: 4 },
    SS: { minimum: 1, cost: 5 },
    OF: { minimum: 2, cost: 3 },
    SP: { minimum: 2, cost: 3 },
    RP: { minimum: 1, cost: 5 },
  };

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function mean(values) {
    const finiteValues = values.filter(Number.isFinite);
    if (finiteValues.length === 0) return 0;
    return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
  }

  function median(values) {
    const finiteValues = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (finiteValues.length === 0) return 0;
    const middle = Math.floor(finiteValues.length / 2);
    return finiteValues.length % 2 === 0
      ? (finiteValues[middle - 1] + finiteValues[middle]) / 2
      : finiteValues[middle];
  }

  function weightedMean(entries) {
    const usable = entries.filter(
      (entry) =>
        entry &&
        Number.isFinite(entry.value) &&
        Number.isFinite(entry.weight) &&
        entry.weight > 0
    );
    const totalWeight = sum(usable.map((entry) => entry.weight));
    if (totalWeight <= 0) return null;
    return sum(usable.map((entry) => entry.value * entry.weight)) / totalWeight;
  }

  function sum(values) {
    return values.filter(Number.isFinite).reduce((total, value) => total + value, 0);
  }

  function round(value, digits = 0) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function scoresFor(player) {
    if (!player) return {};
    return player.modelScores || player.scores || {};
  }

  function scoreFor(player, categoryId) {
    const score = scoresFor(player)[categoryId];
    return Number.isFinite(score) ? score : null;
  }

  function categoryValueFor(player, categoryId) {
    const value = player?.categoryValues?.[categoryId];
    return Number.isFinite(value) ? value : null;
  }

  function playerMatchesCategoryGroup(player, category) {
    if (!player?.type || !category?.group) return true;
    if (category.group === "batting") return player.type === "hitter";
    if (category.group === "pitching") return player.type === "pitcher";
    return true;
  }

  function categoryUsesRawValues(players, category) {
    const relevantPlayers = players.filter((player) =>
      playerMatchesCategoryGroup(player, category)
    );
    if (relevantPlayers.length === 0) return false;
    if (
      relevantPlayers.some((player) =>
        Number.isFinite(player?.modelScores?.[category.id])
      )
    ) {
      return false;
    }
    const rawCoverage =
      relevantPlayers.filter((player) =>
        Number.isFinite(categoryValueFor(player, category.id))
      ).length / relevantPlayers.length;
    return rawCoverage >= 0.9;
  }

  function weightForRate(player, categoryId) {
    const categoryWeight = player?.categoryWeights?.[categoryId];
    if (Number.isFinite(categoryWeight) && categoryWeight > 0) {
      return categoryWeight;
    }
    return Number.isFinite(player?.rateWeight) && player.rateWeight > 0
      ? player.rateWeight
      : 1;
  }

  function weightedRateScore(players, categoryId) {
    const scoredPlayers = players.filter((player) =>
      Number.isFinite(scoreFor(player, categoryId))
    );
    if (scoredPlayers.length === 0) return null;
    const totalWeight = sum(
      scoredPlayers.map((player) => weightForRate(player, categoryId))
    );
    return (
      sum(
        scoredPlayers.map(
          (player) =>
            scoreFor(player, categoryId) * weightForRate(player, categoryId)
        )
      ) / totalWeight
    );
  }

  function weightedRateValue(players, categoryId) {
    const valuedPlayers = players.filter((player) =>
      Number.isFinite(categoryValueFor(player, categoryId))
    );
    if (valuedPlayers.length === 0) return null;
    const totalWeight = sum(
      valuedPlayers.map((player) => weightForRate(player, categoryId))
    );
    return (
      sum(
        valuedPlayers.map(
          (player) =>
            categoryValueFor(player, categoryId) *
            weightForRate(player, categoryId)
        )
      ) / totalWeight
    );
  }

  function aggregateCategory(players, category, useRawValues) {
    if (useRawValues) {
      if (category.aggregation === "rate") {
        return weightedRateValue(players, category.id);
      }
      const values = players
        .map((player) => categoryValueFor(player, category.id))
        .filter(Number.isFinite);
      return values.length > 0 ? sum(values) : null;
    }
    if (category.aggregation === "rate") {
      return weightedRateScore(players, category.id);
    }
    const values = players
      .map((player) => scoreFor(player, category.id))
      .filter(Number.isFinite);
    return values.length > 0 ? sum(values) : null;
  }

  function playersForTeam(players, teamId) {
    return players.filter(
      (player) => String(player.ownerTeamId) === String(teamId)
    );
  }

  function strategyForTeam(teamStrategies, teamId) {
    const raw =
      teamStrategies instanceof Map
        ? teamStrategies.get(String(teamId)) || teamStrategies.get(teamId)
        : teamStrategies?.[String(teamId)] || teamStrategies?.[teamId];
    const strategy = raw || {};
    return {
      puntCategories: new Set(
        Array.isArray(strategy.puntCategories)
          ? strategy.puntCategories.map(String)
          : []
      ),
      focusCategories: new Set(
        Array.isArray(strategy.focusCategories)
          ? strategy.focusCategories.map(String)
          : []
      ),
      competeCategories: new Set(
        Array.isArray(strategy.competeCategories)
          ? strategy.competeCategories.map(String)
          : []
      ),
      categoryWeights:
        strategy.categoryWeights && typeof strategy.categoryWeights === "object"
          ? strategy.categoryWeights
          : {},
    };
  }

  function favorableCompare(left, right, category) {
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
    if (left === right) return 0;
    const lowerIsBetter = category.direction === "lower";
    return lowerIsBetter
      ? left < right
        ? 1
        : -1
      : left > right
        ? 1
        : -1;
  }

  function rankDetails(entries, teamId, category) {
    const target = entries.find(
      (entry) => String(entry.teamId) === String(teamId)
    );
    const targetScore = target?.score;
    if (!Number.isFinite(targetScore)) {
      const missingCount = entries.filter(
        (entry) => !Number.isFinite(entry.score)
      ).length;
      return {
        rank: entries.length - missingCount + 1,
        percentile: 0,
        rotoPoints: missingCount > 0 ? (missingCount + 1) / 2 : 0,
      };
    }
    const betterCount = entries.filter(
      (entry) => favorableCompare(entry.score, targetScore, category) > 0
    ).length;
    const tieCount = entries.filter(
      (entry) => Number.isFinite(entry.score) && entry.score === targetScore
    ).length;
    const rankPosition = betterCount + (Math.max(1, tieCount) - 1) / 2;
    const percentile =
      entries.length <= 1
        ? 100
        : Math.round((1 - rankPosition / (entries.length - 1)) * 100);
    return {
      rank: betterCount + 1,
      percentile: clamp(percentile, 0, 100),
      rotoPoints: entries.length - rankPosition,
    };
  }

  function categoryPlayerScale(players, category, useRawValues) {
    const values = players
      .filter((player) => playerMatchesCategoryGroup(player, category))
      .map((player) =>
        useRawValues
          ? categoryValueFor(player, category.id)
          : scoreFor(player, category.id)
      )
      .filter(Number.isFinite);
    if (values.length < 2) return 1;
    const observedRange = Math.max(...values) - Math.min(...values);
    const configuredRange =
      useRawValues &&
      Number.isFinite(category.rangeMaximum) &&
      Number.isFinite(category.rangeMinimum)
        ? category.rangeMaximum - category.rangeMinimum
        : 0;
    return Math.max(observedRange, configuredRange, 0.0001);
  }

  function categoryLeverage(entries, teamId, category, playerScale) {
    const target = entries.find(
      (entry) => String(entry.teamId) === String(teamId)
    );
    const score = target?.score;
    const finiteScores = entries.map((entry) => entry.score).filter(Number.isFinite);
    if (!Number.isFinite(score) || finiteScores.length < 2) {
      return {
        gainGap: null,
        loseGap: null,
        gainDifficulty: null,
        pointOpportunity: 0,
      };
    }
    const betterGaps = entries
      .filter((entry) => favorableCompare(entry.score, score, category) > 0)
      .map((entry) => Math.abs(entry.score - score));
    const worseGaps = entries
      .filter((entry) => favorableCompare(entry.score, score, category) < 0)
      .map((entry) => Math.abs(entry.score - score));
    const gainGap = betterGaps.length > 0 ? Math.min(...betterGaps) : null;
    const loseGap = worseGaps.length > 0 ? Math.min(...worseGaps) : null;
    const normalizedGap = Number.isFinite(gainGap) ? gainGap : loseGap;
    const gainDifficulty = Number.isFinite(gainGap)
      ? gainGap / Math.max(playerScale, 0.0001)
      : 0;
    const pointOpportunity =
      !Number.isFinite(normalizedGap)
        ? 0.5
        : clamp(1 - normalizedGap / Math.max(playerScale, 0.0001), 0, 1);
    return { gainGap, loseGap, gainDifficulty, pointOpportunity };
  }

  function inferPuntCategories(categoryProfiles, strategy) {
    const entries = Object.entries(categoryProfiles);
    const inferred = new Map();
    if (entries.length < 5) return inferred;
    entries.forEach(([categoryId, profile]) => {
      const key = String(categoryId);
      if (
        strategy.puntCategories.has(key) ||
        strategy.focusCategories.has(key) ||
        strategy.competeCategories.has(key) ||
        Number.isFinite(Number(strategy.categoryWeights[key]))
      ) {
        return;
      }
      const otherPercentiles = entries
        .filter(([otherId]) => String(otherId) !== key)
        .map(([, other]) => other.percentile);
      const comparisonPercentile = median(otherPercentiles);
      const relativeGap = clamp(
        (comparisonPercentile - profile.percentile) / 100,
        0,
        1
      );
      const difficulty = Number.isFinite(profile.gainDifficulty)
        ? profile.gainDifficulty
        : 0;
      const confidence = relativeGap * 0.45 + difficulty * 0.75;
      if (
        profile.percentile <= 20 &&
        relativeGap >= 0.3 &&
        difficulty >= 0.3 &&
        confidence >= 0.5
      ) {
        inferred.set(key, {
          confidence: clamp(confidence, 0, 1),
          comparisonPercentile,
          relativeGap,
          difficulty,
        });
      }
    });
    return inferred;
  }

  function categoryPriority(
    categoryProfile,
    strategy,
    categoryId,
    inferredPunts
  ) {
    const key = String(categoryId);
    if (strategy.puntCategories.has(String(categoryId))) return 0;
    if (
      inferredPunts.has(key) &&
      !strategy.competeCategories.has(key) &&
      !strategy.focusCategories.has(key)
    ) {
      return 0;
    }
    const explicitWeight = Number(strategy.categoryWeights[key]);
    if (Number.isFinite(explicitWeight)) {
      return clamp(explicitWeight, 0, 2);
    }
    const inferred = clamp(
      0.48 +
        categoryProfile.pointOpportunity * 0.62 +
        (categoryProfile.need / 100) * 0.24,
      0.35,
      1.35
    );
    return strategy.focusCategories.has(String(categoryId))
      ? clamp(inferred * 1.4, 1.25, 1.8)
      : inferred;
  }

  function impactValue(impact) {
    if (Number.isFinite(impact)) return clamp(impact, -1, 1);
    const normalized = String(impact || "").toLowerCase();
    if (["positive", "upgrade", "promoted", "healthy"].includes(normalized)) {
      return 0.65;
    }
    if (["negative", "downgrade", "demoted", "injured"].includes(normalized)) {
      return -0.75;
    }
    return 0;
  }

  function statusAdjustment(status) {
    const normalized = String(status || "Healthy").toUpperCase();
    if (normalized === "HEALTHY" || normalized === "ACTIVE") return 0;
    if (normalized.includes("DAY") || normalized.includes("DTD")) return -3;
    if (
      normalized.includes("IL") ||
      normalized.includes("OUT") ||
      normalized.includes("SUSP")
    ) {
      return -9;
    }
    return -4;
  }

  function positionCount(roster, position) {
    return roster.filter((player) =>
      Array.isArray(player.positions)
        ? player.positions.includes(position)
        : false
    ).length;
  }

  function rosterCoverage(beforeRoster, afterRoster) {
    const missing = [];
    let penalty = 0;
    Object.entries(POSITION_REQUIREMENTS).forEach(
      ([position, requirement]) => {
        const before = positionCount(beforeRoster, position);
        const after = positionCount(afterRoster, position);
        const expected = Math.min(requirement.minimum, before);
        if (after >= expected) return;
        const shortage = expected - after;
        const cost = shortage * requirement.cost;
        penalty += cost;
        missing.push({ position, shortage, penalty: cost });
      }
    );
    return { penalty, missing };
  }

  function positionalScarcityBonus(player, profile) {
    if (!profile || !Array.isArray(player?.positions)) return 0;
    const bonuses = player.positions
      .map((position) => {
        const requirement = POSITION_REQUIREMENTS[position];
        if (!requirement) return 0;
        const count = positionCount(profile.roster, position);
        if (count > requirement.minimum) return 0;
        return Math.min(6, requirement.cost * 0.6);
      })
      .filter((value) => value > 0);
    return bonuses.length > 0 ? Math.max(...bonuses) : 0;
  }

  function qualitativeAdjustment(player) {
    const evidence = Array.isArray(player?.insights?.qualitative)
      ? player.insights.qualitative
      : [];
    if (evidence.length > 0) {
      return clamp(
        sum(
          evidence.map((item) => {
            const confidence = Number.isFinite(item.confidence)
              ? clamp(item.confidence, 0, 1)
              : 0.7;
            const freshness = Number.isFinite(item.freshness)
              ? clamp(item.freshness, 0, 1)
              : 1;
            return impactValue(item.impact) * confidence * freshness;
          })
        ),
        -1,
        1
      );
    }
    return impactValue(player?.news?.impact) * 0.6;
  }

  function quantitativeEvidence(player) {
    return Array.isArray(player?.insights?.quantitative)
      ? player.insights.quantitative
      : [];
  }

  function ratePlayer(player, categories = []) {
    const relevantCategories = categories.filter((category) =>
      playerMatchesCategoryGroup(player, category)
    );
    const categoryScores = relevantCategories
      .map((category) => scoreFor(player, category.id))
      .filter(Number.isFinite);
    const categoryComposite =
      categoryScores.length > 0 ? mean(categoryScores) : null;
    const marketAnchor = Number.isFinite(player?.marketValue)
      ? clamp(player.marketValue, 1, 99)
      : 40;
    const evidence = quantitativeEvidence(player);
    const evidenceEntries = evidence
      .map((item) => ({
        value: Number(item.overall),
        weight:
          clamp(Number.isFinite(item.confidence) ? item.confidence : 0.65, 0, 1) *
          clamp(Number.isFinite(item.freshness) ? item.freshness : 1, 0, 1),
      }))
      .filter((entry) => Number.isFinite(entry.value));
    const signalEntries = [
      { value: Number(player?.signals?.projection), weight: 0.9 },
      { value: Number(player?.signals?.underlying), weight: 0.65 },
      { value: Number(player?.signals?.consensus), weight: 0.8 },
      ...evidenceEntries,
    ].filter((entry) => Number.isFinite(entry.value));
    const signalComposite = weightedMean(signalEntries);
    const components = [{ value: marketAnchor, weight: 0.5 }];
    if (Number.isFinite(categoryComposite)) {
      components.push({ value: categoryComposite, weight: 0.3 });
    }
    if (Number.isFinite(signalComposite)) {
      components.push({ value: signalComposite, weight: 0.2 });
    }
    const base = weightedMean(components) ?? marketAnchor;
    const availability = statusAdjustment(player?.status);
    const qualitative = qualitativeAdjustment(player) * 7;
    const trend = clamp(Number(player?.trend) || 0, -12, 12) * 0.2;
    const rating = clamp(base + availability + qualitative + trend, 1, 99);
    const expectedCategoryCount = Math.max(1, relevantCategories.length);
    const coverage = categoryScores.length / expectedCategoryCount;
    const evidenceConfidence =
      evidenceEntries.length > 0 ? mean(evidenceEntries.map((entry) => entry.weight)) : 0;
    const confidence = clamp(
      0.42 + coverage * 0.38 + (signalEntries.length > 0 ? 0.1 : 0) +
        evidenceConfidence * 0.1,
      0.35,
      1
    );

    return {
      value: round(rating, 1),
      confidence: round(confidence, 2),
      components: {
        market: round(marketAnchor, 1),
        categories: round(categoryComposite, 1),
        signals: round(signalComposite, 1),
        availability: round(availability, 1),
        qualitative: round(qualitative, 1),
      },
    };
  }

  function bundleValue(players, valueForPlayer) {
    return round(
      sum(
        [...players]
          .map((player) => valueForPlayer(player))
          .filter(Number.isFinite)
          .sort((left, right) => right - left)
          .map((value, index) => value * (VALUE_WEIGHTS[index] || 0.35))
      ),
      1
    );
  }

  function computeLeagueContext({
    players,
    teams,
    categories,
    teamStrategies = {},
  }) {
    const rawProfiles = new Map();
    const rawCategoryModes = {};
    const playerRatings = new Map();
    categories.forEach((category) => {
      rawCategoryModes[category.id] = categoryUsesRawValues(players, category);
    });
    players.forEach((player) => {
      playerRatings.set(String(player.id), ratePlayer(player, categories));
    });

    teams.forEach((team) => {
      const roster = playersForTeam(players, team.id);
      const scores = {};
      categories.forEach((category) => {
        scores[category.id] = aggregateCategory(
          roster,
          category,
          rawCategoryModes[category.id]
        );
      });
      rawProfiles.set(String(team.id), {
        roster,
        scores,
        listedValue: sum(roster.map((player) => player.marketValue)),
        totalValue: round(
          sum(
            roster.map(
              (player) => playerRatings.get(String(player.id))?.value
            )
          ),
          1
        ),
      });
    });

    const categoryEntries = {};
    categories.forEach((category) => {
      categoryEntries[category.id] = teams.map((team) => ({
        teamId: String(team.id),
        score: rawProfiles.get(String(team.id))?.scores[category.id],
      }));
    });
    const categoryScales = Object.fromEntries(
      categories.map((category) => [
        category.id,
        categoryPlayerScale(
          players,
          category,
          rawCategoryModes[category.id]
        ),
      ])
    );

    const profiles = new Map();
    teams.forEach((team) => {
      const teamId = String(team.id);
      const raw = rawProfiles.get(teamId);
      const strategy = strategyForTeam(teamStrategies, teamId);
      const categoryProfile = {};
      categories.forEach((category) => {
        const entries = categoryEntries[category.id];
        const rank = rankDetails(entries, teamId, category);
        const leverage = categoryLeverage(
          entries,
          teamId,
          category,
          categoryScales[category.id]
        );
        categoryProfile[category.id] = {
          score: raw.scores[category.id],
          rank: rank.rank,
          percentile: rank.percentile,
          rotoPoints: round(rank.rotoPoints, 1),
          need: 100 - rank.percentile,
          ...leverage,
        };
      });
      const inferredPunts = inferPuntCategories(categoryProfile, strategy);
      const rawPriorities = Object.fromEntries(
        categories.map((category) => [
          category.id,
          categoryPriority(
            categoryProfile[category.id],
            strategy,
            category.id,
            inferredPunts
          ),
        ])
      );
      const activePriorityTotal = sum(
        Object.values(rawPriorities).filter((priority) => priority > 0)
      );
      const priorityScale =
        activePriorityTotal > 0
          ? categories.length / activePriorityTotal
          : 1;
      categories.forEach((category) => {
        const preliminary = categoryProfile[category.id];
        const rawPriority = rawPriorities[category.id];
        const priority =
          rawPriority === 0
            ? 0
            : clamp(rawPriority * priorityScale, 0.2, 2);
        const key = String(category.id);
        const inference = inferredPunts.get(key);
        const strategyLabel = strategy.puntCategories.has(key)
          ? "punt"
          : strategy.focusCategories.has(key)
            ? "focus"
            : inference && !strategy.competeCategories.has(key)
              ? "inferred-punt"
              : "compete";
        categoryProfile[category.id] = {
          ...preliminary,
          priority: round(priority, 2),
          strategy: strategyLabel,
          inference: inference
            ? {
                confidence: round(inference.confidence, 2),
                comparisonPercentile: round(
                  inference.comparisonPercentile,
                  1
                ),
                relativeGap: round(inference.relativeGap, 2),
                difficulty: round(inference.difficulty, 2),
              }
            : null,
          targetScore: round(
            priority *
              (0.45 + preliminary.need / 100) *
              (0.6 + preliminary.pointOpportunity * 0.4),
            2
          ),
        };
      });
      const activeCategories = Object.values(categoryProfile).filter(
        (category) => category.priority > 0
      );
      const strategyScore =
        weightedMean(
          activeCategories.map((category) => ({
            value: category.percentile,
            weight: category.priority,
          }))
        ) ?? 0;
      profiles.set(teamId, {
        team,
        roster: raw.roster,
        listedValue: raw.listedValue,
        totalValue: raw.totalValue,
        categories: categoryProfile,
        overallScore: Math.round(
          mean(Object.values(categoryProfile).map((category) => category.percentile))
        ),
        strategyScore: Math.round(strategyScore),
        rotoPoints: round(
          sum(Object.values(categoryProfile).map((category) => category.rotoPoints)),
          1
        ),
      });
    });

    return {
      profiles,
      teams,
      categories,
      players,
      rawProfiles,
      rawCategoryModes,
      categoryEntries,
      categoryScales,
      playerRatings,
      teamStrategies,
    };
  }

  function ensureContext({
    players,
    teams,
    categories,
    teamStrategies,
    context,
  }) {
    return (
      context ||
      computeLeagueContext({ players, teams, categories, teamStrategies })
    );
  }

  function contextualPlayerValue(player, profile, context) {
    const base = context.playerRatings.get(String(player.id))?.value ??
      ratePlayer(player, context.categories).value;
    if (!profile) return base;
    const fitEntries = context.categories
      .map((category) => {
        const score = scoreFor(player, category.id);
        const categoryProfile = profile.categories[category.id];
        if (!Number.isFinite(score) || !categoryProfile) return null;
        return {
          value: ((score - 50) / 50) * categoryProfile.priority,
          weight: Math.max(0.1, categoryProfile.priority),
        };
      })
      .filter(Boolean);
    const fit = weightedMean(fitEntries) ?? 0;
    const scarcity = positionalScarcityBonus(player, profile);
    return round(clamp(base + fit * 8 + scarcity, 1, 110), 1);
  }

  function ratePlayerForTeam({
    player,
    teamId,
    players,
    teams,
    categories,
    teamStrategies = {},
    context,
  }) {
    const leagueContext = ensureContext({
      players,
      teams,
      categories,
      teamStrategies,
      context,
    });
    const base = leagueContext.playerRatings.get(String(player.id)) ||
      ratePlayer(player, categories);
    const profile = leagueContext.profiles.get(String(teamId));
    return {
      ...base,
      contextualValue: contextualPlayerValue(player, profile, leagueContext),
    };
  }

  function getTeamAnalysis({
    teamId,
    players,
    teams,
    categories,
    teamStrategies = {},
    context,
  }) {
    const leagueContext = ensureContext({
      players,
      teams,
      categories,
      teamStrategies,
      context,
    });
    const profile = leagueContext.profiles.get(String(teamId));
    if (!profile) return null;

    const categoryRows = categories.map((category) => ({
      ...category,
      ...profile.categories[category.id],
    }));
    const needs = categoryRows
      .filter((category) => category.priority > 0)
      .sort(
        (left, right) =>
          right.targetScore - left.targetScore ||
          right.need - left.need ||
          (left.score ?? Infinity) - (right.score ?? Infinity)
      )
      .slice(0, 4);
    const strengths = categoryRows
      .filter((category) => category.priority > 0)
      .sort(
        (left, right) =>
          right.percentile - left.percentile ||
          (right.score ?? -Infinity) - (left.score ?? -Infinity)
      )
      .slice(0, 4);
    const projectedOrder = [...leagueContext.profiles.values()].sort(
      (left, right) =>
        right.rotoPoints - left.rotoPoints ||
        right.overallScore - left.overallScore ||
        right.totalValue - left.totalValue
    );
    const projectedFinish =
      projectedOrder.findIndex(
        (entry) => String(entry.team.id) === String(teamId)
      ) + 1;
    const rosterValues = profile.roster
      .map(
        (player) =>
          leagueContext.playerRatings.get(String(player.id))?.value ||
          player.marketValue
      )
      .sort((left, right) => right - left);
    const coreValue = round(sum(rosterValues.slice(0, 5)), 1);

    return {
      ...profile,
      categoryRows,
      needs,
      strengths,
      projectedFinish,
      coreValue,
      outlookScore: clamp(
        Math.round(profile.strategyScore * 0.7 + mean(rosterValues) * 0.3),
        1,
        99
      ),
    };
  }

  function pointsForScore({
    category,
    teamId,
    score,
    overrides,
    context,
  }) {
    const entries = context.categoryEntries[category.id].map((entry) => ({
      teamId: entry.teamId,
      score:
        overrides && overrides.has(String(entry.teamId))
          ? overrides.get(String(entry.teamId))
          : entry.score,
    }));
    const target = entries.find(
      (entry) => String(entry.teamId) === String(teamId)
    );
    if (target) target.score = score;
    return rankDetails(entries, String(teamId), category).rotoPoints;
  }

  function categoryDelta({
    category,
    teamId,
    partnerTeamId,
    teamRoster,
    partnerRoster,
    teamAfter,
    partnerAfter,
    teamPriority,
    partnerPriority,
    context,
  }) {
    const useRawValues = context.rawCategoryModes[category.id];
    const aggregateMovement = (beforePlayers, afterPlayers) => {
      const before = aggregateCategory(beforePlayers, category, useRawValues);
      const after = aggregateCategory(afterPlayers, category, useRawValues);
      if (!useRawValues) {
        const beforeScore = Number.isFinite(before) ? before : 0;
        const afterScore = Number.isFinite(after) ? after : 0;
        return {
          before: beforeScore,
          after: afterScore,
          valueChange: null,
          normalized: afterScore - beforeScore,
        };
      }
      if (!Number.isFinite(before) || !Number.isFinite(after)) {
        return { before: null, after: null, valueChange: null, normalized: 0 };
      }
      const valueChange = after - before;
      const favorableValueChange =
        category.direction === "lower" ? -valueChange : valueChange;
      const range =
        useRawValues &&
        Number.isFinite(category.rangeMaximum) &&
        Number.isFinite(category.rangeMinimum)
          ? Math.max(0.0001, category.rangeMaximum - category.rangeMinimum)
          : 100;
      return {
        before,
        after,
        valueChange,
        normalized: useRawValues
          ? (favorableValueChange / range) * 100
          : favorableValueChange,
      };
    };
    const teamMovement = aggregateMovement(teamRoster, teamAfter);
    const partnerMovement = aggregateMovement(partnerRoster, partnerAfter);
    const overrides = new Map([
      [String(teamId), teamMovement.after],
      [String(partnerTeamId), partnerMovement.after],
    ]);
    const teamBeforePoints =
      context.profiles.get(String(teamId))?.categories[category.id]?.rotoPoints || 0;
    const partnerBeforePoints =
      context.profiles.get(String(partnerTeamId))?.categories[category.id]
        ?.rotoPoints || 0;
    const teamAfterPoints = Number.isFinite(teamMovement.after)
      ? pointsForScore({
          category,
          teamId,
          score: teamMovement.after,
          overrides,
          context,
        })
      : teamBeforePoints;
    const partnerAfterPoints = Number.isFinite(partnerMovement.after)
      ? pointsForScore({
          category,
          teamId: partnerTeamId,
          score: partnerMovement.after,
          overrides,
          context,
        })
      : partnerBeforePoints;
    const pointDelta = teamAfterPoints - teamBeforePoints;
    const partnerPointDelta = partnerAfterPoints - partnerBeforePoints;
    const raw = teamMovement.normalized;
    const partnerRaw = partnerMovement.normalized;
    const teamWeighted =
      (pointDelta * 2.8 + raw / 25) * Math.max(0, teamPriority);
    const partnerWeighted =
      (partnerPointDelta * 2.8 + partnerRaw / 25) *
      Math.max(0, partnerPriority);

    return {
      id: category.id,
      label: category.label,
      name: category.name,
      group: category.group,
      raw,
      partnerRaw,
      valueChange: teamMovement.valueChange,
      direction: category.direction || "higher",
      mode: useRawValues ? "raw" : "scores",
      display: round(useRawValues ? raw : raw / 10, 1),
      pointDelta: round(pointDelta, 1),
      partnerPointDelta: round(partnerPointDelta, 1),
      teamPriority,
      partnerPriority,
      teamWeighted,
      partnerWeighted,
      punted: teamPriority === 0,
      partnerPunted: partnerPriority === 0,
    };
  }

  function getGrade(score) {
    if (score >= 90) return { letter: "A", label: "Strong move", tone: "great" };
    if (score >= 82) return { letter: "B+", label: "Clear upgrade", tone: "good" };
    if (score >= 74) return { letter: "B", label: "Useful move", tone: "good" };
    if (score >= 66) {
      return { letter: "C+", label: "Worth discussing", tone: "neutral" };
    }
    if (score >= 56) return { letter: "C", label: "Mostly even", tone: "neutral" };
    if (score >= 44) return { letter: "D", label: "Poor fit", tone: "weak" };
    return { letter: "F", label: "Do not offer", tone: "bad" };
  }

  function logisticScore(value) {
    return clamp(Math.round(100 / (1 + Math.exp(-value))), 0, 99);
  }

  function evaluateTrade({
    teamId,
    partnerTeamId,
    sendingIds,
    receivingIds,
    players,
    teams,
    categories,
    teamStrategies = {},
    context,
  }) {
    const leagueContext = ensureContext({
      players,
      teams,
      categories,
      teamStrategies,
      context,
    });
    const teamKey = String(teamId);
    const partnerKey = String(partnerTeamId);
    const teamProfile = leagueContext.profiles.get(teamKey);
    const partnerProfile = leagueContext.profiles.get(partnerKey);
    if (!teamProfile || !partnerProfile || teamKey === partnerKey) {
      return { valid: false, reason: "Choose two different teams in this league." };
    }

    const uniqueSendingIds = [...new Set((sendingIds || []).map(String))];
    const uniqueReceivingIds = [...new Set((receivingIds || []).map(String))];
    if (uniqueSendingIds.length === 0 || uniqueReceivingIds.length === 0) {
      return { valid: false, reason: "Add at least one player to each side." };
    }
    if (
      uniqueSendingIds.length !== (sendingIds || []).length ||
      uniqueReceivingIds.length !== (receivingIds || []).length
    ) {
      return { valid: false, reason: "A player can appear only once in a trade." };
    }

    const byId = new Map(players.map((player) => [String(player.id), player]));
    const sending = uniqueSendingIds.map((id) => byId.get(id));
    const receiving = uniqueReceivingIds.map((id) => byId.get(id));
    if (sending.some((player) => !player) || receiving.some((player) => !player)) {
      return { valid: false, reason: "One or more selected players no longer exist." };
    }
    if (
      sending.some((player) => String(player.ownerTeamId) !== teamKey) ||
      receiving.some((player) => String(player.ownerTeamId) !== partnerKey)
    ) {
      return {
        valid: false,
        reason: "Each selected player must belong to the team sending them.",
      };
    }

    const sentIds = new Set(sending.map((player) => String(player.id)));
    const receivedIds = new Set(receiving.map((player) => String(player.id)));
    const teamAfter = [
      ...teamProfile.roster.filter(
        (player) => !sentIds.has(String(player.id))
      ),
      ...receiving,
    ];
    const partnerAfter = [
      ...partnerProfile.roster.filter(
        (player) => !receivedIds.has(String(player.id))
      ),
      ...sending,
    ];
    const globalValue = (player) =>
      leagueContext.playerRatings.get(String(player.id))?.value ??
      player.marketValue;
    const teamValue = (player) =>
      contextualPlayerValue(player, teamProfile, leagueContext);
    const partnerValue = (player) =>
      contextualPlayerValue(player, partnerProfile, leagueContext);
    const valueOut = bundleValue(sending, globalValue);
    const valueIn = bundleValue(receiving, globalValue);
    const valueDelta = round(valueIn - valueOut, 1);
    const comparisonValue = Math.max((valueIn + valueOut) / 2, 1);
    const valueGapRatio = Math.abs(valueDelta) / comparisonValue;
    const fairness = clamp(Math.round(100 - valueGapRatio * 125), 0, 100);
    const teamValueDelta = round(
      bundleValue(receiving, teamValue) - bundleValue(sending, teamValue),
      1
    );
    const partnerValueDelta = round(
      bundleValue(sending, partnerValue) -
        bundleValue(receiving, partnerValue),
      1
    );

    const deltas = categories.map((category) =>
      categoryDelta({
        category,
        teamId: teamKey,
        partnerTeamId: partnerKey,
        teamRoster: teamProfile.roster,
        partnerRoster: partnerProfile.roster,
        teamAfter,
        partnerAfter,
        teamPriority: teamProfile.categories[category.id]?.priority || 0,
        partnerPriority:
          partnerProfile.categories[category.id]?.priority || 0,
        context: leagueContext,
      })
    );
    const teamNeedGain = sum(deltas.map((delta) => delta.teamWeighted));
    const partnerNeedGain = sum(deltas.map((delta) => delta.partnerWeighted));
    const rotoPointGain = sum(deltas.map((delta) => delta.pointDelta));
    const partnerRotoPointGain = sum(
      deltas.map((delta) => delta.partnerPointDelta)
    );
    const rosterSizePenalty = Math.abs(sending.length - receiving.length) * 2.5;
    const teamCoverage = rosterCoverage(teamProfile.roster, teamAfter);
    const partnerCoverage = rosterCoverage(
      partnerProfile.roster,
      partnerAfter
    );
    const incomingTrend = mean(receiving.map((player) => player.trend || 0));
    const outgoingTrend = mean(sending.map((player) => player.trend || 0));
    const trendDelta = incomingTrend - outgoingTrend;
    const partnerGivesStar =
      Math.max(...receiving.map(globalValue)) >= 88 &&
      sending.length > receiving.length;
    const starPremiumPenalty = partnerGivesStar
      ? clamp(7 - Math.max(0, partnerValueDelta) * 0.35, 0, 7)
      : 0;
    const confidence = mean(
      [...sending, ...receiving].map(
        (player) =>
          leagueContext.playerRatings.get(String(player.id))?.confidence || 0.5
      )
    );

    const teamScore = clamp(
      Math.round(
        55 +
          teamNeedGain * 3.3 +
          teamValueDelta * 0.7 +
          rotoPointGain * 2 -
          rosterSizePenalty +
          trendDelta * 0.2 -
          teamCoverage.penalty
      ),
      0,
      99
    );
    const partnerFitScore = clamp(
      Math.round(
        55 +
          partnerNeedGain * 3.3 +
          partnerValueDelta * 0.72 +
          partnerRotoPointGain * 2 -
          rosterSizePenalty -
          starPremiumPenalty -
          partnerCoverage.penalty
      ),
      0,
      99
    );
    const partnerDecision =
      -0.2 +
      partnerNeedGain * 0.28 +
      partnerValueDelta * 0.075 +
      (fairness - 70) * 0.018 +
      partnerRotoPointGain * 0.22 -
      rosterSizePenalty * 0.06 -
      starPremiumPenalty * 0.1 -
      partnerCoverage.penalty * 0.15;
    const acceptance = Math.min(
      logisticScore(partnerDecision),
      Math.max(0, 100 - partnerCoverage.penalty * 4)
    );
    const confidencePenalty = (1 - confidence) * 8;
    const score = clamp(
      Math.round(
        teamScore * 0.56 +
          acceptance * 0.32 +
          fairness * 0.12 -
          confidencePenalty
      ),
      0,
      99
    );
    const gains = deltas
      .filter((delta) => delta.raw > 0 && !delta.punted)
      .sort(
        (left, right) =>
          right.teamWeighted - left.teamWeighted || right.raw - left.raw
      );
    const losses = deltas
      .filter((delta) => delta.raw < 0 && !delta.punted)
      .sort(
        (left, right) =>
          left.teamWeighted - right.teamWeighted || left.raw - right.raw
      );
    const puntEffects = deltas.filter(
      (delta) => delta.punted && Math.abs(delta.raw) > 0
    );
    const realistic =
      fairness >= 55 &&
      acceptance >= 57 &&
      partnerValueDelta >= -8 &&
      partnerNeedGain >= -2.25 &&
      partnerCoverage.penalty < 10 &&
      teamScore >= 48;

    return {
      valid: true,
      sending,
      receiving,
      valueOut,
      valueIn,
      valueDelta,
      listedValueOut: sum(sending.map((player) => player.marketValue)),
      listedValueIn: sum(receiving.map((player) => player.marketValue)),
      teamValueDelta,
      partnerValueDelta,
      fairness,
      teamScore,
      partnerFitScore,
      acceptance,
      score,
      grade: getGrade(score),
      deltas,
      gains,
      losses,
      puntEffects,
      teamNeedGain,
      partnerNeedGain,
      rotoPointGain: round(rotoPointGain, 1),
      partnerRotoPointGain: round(partnerRotoPointGain, 1),
      trendDelta: round(trendDelta, 1),
      dataConfidence: Math.round(confidence * 100),
      rosterFitPenalty: teamCoverage.penalty,
      partnerRosterFitPenalty: partnerCoverage.penalty,
      missingPositions: teamCoverage.missing,
      partnerMissingPositions: partnerCoverage.missing,
      realistic,
      mutualBenefit:
        teamNeedGain + teamValueDelta * 0.1 > -1 &&
        partnerNeedGain + partnerValueDelta * 0.1 > -1,
    };
  }

  function playerNames(players) {
    return players.map((player) => player.name).join(" + ");
  }

  function categoryNames(deltas) {
    return deltas.map((delta) => delta.label).join(" and ");
  }

  function explainTrade(result, teamProfile, partnerProfile) {
    const gainDeltas = result.gains
      .filter(
        (delta) =>
          delta.pointDelta > 0 || delta.teamWeighted > 0.35 || delta.raw > 3
      )
      .slice(0, 2);
    const losses = result.losses
      .filter(
        (delta) =>
          delta.pointDelta < 0 || delta.teamWeighted < -0.35 || delta.raw < -3
      )
      .slice(0, 1);
    const partnerGains = [...result.deltas]
      .filter(
        (delta) =>
          !delta.partnerPunted &&
          (delta.partnerPointDelta > 0 ||
            delta.partnerWeighted > 0.35 ||
            delta.partnerRaw > 3)
      )
      .sort(
        (left, right) =>
          right.partnerWeighted - left.partnerWeighted ||
          right.partnerRaw - left.partnerRaw
      )
      .slice(0, 2);
    let reason = "The model sees similar value with a better category fit.";
    if (gainDeltas.length > 0) {
      const pointText =
        result.rotoPointGain > 0
          ? ` and projects ${round(result.rotoPointGain, 1)} standings point${
              result.rotoPointGain === 1 ? "" : "s"
            }`
          : "";
      reason = `Adds ${categoryNames(gainDeltas)}${pointText}.`;
    }
    let partnerReason = `${partnerProfile.team.name} receives comparable model value.`;
    if (result.partnerRosterFitPenalty >= 8) {
      partnerReason = `${partnerProfile.team.name} would need to replace ${
        result.partnerMissingPositions[0]?.position || "a lineup slot"
      }, which lowers its interest.`;
    } else if (partnerGains.length > 0) {
      const partnerPointText =
        result.partnerRotoPointGain > 0
          ? ` with ${round(result.partnerRotoPointGain, 1)} projected standings point${
              result.partnerRotoPointGain === 1 ? "" : "s"
            }`
          : "";
      partnerReason = `${partnerProfile.team.name} adds ${categoryNames(
        partnerGains
      )}${partnerPointText}.`;
    } else if (result.partnerValueDelta > 3) {
      partnerReason = `${partnerProfile.team.name} gains ${round(
        result.partnerValueDelta,
        1
      )} points of roster-specific value.`;
    }
    let risk = "No major loss in a category you are competing in.";
    if (result.rosterFitPenalty >= 8) {
      risk = `The deal leaves your ${
        result.missingPositions[0]?.position || "lineup"
      } slot uncovered.`;
    } else if (losses.length > 0) {
      risk = `You give back some ${categoryNames(losses)} production.`;
    } else if (result.valueDelta < -5) {
      risk = "You pay a premium in the evidence-based player values.";
    } else if (result.receiving.some((player) => statusAdjustment(player.status) < 0)) {
      risk = "The incoming side carries a current availability flag.";
    }
    if (result.puntEffects.some((delta) => delta.raw < 0)) {
      const punted = result.puntEffects
        .filter((delta) => delta.raw < 0)
        .map((delta) => delta.label);
      risk += ` The model ignores the loss in punted ${punted.join(" and ")}.`;
    }
    return { reason, partnerReason, risk };
  }

  function opportunityKey(partnerTeamId, sending, receiving) {
    return [
      partnerTeamId,
      sending.map((player) => player.id).sort().join("+"),
      receiving.map((player) => player.id).sort().join("+"),
    ].join(":");
  }

  function diversifyOpportunities(candidates, limit) {
    const sorted = [...candidates].sort(
      (left, right) =>
        right.result.score - left.result.score ||
        right.result.acceptance - left.result.acceptance ||
        right.result.fairness - left.result.fairness
    );
    const groupsByPartner = new Map();
    sorted.forEach((candidate) => {
      const group = groupsByPartner.get(String(candidate.partnerTeam.id)) || [];
      group.push(candidate);
      groupsByPartner.set(String(candidate.partnerTeam.id), group);
    });
    const groups = [...groupsByPartner.values()].sort(
      (left, right) => right[0].result.score - left[0].result.score
    );
    const selected = [];
    const selectedIds = new Set();
    const incomingCounts = new Map();
    const outgoingCounts = new Map();

    while (selected.length < limit) {
      let addedThisRound = false;
      groups.forEach((group) => {
        if (selected.length >= limit) return;
        while (group.length > 0) {
          const candidate = group.shift();
          const incomingKey = candidate.receiving
            .map((player) => player.id)
            .sort()
            .join("+");
          const outgoingKey = candidate.sending
            .map((player) => player.id)
            .sort()
            .join("+");
          if (
            (incomingCounts.get(incomingKey) || 0) >= 2 ||
            (outgoingCounts.get(outgoingKey) || 0) >= 3
          ) {
            continue;
          }
          selected.push(candidate);
          selectedIds.add(candidate.id);
          incomingCounts.set(incomingKey, (incomingCounts.get(incomingKey) || 0) + 1);
          outgoingCounts.set(outgoingKey, (outgoingCounts.get(outgoingKey) || 0) + 1);
          addedThisRound = true;
          break;
        }
      });
      if (!addedThisRound) break;
    }
    if (selected.length < limit) {
      sorted.forEach((candidate) => {
        if (selected.length < limit && !selectedIds.has(candidate.id)) {
          selected.push(candidate);
          selectedIds.add(candidate.id);
        }
      });
    }
    return selected.slice(0, limit);
  }

  function combinations(players, size) {
    const result = [];
    for (let left = 0; left < players.length; left += 1) {
      for (let right = left + 1; right < players.length; right += 1) {
        if (size === 2) result.push([players[left], players[right]]);
      }
    }
    return result;
  }

  function candidateBundles(players, context, includePairs) {
    const singles = players.map((player) => [player]);
    if (!includePairs) return singles;
    const pairPool = [...players]
      .sort(
        (left, right) =>
          (context.playerRatings.get(String(right.id))?.value || 0) -
          (context.playerRatings.get(String(left.id))?.value || 0)
      )
      .slice(0, 8);
    return [...singles, ...combinations(pairPool, 2)];
  }

  function findTradeOpportunities({
    teamId,
    players,
    teams,
    categories,
    teamStrategies = {},
    strategy = "balanced",
    position = "ALL",
    category = "ALL",
    realisticOnly = true,
    includePackages = true,
    limit = 24,
  }) {
    const context = computeLeagueContext({
      players,
      teams,
      categories,
      teamStrategies,
    });
    const teamProfile = context.profiles.get(String(teamId));
    if (!teamProfile) return [];
    const ownPlayers = playersForTeam(players, teamId);
    const candidates = [];
    const globalValue = (player) =>
      context.playerRatings.get(String(player.id))?.value || player.marketValue;

    teams
      .filter((team) => String(team.id) !== String(teamId))
      .forEach((partnerTeam) => {
        const partnerPlayers = playersForTeam(players, partnerTeam.id);
        const partnerProfile = context.profiles.get(String(partnerTeam.id));
        const outgoingBundles = candidateBundles(
          ownPlayers,
          context,
          includePackages
        );
        const incomingBundles = candidateBundles(
          partnerPlayers,
          context,
          includePackages
        );
        outgoingBundles.forEach((sending) => {
          incomingBundles.forEach((receiving) => {
            if (sending.length > 1 && receiving.length > 1) return;
            if (
              position !== "ALL" &&
              !receiving.some((player) =>
                (player.positions || []).includes(position)
              )
            ) {
              return;
            }
            const valueOut = bundleValue(sending, globalValue);
            const valueIn = bundleValue(receiving, globalValue);
            const gapRatio =
              Math.abs(valueIn - valueOut) / Math.max((valueIn + valueOut) / 2, 1);
            if (gapRatio > (sending.length === receiving.length ? 0.32 : 0.27)) {
              return;
            }
            const result = evaluateTrade({
              teamId,
              partnerTeamId: partnerTeam.id,
              sendingIds: sending.map((player) => player.id),
              receivingIds: receiving.map((player) => player.id),
              players,
              teams,
              categories,
              teamStrategies,
              context,
            });
            if (!result.valid) return;
            if (
              category !== "ALL" &&
              !result.deltas.some(
                (delta) =>
                  delta.id === category &&
                  delta.raw > 0 &&
                  delta.teamPriority > 0
              )
            ) {
              return;
            }

            let strategyAdjustment = 0;
            if (strategy === "upside") {
              strategyAdjustment = clamp(result.trendDelta * 1.25, -8, 8);
            } else if (strategy === "win-now") {
              strategyAdjustment = receiving.some(
                (player) => statusAdjustment(player.status) < 0
              )
                ? -8
                : 3;
            } else if (strategy === "category") {
              strategyAdjustment = clamp(result.teamNeedGain * 1.2, -8, 10);
            }
            const adjustedScore = clamp(
              Math.round(result.score + strategyAdjustment),
              0,
              99
            );
            const adjustedResult = {
              ...result,
              score: adjustedScore,
              grade: getGrade(adjustedScore),
            };
            if (realisticOnly && !adjustedResult.realistic) return;
            if (adjustedResult.score < 49) return;
            candidates.push({
              id: opportunityKey(partnerTeam.id, sending, receiving),
              partnerTeam,
              sending,
              receiving,
              result: adjustedResult,
              ...explainTrade(adjustedResult, teamProfile, partnerProfile),
            });
          });
        });
      });

    const deduplicated = new Map();
    candidates.forEach((candidate) => {
      const previous = deduplicated.get(candidate.id);
      if (!previous || candidate.result.score > previous.result.score) {
        deduplicated.set(candidate.id, candidate);
      }
    });
    return diversifyOpportunities([...deduplicated.values()], limit);
  }

  function describeValueDelta(valueDelta) {
    if (valueDelta >= 8) return "You gain clear model value";
    if (valueDelta >= 3) return "You gain slight model value";
    if (valueDelta <= -8) return "You pay a clear model premium";
    if (valueDelta <= -3) return "You pay a small model premium";
    return "Model values are even";
  }

  return {
    clamp,
    computeLeagueContext,
    describeValueDelta,
    evaluateTrade,
    findTradeOpportunities,
    getGrade,
    getTeamAnalysis,
    playerNames,
    playersForTeam,
    ratePlayer,
    ratePlayerForTeam,
  };
});
