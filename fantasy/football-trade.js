(function initFootballTrade(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.FootballTrade = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFootballTrade() {
  "use strict";

  const BUNDLE_WEIGHTS = [1, 0.72, 0.52, 0.4, 0.34, 0.3];
  const CONSOLIDATION_FACTOR = 0.85;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function round(value, digits) {
    if (digits === undefined) digits = 1;
    if (!Number.isFinite(value)) return null;
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  function sum(values) {
    return values
      .filter(Number.isFinite)
      .reduce(function (total, value) {
        return total + value;
      }, 0);
  }

  function discountedBundle(values) {
    const sorted = values
      .filter(Number.isFinite)
      .sort(function (left, right) {
        return right - left;
      });
    return sum(
      sorted.map(function (value, index) {
        return value * (BUNDLE_WEIGHTS[index] || 0.28);
      })
    );
  }

function valuesFor(players, valueById) {
    return (players || [])
      .map(function (player) {
        const id = typeof player === "string" ? player : player.id;
        return Number(valueById[id]);
      })
      .filter(Number.isFinite);
  }

  function evaluateSide(receivedPlayers, sentPlayers, valueById, slotCost) {
    const receivedValues = valuesFor(receivedPlayers, valueById);
    const sentValues = valuesFor(sentPlayers, valueById);
    const slotDelta = receivedValues.length - sentValues.length;
    const rawTotal = sum(receivedValues);
    const bundle = discountedBundle(receivedValues);

    let slotAdjustment = 0;
    let slotLabel = "even";
    if (slotDelta > 0) {
      slotAdjustment = -slotDelta * slotCost;
      slotLabel = "roster-space tax";
    } else if (slotDelta < 0) {
      slotAdjustment = Math.abs(slotDelta) * slotCost * CONSOLIDATION_FACTOR;
      slotLabel = "consolidation premium";
    }

    return {
      count: receivedValues.length,
      sentCount: sentValues.length,
      slotDelta: slotDelta,
      raw: round(rawTotal, 1),
      bundle: round(bundle, 1),
      slotCost: round(slotCost, 1),
      slotAdjustment: round(slotAdjustment, 1),
      slotLabel: slotLabel,
      adjusted: round(Math.max(0, bundle + slotAdjustment), 1),
    };
  }

  function fairnessScore(sideAAdjusted, sideBAdjusted) {
    const maxValue = Math.max(sideAAdjusted, sideBAdjusted, 1);
    const gap = Math.abs(sideAAdjusted - sideBAdjusted);
    return clamp(round(100 - (gap / maxValue) * 100, 1), 0, 100);
  }

  function buildVerdict(sideA, sideB) {
    const gap = sideA.adjusted - sideB.adjusted;
    if (Math.abs(gap) < 3) {
      return {
        winner: "even",
        summary: "Trade is roughly even after roster-slot adjustments.",
      };
    }
    if (gap > 0) {
      return {
        winner: "a",
        summary:
          "Team One gets more adjusted value" +
          (sideA.slotDelta < 0
            ? " (consolidation helps)."
            : sideA.slotDelta > 0
              ? " even after roster-space tax."
              : "."),
      };
    }
    return {
      winner: "b",
      summary:
        "Team Two gets more adjusted value" +
        (sideB.slotDelta < 0
          ? " (consolidation helps)."
          : sideB.slotDelta > 0
            ? " even after roster-space tax."
            : "."),
    };
  }

  function buildNotes(sideA, sideB) {
    const notes = [];
    if (sideA.slotDelta !== 0) {
      notes.push(
        "Team One " +
          (sideA.slotDelta > 0
            ? "pays a roster-space tax for +" + sideA.slotDelta + " player(s)."
            : "earns a consolidation premium for freeing " +
              Math.abs(sideA.slotDelta) +
              " roster slot(s).")
      );
    }
    if (sideB.slotDelta !== 0) {
      notes.push(
        "Team Two " +
          (sideB.slotDelta > 0
            ? "pays a roster-space tax for +" + sideB.slotDelta + " player(s)."
            : "earns a consolidation premium for freeing " +
              Math.abs(sideB.slotDelta) +
              " roster slot(s).")
      );
    }
    if (!notes.length) {
      notes.push("Equal player counts — no roster-slot adjustment.");
    }
    return notes;
  }

  function evaluateTrade(options) {
    options = options || {};
    const valueById = options.valueById || {};
    const slotCost = Number.isFinite(options.slotCost) ? options.slotCost : 14;
    const sideAPlayers = options.sideA || [];
    const sideBPlayers = options.sideB || [];

    // Team One sends sideAPlayers and receives sideBPlayers.
    const sideA = evaluateSide(sideBPlayers, sideAPlayers, valueById, slotCost);
    const sideB = evaluateSide(sideAPlayers, sideBPlayers, valueById, slotCost);
    const result = buildVerdict(sideA, sideB);

    return {
      sideA: sideA,
      sideB: sideB,
      fairness: fairnessScore(sideA.adjusted, sideB.adjusted),
      winner: result.winner,
      summary: result.summary,
      notes: buildNotes(sideA, sideB),
    };
  }

  return {
    BUNDLE_WEIGHTS: BUNDLE_WEIGHTS,
    CONSOLIDATION_FACTOR: CONSOLIDATION_FACTOR,
    discountedBundle: discountedBundle,
    evaluateSide: evaluateSide,
    evaluateTrade: evaluateTrade,
  };
});
