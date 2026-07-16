(function initSourceClient(root, factory) {
  const api = factory(root.RosterLabConfig || {});

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.RosterLabSourceClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSourceClient(config) {
  "use strict";

  const SOURCE_ENDPOINT =
    typeof config.sourceEndpoint === "string"
      ? config.sourceEndpoint.trim()
      : "";
  const ACTIVE_ACCESS = new Set(["licensed", "official", "user-provided"]);
  const MAX_PLAYERS = 5000;
  const MAX_RESPONSE_BYTES = 2_000_000;
  const MAX_TEXT = 500;
  const DAY_IN_MILLISECONDS = 86_400_000;
  const INJURY_TYPES = new Set(["injury", "availability", "transaction"]);
  const INJURY_SEVERITIES = new Set([
    "healthy",
    "active",
    "day-to-day",
    "short-term",
    "medium-term",
    "long-term",
    "season-ending",
  ]);

  class SourceDataError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "SourceDataError";
      this.code = code;
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function sum(values) {
    return values.filter(Number.isFinite).reduce((total, value) => total + value, 0);
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

  function cleanText(value, fallback = "") {
    const text = String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return (text || fallback).slice(0, MAX_TEXT);
  }

  function validSourceId(value) {
    const id = String(value || "").trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_-]{0,49}$/.test(id) ? id : null;
  }

  function validDate(value) {
    if (value === null || value === undefined || value === "") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function validHttpsUrl(value) {
    const text = String(value || "").trim();
    return /^https:\/\//i.test(text) ? text.slice(0, 2048) : "";
  }

  function freshnessFor(value, maxAgeDays, now) {
    const date = validDate(value);
    if (!date) return 0;
    const age = Math.max(0, now.getTime() - date.getTime());
    const ageDays = age / 86_400_000;
    return clamp(1 - ageDays / maxAgeDays, 0, 1);
  }

  function normalizeSource(source, now) {
    const id = validSourceId(source?.id);
    const access = String(source?.access || "").toLowerCase();
    if (
      !id ||
      !ACTIVE_ACCESS.has(access) ||
      (id === "rotowire" && access !== "licensed")
    ) {
      return null;
    }
    const updatedAt = validDate(source.updatedAt)?.toISOString() || null;
    const kind = ["quantitative", "qualitative", "mixed"].includes(source.kind)
      ? source.kind
      : "mixed";
    const maxAgeDays = kind === "qualitative" ? 3 : 14;
    const freshness = freshnessFor(updatedAt, maxAgeDays, now);
    return {
      id,
      name: cleanText(source.name, id),
      url: /^https:\/\//i.test(String(source.url || "")) ? source.url : "",
      kind,
      access,
      coverage: cleanText(source.coverage, "Player evidence"),
      cadence: cleanText(source.cadence, "Provider refresh"),
      updatedAt,
      freshness,
      status: freshness > 0 ? "connected" : "stale",
    };
  }

  function normalizeScoreMap(scores, categoryIds) {
    if (!scores || typeof scores !== "object") return {};
    const result = {};
    categoryIds.forEach((categoryId) => {
      const value = Number(scores[categoryId]);
      if (Number.isFinite(value)) {
        result[categoryId] = clamp(value, 1, 100);
      }
    });
    return result;
  }

  function normalizeQuantitative(item, sources, categoryIds, now) {
    const sourceId = validSourceId(item?.sourceId);
    const source = sourceId ? sources.get(sourceId) : null;
    if (!source || !["quantitative", "mixed"].includes(source.kind)) return null;
    const asOf = validDate(item.asOf || source.updatedAt)?.toISOString();
    if (!asOf) return null;
    const freshness = Math.min(source.freshness, freshnessFor(asOf, 14, now));
    const confidence = clamp(
      Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0.65,
      0,
      1
    );
    const overall = Number(item.overall);
    const projection = Number(item.projection);
    const underlying = Number(item.underlying);
    const categoryScores = normalizeScoreMap(item.categoryScores, categoryIds);
    if (
      !Number.isFinite(overall) &&
      !Number.isFinite(projection) &&
      !Number.isFinite(underlying) &&
      Object.keys(categoryScores).length === 0
    ) {
      return null;
    }
    return {
      sourceId,
      asOf,
      freshness,
      confidence,
      overall: Number.isFinite(overall) ? clamp(overall, 1, 99) : null,
      projection: Number.isFinite(projection)
        ? clamp(projection, 1, 99)
        : null,
      underlying: Number.isFinite(underlying)
        ? clamp(underlying, 1, 99)
        : null,
      categoryScores,
      sampleSize: Number.isFinite(Number(item.sampleSize))
        ? Math.max(0, Number(item.sampleSize))
        : null,
      horizon: cleanText(item.horizon, "rest-of-season"),
    };
  }

  function normalizeImpact(value) {
    if (Number.isFinite(Number(value))) {
      return clamp(Number(value), -1, 1);
    }
    const normalized = String(value || "").toLowerCase();
    if (["positive", "upgrade", "promoted", "healthy"].includes(normalized)) {
      return 0.65;
    }
    if (["negative", "downgrade", "demoted", "injured"].includes(normalized)) {
      return -0.75;
    }
    return 0;
  }

  function normalizeQualitative(item, sources, now) {
    const sourceId = validSourceId(item?.sourceId);
    const source = sourceId ? sources.get(sourceId) : null;
    if (!source || !["qualitative", "mixed"].includes(source.kind)) return null;
    const asOf = validDate(item.asOf || source.updatedAt)?.toISOString();
    if (!asOf) return null;
    const type = cleanText(item.type, "role").toLowerCase();
    const expectedReturnDate = validDate(item.expectedReturn);
    const expectedReturn = expectedReturnDate?.toISOString() || null;
    const hasIlDays =
      item.ilDays !== null &&
      item.ilDays !== undefined &&
      item.ilDays !== "" &&
      Number.isFinite(Number(item.ilDays)) &&
      Number(item.ilDays) > 0;
    const ilDays = hasIlDays ? Number(item.ilDays) : null;
    const severity = String(item.severity || "")
      .trim()
      .toLowerCase();
    const normalizedSeverity = INJURY_SEVERITIES.has(severity) ? severity : "";
    const isInjury =
      INJURY_TYPES.has(type) ||
      Boolean(expectedReturn) ||
      hasIlDays ||
      Boolean(normalizedSeverity) ||
      Boolean(item.injuryStatus);
    const qualitativeSourceFreshness = freshnessFor(
      source.updatedAt,
      3,
      now
    );
    const freshness = Math.min(
      qualitativeSourceFreshness,
      freshnessFor(asOf, 3, now)
    );
    let stateMaxAgeDays = 3;
    if (isInjury) {
      stateMaxAgeDays = 30;
      const asOfDate = validDate(asOf);
      if (expectedReturnDate && asOfDate && expectedReturnDate > asOfDate) {
        stateMaxAgeDays = clamp(
          Math.ceil(
            (expectedReturnDate.getTime() - asOfDate.getTime()) /
              DAY_IN_MILLISECONDS
          ) + 7,
          14,
          120
        );
      }
    }
    const stateFreshness = isInjury
      ? Math.min(
          qualitativeSourceFreshness,
          freshnessFor(asOf, stateMaxAgeDays, now)
        )
      : freshness;
    const sourceUpdatedDate = validDate(source.updatedAt) || validDate(asOf);
    const asOfDate = validDate(asOf);
    const expiresAt = new Date(
      Math.min(
        sourceUpdatedDate.getTime() + 3 * DAY_IN_MILLISECONDS,
        asOfDate.getTime() + 3 * DAY_IN_MILLISECONDS
      )
    ).toISOString();
    const stateExpiresAt = new Date(
      Math.min(
        sourceUpdatedDate.getTime() + 3 * DAY_IN_MILLISECONDS,
        asOfDate.getTime() + stateMaxAgeDays * DAY_IN_MILLISECONDS
      )
    ).toISOString();
    const summary = cleanText(item.summary || item.headline);
    const status = cleanText(item.injuryStatus || item.status);
    if (
      !summary &&
      !status &&
      !Number.isFinite(Number(item.impact)) &&
      !expectedReturn &&
      !Number.isFinite(ilDays) &&
      !normalizedSeverity
    ) {
      return null;
    }
    return {
      sourceId,
      asOf,
      freshness,
      stateFreshness,
      expiresAt,
      stateExpiresAt,
      confidence: clamp(
        Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0.7,
        0,
        1
      ),
      type,
      isInjury,
      summary,
      impact: normalizeImpact(item.impact),
      status,
      role: cleanText(item.role),
      severity: normalizedSeverity,
      ilDays: hasIlDays ? clamp(Math.round(ilDays), 1, 365) : null,
      expectedReturn,
      sourceUrl: validHttpsUrl(item.sourceUrl || item.url),
    };
  }

  function playerLookup(league) {
    const byLocalId = new Map();
    const byEspnId = new Map();
    league.players.forEach((player) => {
      byLocalId.set(String(player.id), player);
      const espnId = player?.externalIds?.espn;
      if (espnId !== undefined && espnId !== null) {
        byEspnId.set(String(espnId), player);
      } else if (league.mode === "espn") {
        byEspnId.set(String(player.id), player);
      }
    });
    return { byLocalId, byEspnId };
  }

  function matchedPlayer(record, lookup) {
    if (record?.playerId !== undefined && record?.playerId !== null) {
      const direct = lookup.byLocalId.get(String(record.playerId));
      if (direct) return direct;
    }
    if (record?.externalIds?.espn !== undefined) {
      return lookup.byEspnId.get(String(record.externalIds.espn)) || null;
    }
    return null;
  }

  function blendCategoryScores(player, quantitative, categoryIds) {
    const result = {};
    categoryIds.forEach((categoryId) => {
      const entries = [];
      const baseline = Number(player?.scores?.[categoryId]);
      if (Number.isFinite(baseline)) {
        entries.push({ value: baseline, weight: 1 });
      }
      quantitative.forEach((item) => {
        const value = Number(item.categoryScores[categoryId]);
        const weight = item.confidence * item.freshness;
        if (Number.isFinite(value) && weight > 0) {
          entries.push({ value, weight });
        }
      });
      const value = weightedMean(entries);
      if (Number.isFinite(value)) result[categoryId] = Math.round(value);
    });
    return result;
  }

  function blendSignals(player, quantitative) {
    const baseSignals = player.baseSignals || player.signals || {};
    const signal = (key, fallback) => {
      const entries = [];
      const current = Number(baseSignals[key]);
      if (Number.isFinite(current)) {
        entries.push({ value: current, weight: 1 });
      }
      quantitative.forEach((item) => {
        const rawCandidate = item[key] ?? item.overall;
        const candidate =
          rawCandidate === null ||
          rawCandidate === undefined ||
          rawCandidate === ""
            ? Number.NaN
            : Number(rawCandidate);
        const weight = item.confidence * item.freshness;
        if (Number.isFinite(candidate) && weight > 0) {
          entries.push({ value: candidate, weight });
        }
      });
      const value = weightedMean(entries);
      return Number.isFinite(value) ? Math.round(value) : fallback;
    };
    const fallback = Number.isFinite(player.marketValue) ? player.marketValue : 40;
    return {
      projection: signal("projection", fallback),
      underlying: signal("underlying", fallback),
      consensus: signal("overall", fallback),
    };
  }

  function bestQualitative(qualitative) {
    return [...qualitative]
      .filter((item) => item.freshness > 0)
      .sort(
        (left, right) =>
          right.freshness * right.confidence -
            left.freshness * left.confidence ||
          new Date(right.asOf).getTime() - new Date(left.asOf).getTime()
      )[0];
  }

  function bestInjuryEvidence(qualitative) {
    return [...qualitative]
      .filter((item) => item.isInjury && item.stateFreshness > 0)
      .sort(
        (left, right) =>
          new Date(right.asOf).getTime() - new Date(left.asOf).getTime() ||
          right.confidence - left.confidence
      )[0];
  }

  function isHealthyStatus(status) {
    return ["", "ACTIVE", "HEALTHY", "PROBABLE"].includes(
      String(status || "").trim().toUpperCase()
    );
  }

  function mergeSources(existingSources, normalizedSources) {
    const merged = new Map(
      (Array.isArray(existingSources) ? existingSources : []).map((source) => [
        String(source.id),
        { ...source },
      ])
    );
    normalizedSources.forEach((source) => {
      const existing = merged.get(source.id) || {};
      merged.set(source.id, {
        ...existing,
        ...source,
        status: source.status,
        cadence: source.updatedAt
          ? `Updated ${source.updatedAt}`
          : source.cadence,
      });
    });
    return [...merged.values()];
  }

  function applySnapshot(league, snapshot, options = {}) {
    if (!league || !Array.isArray(league.players) || !Array.isArray(league.categories)) {
      throw new SourceDataError("A readable league is required.", "INVALID_LEAGUE");
    }
    if (
      !snapshot ||
      Number(snapshot.schemaVersion) !== 1 ||
      !Array.isArray(snapshot.sources) ||
      !Array.isArray(snapshot.players)
    ) {
      throw new SourceDataError(
        "The source response does not match schema version 1.",
        "INVALID_SOURCE_DATA"
      );
    }
    if (snapshot.players.length > MAX_PLAYERS) {
      throw new SourceDataError(
        "The source response contains too many players.",
        "SOURCE_DATA_TOO_LARGE"
      );
    }
    const now = options.now instanceof Date ? options.now : new Date();
    const generatedAt = validDate(snapshot.generatedAt);
    if (!generatedAt || generatedAt.getTime() > now.getTime() + 300_000) {
      throw new SourceDataError(
        "The source response has no valid generatedAt value.",
        "INVALID_SOURCE_DATA"
      );
    }
    const sourceMap = new Map();
    snapshot.sources.forEach((source) => {
      const normalized = normalizeSource(source, now);
      if (normalized) sourceMap.set(normalized.id, normalized);
    });
    const categoryIds = league.categories.map((category) => String(category.id));
    const lookup = playerLookup(league);
    const evidenceByPlayerId = new Map();
    snapshot.players.forEach((record) => {
      const player = matchedPlayer(record, lookup);
      if (!player) return;
      const quantitative = (Array.isArray(record.quantitative)
        ? record.quantitative
        : []
      )
        .map((item) =>
          normalizeQuantitative(item, sourceMap, categoryIds, now)
        )
        .filter(Boolean);
      const qualitative = (Array.isArray(record.qualitative)
        ? record.qualitative
        : []
      )
        .map((item) => normalizeQualitative(item, sourceMap, now))
        .filter(Boolean);
      if (quantitative.length === 0 && qualitative.length === 0) return;
      evidenceByPlayerId.set(String(player.id), { quantitative, qualitative });
    });
    const players = league.players.map((player) => {
      const evidence = evidenceByPlayerId.get(String(player.id));
      const baseStatus = player.baseStatus || player.status;
      const baseSignals = player.baseSignals || player.signals;
      const baseModelScores = Object.prototype.hasOwnProperty.call(
        player,
        "baseModelScores"
      )
        ? player.baseModelScores
        : player.modelScores || null;
      const baseNews = Object.prototype.hasOwnProperty.call(player, "baseNews")
        ? player.baseNews
        : player.news || null;
      const baseInjury = Object.prototype.hasOwnProperty.call(
        player,
        "baseInjury"
      )
        ? player.baseInjury
        : player.injury || null;
      if (!evidence) {
        return {
          ...player,
          baseStatus,
          baseSignals,
          baseModelScores,
          baseNews,
          baseInjury,
          status: baseStatus,
          signals: baseSignals,
          modelScores: baseModelScores,
          news: baseNews,
          injury: baseInjury,
          insights: { quantitative: [], qualitative: [] },
        };
      }
      const modelScores =
        evidence.quantitative.length > 0
          ? blendCategoryScores(player, evidence.quantitative, categoryIds)
          : {};
      const qualitative = bestQualitative(evidence.qualitative);
      const injuryEvidence = bestInjuryEvidence(evidence.qualitative);
      let evidenceStatus = injuryEvidence?.status || qualitative?.status || "";
      if (
        evidenceStatus &&
        !isHealthyStatus(baseStatus) &&
        !injuryEvidence
      ) {
        evidenceStatus = "";
      }
      const injury = injuryEvidence
        ? {
            source:
              sourceMap.get(injuryEvidence.sourceId)?.name ||
              injuryEvidence.sourceId,
            sourceId: injuryEvidence.sourceId,
            sourceUrl:
              injuryEvidence.sourceUrl ||
              sourceMap.get(injuryEvidence.sourceId)?.url ||
              "",
            status: injuryEvidence.status || baseStatus,
            severity: injuryEvidence.severity || "",
            ilDays: injuryEvidence.ilDays,
            expectedReturn: injuryEvidence.expectedReturn,
            updated: injuryEvidence.asOf,
            confidence: injuryEvidence.confidence,
            freshness: injuryEvidence.stateFreshness,
            expiresAt: injuryEvidence.stateExpiresAt,
          }
        : baseInjury;
      return {
        ...player,
        baseStatus,
        baseSignals,
        baseModelScores,
        baseNews,
        baseInjury,
        modelScores:
          Object.keys(modelScores).length > 0 ? modelScores : baseModelScores,
        signals: blendSignals(player, evidence.quantitative),
        status: evidenceStatus || baseStatus,
        injury,
        news:
          evidence.qualitative.length > 0
            ? qualitative?.summary
              ? {
                  source:
                    sourceMap.get(qualitative.sourceId)?.name ||
                    qualitative.sourceId,
                  headline: qualitative.summary,
                  impact: qualitative.impact,
                  updated: qualitative.asOf,
                  type: qualitative.type,
                  sourceUrl:
                    qualitative.sourceUrl ||
                    sourceMap.get(qualitative.sourceId)?.url ||
                    "",
                  freshness: qualitative.freshness,
                  expiresAt: qualitative.expiresAt,
                }
              : baseNews
            : baseNews,
        insights: {
          quantitative: evidence.quantitative,
          qualitative: evidence.qualitative,
        },
      };
    });
    const connectedSources = [...sourceMap.values()];
    return {
      ...league,
      players,
      sources: mergeSources(league.sources, connectedSources),
      league: {
        ...league.league,
        insightsUpdatedAt: generatedAt.toISOString(),
      },
      sourceSnapshot: {
        schemaVersion: 1,
        generatedAt: generatedAt.toISOString(),
        matchedPlayers: evidenceByPlayerId.size,
      },
      model: {
        version: "2.2 evidence model",
        weights: [
          { label: "Market and rank anchor", value: 50 },
          { label: "Category production", value: 30 },
          { label: "Projection and skill evidence", value: 20 },
        ],
        adjustments: ["Availability", "Role news", "Team category strategy"],
      },
    };
  }

  function requestBody(league) {
    return {
      schemaVersion: 1,
      league: {
        id: String(league.league.id),
        season: Number(league.league.season),
        mode: cleanText(league.mode),
      },
      categories: league.categories.map((category) => ({
        id: String(category.id),
        statId: Number.isFinite(category.statId) ? category.statId : null,
        aggregation: category.aggregation,
        direction: category.direction || "higher",
      })),
      players: league.players.map((player) => ({
        id: String(player.id),
        externalIds: player.externalIds || {
          espn: league.mode === "espn" ? String(player.id) : null,
        },
        name: cleanText(player.name),
        mlbTeam: cleanText(player.mlbTeam),
      })),
    };
  }

  async function fetchSnapshot({ league, signal, timeout = 10000 }) {
    if (!SOURCE_ENDPOINT) {
      throw new SourceDataError(
        "Licensed source data is not configured in this environment.",
        "SOURCE_NOT_CONFIGURED"
      );
    }
    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = () => controller.abort(signal.reason);
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", abortFromParent, { once: true });
    }
    try {
      const response = await fetch(SOURCE_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody(league)),
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new SourceDataError(
          `The source service returned ${response.status}.`,
          "SOURCE_REQUEST_FAILED"
        );
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_RESPONSE_BYTES
      ) {
        throw new SourceDataError(
          "The source response is too large.",
          "SOURCE_DATA_TOO_LARGE"
        );
      }
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new SourceDataError(
          "The source response is too large.",
          "SOURCE_DATA_TOO_LARGE"
        );
      }
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new SourceDataError(
          "The source service returned invalid JSON.",
          "INVALID_SOURCE_DATA"
        );
      }
    } catch (error) {
      if (timedOut) {
        throw new SourceDataError(
          "The source service did not respond in time.",
          "SOURCE_TIMEOUT"
        );
      }
      if (error?.name === "AbortError") throw error;
      if (error instanceof SourceDataError) throw error;
      throw new SourceDataError(
        "The source service could not be reached.",
        "SOURCE_REQUEST_FAILED"
      );
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", abortFromParent);
    }
  }

  async function enrichLeague({ league, signal, timeout, now }) {
    const snapshot = await fetchSnapshot({ league, signal, timeout });
    return applySnapshot(league, snapshot, { now });
  }

  return {
    applySnapshot,
    enrichLeague,
    fetchSnapshot,
    hasSourceEndpoint: Boolean(SOURCE_ENDPOINT),
    requestBody,
    SourceDataError,
  };
});
