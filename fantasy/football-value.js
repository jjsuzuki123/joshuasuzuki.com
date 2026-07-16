(function initFootballValue(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.FootballValue = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFootballValue() {
  "use strict";

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function round(value, digits) {
    if (digits === undefined) digits = 1;
    if (!Number.isFinite(value)) return null;
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  function normalizeSettings(settings) {
    settings = settings || {};
    const pprRaw = Number(settings.ppr);
    const ppr = pprRaw === 0 || pprRaw === 0.5 || pprRaw === 1 ? pprRaw : 1;
    return {
      leagueSize: clamp(Math.round(Number(settings.leagueSize) || 12), 8, 16),
      ppr: ppr,
      superflex: Boolean(settings.superflex),
      tep: Boolean(settings.tep),
    };
  }

  function projectedPoints(player, settings) {
    const p = (player && player.projections) || {};
    if (player.position === "K" || player.position === "DST") {
      return clamp((Number(player.marketValue) || 30) * 2.4, 40, 160);
    }
    const tepBonus = settings.tep && player.position === "TE" ? 0.5 : 0;
    const receptionPoints = (Number(p.rec) || 0) * (settings.ppr + tepBonus);
    return (
      (Number(p.passYds) || 0) * 0.04 +
      (Number(p.passTd) || 0) * 4 +
      (Number(p.interceptions) || 0) * -2 +
      (Number(p.rushYds) || 0) * 0.1 +
      (Number(p.rushTd) || 0) * 6 +
      receptionPoints +
      (Number(p.recYds) || 0) * 0.1 +
      (Number(p.recTd) || 0) * 6 +
      (Number(p.fumblesLost) || 0) * -2
    );
  }

  function replacementRank(position, settings) {
    const n = settings.leagueSize;
    if (position === "QB") return settings.superflex ? n * 2 : n;
    if (position === "RB") return n * 2 + Math.floor(n * 0.5);
    if (position === "WR") return n * 3 + Math.floor(n * 0.5);
    if (position === "TE") {
      return settings.tep ? n : Math.max(8, Math.floor(n * 0.85));
    }
    if (position === "K" || position === "DST") return n;
    return n;
  }

  function ratePlayers(players, settingsInput) {
    const settings = normalizeSettings(settingsInput);
    const withPoints = (players || []).map(function (player) {
      return { player: player, points: projectedPoints(player, settings) };
    });

    const byPosition = {};
    withPoints.forEach(function (entry) {
      const position = entry.player.position;
      if (!byPosition[position]) byPosition[position] = [];
      byPosition[position].push(entry);
    });
    Object.keys(byPosition).forEach(function (position) {
      byPosition[position].sort(function (left, right) {
        return right.points - left.points;
      });
    });

    const replacementByPosition = {};
    Object.keys(byPosition).forEach(function (position) {
      const list = byPosition[position];
      const index = Math.min(
        list.length - 1,
        Math.max(0, replacementRank(position, settings) - 1)
      );
      replacementByPosition[position] = list[index] ? list[index].points : 0;
    });

    const rated = withPoints.map(function (entry) {
      const player = entry.player;
      const points = entry.points;
      const replacement = replacementByPosition[player.position] || 0;
      const vorp = points - replacement;
      const topPoints =
        byPosition[player.position] && byPosition[player.position][0]
          ? byPosition[player.position][0].points
          : points;
      const span = Math.max(35, topPoints - replacement + 20);
      let productionScore = clamp(40 + (vorp / span) * 55, 1, 99);

      if (settings.superflex && player.position === "QB") {
        productionScore = clamp(productionScore + 10, 1, 99);
      } else if (player.position === "QB") {
        // 1QB leagues: dampen raw points so elite skill players outrank streaming QBs.
        productionScore = clamp(productionScore - 12, 1, 99);
      }
      if (settings.tep && player.position === "TE") {
        productionScore = clamp(productionScore + 4, 1, 99);
      }

      const market = clamp(Number(player.marketValue) || 50, 1, 99);
      const skill = clamp(
        Number(player.quantitative && player.quantitative.overall) || market,
        1,
        99
      );
      const qualitative = clamp(
        (Number(player.qualitative && player.qualitative.impact) || 0) * 7,
        -8,
        8
      );
      const base =
        productionScore * 0.45 + market * 0.25 + skill * 0.2 + productionScore * 0.1;
      const value = clamp(base + qualitative, 1, 99);

      return {
        id: player.id,
        player: player,
        projectedPoints: round(points, 1),
        vorp: round(vorp, 1),
        value: round(value, 1),
        components: {
          production: round(productionScore, 1),
          market: round(market, 1),
          skill: round(skill, 1),
          qualitative: round(qualitative, 1),
        },
      };
    });

    rated.sort(function (left, right) {
      return right.value - left.value;
    });

    return {
      settings: settings,
      replacementByPosition: replacementByPosition,
      players: rated,
    };
  }

  function valueMap(ratedBundle) {
    const map = {};
    (ratedBundle.players || []).forEach(function (entry) {
      map[entry.id] = entry.value;
    });
    return map;
  }

  function marginalSlotCost(ratedBundle) {
    const values = Object.values(ratedBundle.replacementByPosition || {});
    if (!values.length) return 14;
    const avg =
      values.reduce(function (sum, item) {
        return sum + item;
      }, 0) / values.length;
    return clamp(11 + avg / 45, 10, 22);
  }

  return {
    normalizeSettings: normalizeSettings,
    projectedPoints: projectedPoints,
    ratePlayers: ratePlayers,
    valueMap: valueMap,
    marginalSlotCost: marginalSlotCost,
    getPlayerRating: function (ratedBundle, playerId) {
      return (
        (ratedBundle.players || []).find(function (entry) {
          return entry.id === playerId;
        }) || null
      );
    },
  };
});
