(function initTradeEngine(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.TradeEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTradeEngine() {
  "use strict";

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function mean(values) {
    const finiteValues = values.filter(Number.isFinite);
    if (finiteValues.length === 0) return 0;
    return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
  }

  function sum(values) {
    return values.filter(Number.isFinite).reduce((total, value) => total + value, 0);
  }

  function scoreFor(player, categoryId) {
    if (!player || !player.scores) return null;
    const score = player.scores[categoryId];
    return Number.isFinite(score) ? score : null;
  }

  function categoryValueFor(player, categoryId) {
    const value = player?.categoryValues?.[categoryId];
    return Number.isFinite(value) ? value : null;
  }

  function categoryUsesRawValues(players, categoryId) {
    return players.some((player) =>
      Number.isFinite(categoryValueFor(player, categoryId))
    );
  }

  function weightedRateScore(players, categoryId) {
    const scoredPlayers = players.filter((player) =>
      Number.isFinite(scoreFor(player, categoryId))
    );
    if (scoredPlayers.length === 0) return 0;

    const totalWeight = sum(
      scoredPlayers.map((player) =>
        Number.isFinite(player.rateWeight) && player.rateWeight > 0
          ? player.rateWeight
          : 1
      )
    );
    return (
      sum(
        scoredPlayers.map((player) => {
          const weight =
            Number.isFinite(player.rateWeight) && player.rateWeight > 0
              ? player.rateWeight
              : 1;
          return scoreFor(player, categoryId) * weight;
        })
      ) / totalWeight
    );
  }

  function weightedRateValue(players, categoryId) {
    const valuedPlayers = players.filter((player) =>
      Number.isFinite(categoryValueFor(player, categoryId))
    );
    if (valuedPlayers.length === 0) return null;

    const weightFor = (player) => {
      const categoryWeight = player.categoryWeights?.[categoryId];
      if (Number.isFinite(categoryWeight) && categoryWeight > 0) {
        return categoryWeight;
      }
      return Number.isFinite(player.rateWeight) && player.rateWeight > 0
        ? player.rateWeight
        : 1;
    };
    const totalWeight = sum(valuedPlayers.map(weightFor));
    return (
      sum(
        valuedPlayers.map(
          (player) =>
            categoryValueFor(player, categoryId) * weightFor(player)
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
    return sum(players.map((player) => scoreFor(player, category.id)));
  }

  function playersForTeam(players, teamId) {
    return players.filter((player) => player.ownerTeamId === teamId);
  }

  function computeLeagueContext({ players, teams, categories }) {
    const rawProfiles = new Map();
    const rawCategoryModes = {};
    categories.forEach((category) => {
      rawCategoryModes[category.id] = categoryUsesRawValues(
        players,
        category.id
      );
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

      rawProfiles.set(team.id, {
        roster,
        scores,
        totalValue: sum(roster.map((player) => player.marketValue)),
      });
    });

    const categoryRanks = {};
    categories.forEach((category) => {
      categoryRanks[category.id] = teams
        .map((team) => ({
          teamId: team.id,
          score: rawProfiles.get(team.id).scores[category.id],
        }))
        .sort((left, right) => {
          if (
            !Number.isFinite(left.score) &&
            !Number.isFinite(right.score)
          ) {
            return 0;
          }
          if (!Number.isFinite(left.score)) return 1;
          if (!Number.isFinite(right.score)) return -1;
          if (
            rawCategoryModes[category.id] &&
            category.direction === "lower"
          ) {
            return left.score - right.score;
          }
          return right.score - left.score;
        });
    });

    const profiles = new Map();
    teams.forEach((team) => {
      const raw = rawProfiles.get(team.id);
      const categoryProfile = {};

      categories.forEach((category) => {
        const ordered = categoryRanks[category.id];
        const teamScore = raw.scores[category.id];
        const betterCount = ordered.filter(
          (entry) => {
            if (!Number.isFinite(entry.score)) return false;
            if (!Number.isFinite(teamScore)) return true;
            return rawCategoryModes[category.id] &&
              category.direction === "lower"
              ? entry.score < teamScore
              : entry.score > teamScore;
          }
        ).length;
        const tieCount = ordered.filter(
          (entry) =>
            Number.isFinite(teamScore)
              ? entry.score === teamScore
              : !Number.isFinite(entry.score)
        ).length;
        const rank = betterCount + 1;
        const percentile =
          teams.length <= 1
            ? 100
            : Math.round(
                (1 -
                  (betterCount + (tieCount - 1) / 2) / (teams.length - 1)) *
                  100
              );

        categoryProfile[category.id] = {
          score: Number.isFinite(raw.scores[category.id])
            ? Math.round(raw.scores[category.id])
            : null,
          rank,
          percentile,
          need: 100 - percentile,
        };
      });

      profiles.set(team.id, {
        team,
        roster: raw.roster,
        totalValue: raw.totalValue,
        categories: categoryProfile,
        overallScore: Math.round(
          mean(Object.values(categoryProfile).map((category) => category.percentile))
        ),
      });
    });

    return { profiles, teams, categories, rawCategoryModes };
  }

  function getTeamAnalysis({ teamId, players, teams, categories, context }) {
    const leagueContext =
      context || computeLeagueContext({ players, teams, categories });
    const profile = leagueContext.profiles.get(teamId);
    if (!profile) return null;

    const categoryRows = categories.map((category) => ({
      ...category,
      ...profile.categories[category.id],
    }));
    const needs = [...categoryRows]
      .sort((left, right) => right.need - left.need || left.score - right.score)
      .slice(0, 4);
    const strengths = [...categoryRows]
      .sort(
        (left, right) =>
          right.percentile - left.percentile || right.score - left.score
      )
      .slice(0, 4);

    const projectedOrder = [...leagueContext.profiles.values()].sort(
      (left, right) =>
        right.overallScore - left.overallScore || right.totalValue - left.totalValue
    );
    const projectedFinish =
      projectedOrder.findIndex((entry) => entry.team.id === teamId) + 1;
    const rosterValues = profile.roster
      .map((player) => player.marketValue)
      .sort((left, right) => right - left);
    const coreValue = sum(rosterValues.slice(0, 5));

    return {
      ...profile,
      categoryRows,
      needs,
      strengths,
      projectedFinish,
      coreValue,
      outlookScore: clamp(
        Math.round(profile.overallScore * 0.65 + mean(rosterValues) * 0.35),
        1,
        99
      ),
    };
  }

  function categoryDelta({
    category,
    sending,
    receiving,
    teamRoster,
    partnerRoster,
    teamNeed,
    partnerNeed,
  }) {
    const sentIds = new Set(sending.map((player) => String(player.id)));
    const receivedIds = new Set(receiving.map((player) => String(player.id)));
    const teamAfter = [
      ...teamRoster.filter((player) => !sentIds.has(String(player.id))),
      ...receiving,
    ];
    const partnerAfter = [
      ...partnerRoster.filter(
        (player) => !receivedIds.has(String(player.id))
      ),
      ...sending,
    ];
    const useRawValues = categoryUsesRawValues(
      [...teamRoster, ...partnerRoster],
      category.id
    );
    const valueChange = (beforePlayers, afterPlayers) => {
      const before = aggregateCategory(
        beforePlayers,
        category,
        useRawValues
      );
      const after = aggregateCategory(
        afterPlayers,
        category,
        useRawValues
      );
      return Number.isFinite(before) && Number.isFinite(after)
        ? after - before
        : 0;
    };
    const teamValueChange = valueChange(teamRoster, teamAfter);
    const partnerValueChange = valueChange(partnerRoster, partnerAfter);
    const favorableChange = (valueChange) =>
      useRawValues && category.direction === "lower"
        ? -valueChange
        : valueChange;
    const range =
      useRawValues &&
      Number.isFinite(category.rangeMaximum) &&
      Number.isFinite(category.rangeMinimum)
        ? Math.max(0.0001, category.rangeMaximum - category.rangeMinimum)
        : 100;
    const normalize = (valueChange) =>
      useRawValues
        ? (favorableChange(valueChange) / range) * 100
        : favorableChange(valueChange);
    const raw = normalize(teamValueChange);
    const partnerRaw = normalize(partnerValueChange);
    const teamWeighted = (raw / 10) * (0.45 + teamNeed / 100);
    const partnerWeighted =
      (partnerRaw / 10) * (0.45 + partnerNeed / 100);

    return {
      id: category.id,
      label: category.label,
      name: category.name,
      group: category.group,
      raw,
      partnerRaw,
      valueChange: teamValueChange,
      direction: category.direction || "higher",
      display:
        Math.round((useRawValues ? raw : raw / 12) * 10) / 10,
      teamWeighted,
      partnerWeighted,
    };
  }

  function getGrade(score) {
    if (score >= 90) return { letter: "A", label: "Strong move", tone: "great" };
    if (score >= 82) return { letter: "B+", label: "Clear upgrade", tone: "good" };
    if (score >= 74) return { letter: "B", label: "Useful move", tone: "good" };
    if (score >= 66) return { letter: "C+", label: "Worth discussing", tone: "neutral" };
    if (score >= 56) return { letter: "C", label: "Mostly even", tone: "neutral" };
    if (score >= 44) return { letter: "D", label: "Poor fit", tone: "weak" };
    return { letter: "F", label: "Do not offer", tone: "bad" };
  }

  function evaluateTrade({
    teamId,
    partnerTeamId,
    sendingIds,
    receivingIds,
    players,
    teams,
    categories,
    context,
  }) {
    const leagueContext =
      context || computeLeagueContext({ players, teams, categories });
    const teamProfile = leagueContext.profiles.get(teamId);
    const partnerProfile = leagueContext.profiles.get(partnerTeamId);

    if (!teamProfile || !partnerProfile) {
      return {
        valid: false,
        reason: "Choose two teams in this league.",
      };
    }

    const byId = new Map(players.map((player) => [String(player.id), player]));
    const sending = sendingIds
      .map((id) => byId.get(String(id)))
      .filter(Boolean);
    const receiving = receivingIds
      .map((id) => byId.get(String(id)))
      .filter(Boolean);

    if (sending.length === 0 || receiving.length === 0) {
      return {
        valid: false,
        reason: "Add at least one player to each side.",
      };
    }

    const valueOut = sum(sending.map((player) => player.marketValue));
    const valueIn = sum(receiving.map((player) => player.marketValue));
    const valueDelta = valueIn - valueOut;
    const comparisonValue = Math.max(valueIn, valueOut, 1);
    const valueGapRatio = Math.abs(valueDelta) / comparisonValue;
    const fairness = clamp(Math.round(100 - valueGapRatio * 145), 0, 100);

    const deltas = categories.map((category) =>
      categoryDelta({
        category,
        sending,
        receiving,
        teamRoster: teamProfile.roster,
        partnerRoster: partnerProfile.roster,
        teamNeed: teamProfile.categories[category.id].need,
        partnerNeed: partnerProfile.categories[category.id].need,
      })
    );
    const teamNeedGain = sum(deltas.map((delta) => delta.teamWeighted));
    const partnerNeedGain = sum(deltas.map((delta) => delta.partnerWeighted));
    const rosterSizePenalty = Math.abs(sending.length - receiving.length) * 5;
    const incomingTrend = mean(receiving.map((player) => player.trend || 0));
    const outgoingTrend = mean(sending.map((player) => player.trend || 0));
    const trendDelta = incomingTrend - outgoingTrend;

    const teamScore = clamp(
      Math.round(
        58 +
          teamNeedGain * 2.1 +
          valueDelta * 0.26 +
          trendDelta * 0.75 -
          rosterSizePenalty
      ),
      0,
      99
    );
    const partnerFitScore = clamp(
      Math.round(
        55 +
          partnerNeedGain * 2 +
          -valueDelta * 0.24 -
          rosterSizePenalty
      ),
      0,
      99
    );
    const acceptance = clamp(
      Math.round(fairness * 0.57 + partnerFitScore * 0.36 + 7 - rosterSizePenalty),
      0,
      99
    );
    const score = clamp(
      Math.round(teamScore * 0.5 + acceptance * 0.29 + fairness * 0.21),
      0,
      99
    );

    const sortedPositiveDeltas = deltas
      .filter((delta) => delta.raw > 0)
      .sort(
        (left, right) =>
          right.teamWeighted - left.teamWeighted || right.raw - left.raw
      );
    const sortedNegativeDeltas = deltas
      .filter((delta) => delta.raw < 0)
      .sort(
        (left, right) =>
          left.teamWeighted - right.teamWeighted || left.raw - right.raw
      );

    return {
      valid: true,
      sending,
      receiving,
      valueOut,
      valueIn,
      valueDelta,
      fairness,
      teamScore,
      partnerFitScore,
      acceptance,
      score,
      grade: getGrade(score),
      deltas,
      gains: sortedPositiveDeltas,
      losses: sortedNegativeDeltas,
      teamNeedGain,
      partnerNeedGain,
      trendDelta,
      realistic: fairness >= 68 && acceptance >= 61,
    };
  }

  function playerNames(players) {
    return players.map((player) => player.name).join(" + ");
  }

  function explainTrade(result, teamProfile, partnerProfile) {
    const gainDeltas = result.gains
      .filter((delta) => delta.raw > 3)
      .slice(0, 2);
    const gains = gainDeltas.map((delta) => delta.label);
    const losses = result.losses
      .filter((delta) => delta.raw < -3)
      .slice(0, 1)
      .map((delta) => delta.label);
    const partnerGains = [...result.deltas]
      .filter((delta) => delta.partnerRaw > 3)
      .sort((left, right) => right.partnerWeighted - left.partnerWeighted)
      .slice(0, 2)
      .map((delta) => delta.label);

    let reason = "The values are close and the category mix is a better roster fit.";
    if (gains.length > 0) {
      const ranks = gainDeltas
        .map((delta) => teamProfile.categories[delta.id]?.rank)
        .filter(Boolean);
      const rankText = ranks.length > 0 ? `, where you rank ${ranks.join(" and ")}` : "";
      reason = `Adds ${gains.join(" and ")}${rankText}.`;
    }

    let partnerReason = "The other roster receives comparable market value.";
    if (partnerGains.length > 0) {
      partnerReason = `${partnerProfile.team.name} adds ${partnerGains.join(
        " and "
      )}, categories its roster can use.`;
    }

    let risk = "No major category loss in the current model.";
    if (losses.length > 0) {
      risk = `You give back some ${losses.join(" and ")} production.`;
    } else if (result.valueDelta < -5) {
      risk = "You give up more market value than you receive.";
    } else if (result.receiving.some((player) => player.status !== "Healthy")) {
      risk = "The incoming side carries a current health or role flag.";
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
      const group = groupsByPartner.get(candidate.partnerTeam.id) || [];
      group.push(candidate);
      groupsByPartner.set(candidate.partnerTeam.id, group);
    });
    const groups = [...groupsByPartner.values()].sort(
      (left, right) => right[0].result.score - left[0].result.score
    );
    const selected = [];
    const selectedIds = new Set();
    const incomingCounts = new Map();

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
          const incomingCount = incomingCounts.get(incomingKey) || 0;
          if (incomingCount >= 2) continue;

          selected.push(candidate);
          selectedIds.add(candidate.id);
          incomingCounts.set(incomingKey, incomingCount + 1);
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

  function findTradeOpportunities({
    teamId,
    players,
    teams,
    categories,
    strategy = "balanced",
    position = "ALL",
    category = "ALL",
    realisticOnly = true,
    limit = 24,
  }) {
    const context = computeLeagueContext({ players, teams, categories });
    const teamProfile = context.profiles.get(teamId);
    if (!teamProfile) return [];

    const ownPlayers = playersForTeam(players, teamId);
    const candidates = [];

    teams
      .filter((team) => team.id !== teamId)
      .forEach((partnerTeam) => {
        const partnerPlayers = playersForTeam(players, partnerTeam.id);
        const partnerProfile = context.profiles.get(partnerTeam.id);

        ownPlayers.forEach((outgoing) => {
          partnerPlayers.forEach((incoming) => {
            if (
              position !== "ALL" &&
              !incoming.positions.some((playerPosition) => playerPosition === position)
            ) {
              return;
            }
            if (
              category !== "ALL" &&
              (!Number.isFinite(scoreFor(incoming, category)) ||
                scoreFor(incoming, category) < 68)
            ) {
              return;
            }
            if (Math.abs(outgoing.marketValue - incoming.marketValue) > 18) return;

            const result = evaluateTrade({
              teamId,
              partnerTeamId: partnerTeam.id,
              sendingIds: [outgoing.id],
              receivingIds: [incoming.id],
              players,
              teams,
              categories,
              context,
            });
            if (!result.valid) return;

            let strategyAdjustment = 0;
            if (strategy === "upside") {
              strategyAdjustment = clamp(result.trendDelta * 1.8, -10, 10);
            } else if (strategy === "win-now") {
              strategyAdjustment =
                incoming.status === "Healthy" ? 3 : -8;
            } else if (strategy === "category") {
              strategyAdjustment = clamp(result.teamNeedGain, -8, 10);
            }

            const starAvailabilityPenalty =
              incoming.marketValue >= 95 && outgoing.marketValue < 92 ? 9 : 0;
            const adjustedScore = clamp(
              Math.round(result.score + strategyAdjustment - starAvailabilityPenalty),
              0,
              99
            );
            const adjustedResult = {
              ...result,
              score: adjustedScore,
              grade: getGrade(adjustedScore),
              acceptance: clamp(
                result.acceptance - starAvailabilityPenalty,
                0,
                99
              ),
            };
            adjustedResult.realistic =
              adjustedResult.fairness >= 68 && adjustedResult.acceptance >= 61;

            if (realisticOnly && !adjustedResult.realistic) return;
            if (adjustedResult.score < 52) return;

            candidates.push({
              id: opportunityKey(partnerTeam.id, [outgoing], [incoming]),
              partnerTeam,
              sending: [outgoing],
              receiving: [incoming],
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
    if (valueDelta >= 8) return "You gain clear market value";
    if (valueDelta >= 3) return "You gain slight market value";
    if (valueDelta <= -8) return "You pay a clear premium";
    if (valueDelta <= -3) return "You pay a small premium";
    return "Market values are even";
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
  };
});
