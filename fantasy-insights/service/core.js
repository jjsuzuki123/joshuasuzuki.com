"use strict";

const crypto = require("node:crypto");

const MAX_PLAYERS = 500;
const MAX_TEXT = 500;
const MAX_ARTICLES_PER_PLAYER = 5;
const MAX_SNAPSHOT_BYTES = 1_500_000;
const RESEARCH_TERMS =
  "injury IL injured list activated return lineup role closer saves rotation starter bullpen platoon optioned recalled promoted demoted fantasy";
const RELEVANT_PATTERN =
  /\b(injur(?:y|ed)|\bil\b|injured list|day[- ]to[- ]day|activated|return(?:ed|ing)?|rehab|lineup|batting order|closer|save opportunities|rotation|starter|bullpen|platoon|optioned|recalled|promoted|demoted|60[- ]day|15[- ]day|10[- ]day|7[- ]day|season[- ]ending)\b/i;
const QUERY_POLICY_VERSION = "v2";
const PUBLISHERS = [
  { domain: "espn.com", id: "espn", name: "ESPN" },
  { domain: "sports.yahoo.com", id: "yahoo-sports", name: "Yahoo Sports" },
  { domain: "mlb.com", id: "mlb", name: "MLB" },
  { domain: "nbcsports.com", id: "nbc-sports", name: "NBC Sports" },
  { domain: "cbssports.com", id: "cbs-sports", name: "CBS Sports" },
  { domain: "fantasypros.com", id: "fantasypros", name: "FantasyPros" },
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function cleanText(value, maximum = MAX_TEXT) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function normalizedSearchText(value) {
  return cleanText(value, 10_000)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function validDate(value, now = new Date()) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (
    Number.isNaN(date.getTime()) ||
    date.getTime() > now.getTime() + 86_400_000
  ) {
    return null;
  }
  return date;
}

function normalizeDomain(value) {
  const domain = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");
  const labels = domain.split(".");
  return domain.length <= 253 &&
    labels.length >= 2 &&
    /^[a-z]{2,63}$/.test(labels.at(-1) || "") &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
    ? domain
    : null;
}

function parseDomains(value) {
  return [
    ...new Set(
      String(value || "")
        .split(",")
        .map(normalizeDomain)
        .filter(Boolean)
    ),
  ].slice(0, 50);
}

function domainAllowed(hostname, allowedDomains) {
  const normalized = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return allowedDomains.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
  );
}

function safeArticleUrl(value, allowedDomains) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !domainAllowed(url.hostname, allowedDomains)
    ) {
      return null;
    }
    url.hash = "";
    return url.href.slice(0, 2048);
  } catch (_error) {
    return null;
  }
}

function playerNameForSearch(value) {
  return cleanText(value, 100)
    .replace(/[^\p{L}\p{N} .'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePlayer(record) {
  const espnId = String(record?.externalIds?.espn || "").trim();
  const name = playerNameForSearch(record?.name);
  const mlbTeam = String(record?.mlbTeam || "")
    .trim()
    .toUpperCase();
  if (
    !/^\d{1,12}$/.test(espnId) ||
    name.length < 2 ||
    name.length > 100 ||
    !/^(?:[A-Z]{2,4}|FA)$/.test(mlbTeam)
  ) {
    return null;
  }
  const id = cleanText(record.id || espnId, 100);
  const nameHash = crypto
    .createHash("sha256")
    .update(name.toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return {
    id,
    espnId,
    name,
    mlbTeam,
    status: cleanText(record.status, 80),
    ownerTeamId:
      record.ownerTeamId === null || record.ownerTeamId === undefined
        ? null
        : cleanText(record.ownerTeamId, 100),
    activeRoster: record.activeRoster === true,
    priority: clamp(Number(record.priority) || 0, 0, 100),
    authKey: `${espnId}:${nameHash}:${mlbTeam}`,
    cacheKey: `player:${QUERY_POLICY_VERSION}:${espnId}:${nameHash}:${mlbTeam}`,
  };
}

function parseResearchRequest(body) {
  if (
    !body ||
    Number(body.schemaVersion) !== 1 ||
    !body.league ||
    !Array.isArray(body.players) ||
    body.players.length === 0 ||
    body.players.length > MAX_PLAYERS
  ) {
    return null;
  }
  const players = body.players.map(normalizePlayer).filter(Boolean);
  if (players.length === 0) return null;
  const unique = new Map();
  players.forEach((player) => unique.set(player.cacheKey, player));
  return {
    league: {
      id: cleanText(body.league.id, 100),
      season: Number(body.league.season),
      mode: cleanText(body.league.mode, 30),
    },
    players: [...unique.values()].sort(
      (left, right) =>
        Number(right.activeRoster) - Number(left.activeRoster) ||
        Number(right.ownerTeamId !== null) - Number(left.ownerTeamId !== null) ||
        right.priority - left.priority ||
        left.name.localeCompare(right.name)
    ),
    researchToken: cleanText(body.researchToken, 40_000),
  };
}

function researchTokenClaims(token, request, secret, now = new Date()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !secret) return null;
  const [encodedPayload, encodedSignature] = parts;
  let expected;
  try {
    expected = crypto
      .createHmac("sha256", secret)
      .update(encodedPayload)
      .digest();
  } catch (_error) {
    return null;
  }
  let supplied;
  try {
    supplied = Buffer.from(encodedSignature, "base64url");
  } catch (_error) {
    return null;
  }
  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    );
  } catch (_error) {
    return null;
  }
  if (
    Number(payload?.version) !== 1 ||
    !/^[0-9a-f-]{36}$/.test(String(payload?.jti || "")) ||
    !Number.isInteger(Number(payload?.maxPlayers)) ||
    Number(payload.maxPlayers) < 1 ||
    Number(payload.maxPlayers) > 100 ||
    String(payload?.leagueId) !== String(request.league.id) ||
    Number(payload?.season) !== Number(request.league.season) ||
    !Number.isFinite(Number(payload?.expiresAt)) ||
    Number(payload.expiresAt) <= Math.floor(now.getTime() / 1000) ||
    Number(payload.expiresAt) > Math.floor(now.getTime() / 1000) + 3 * 60 * 60 ||
    !Array.isArray(payload.players) ||
    payload.players.length > MAX_PLAYERS
  ) {
    return null;
  }
  const authorized = new Set(
    payload.players
      .map((value) => String(value || ""))
      .filter((value) =>
        /^\d{1,12}:[a-f0-9]{16}:(?:[A-Z]{2,4}|FA)$/.test(value)
      )
  );
  if (!request.players.every((player) => authorized.has(player.authKey))) {
    return null;
  }
  return {
    jti: String(payload.jti),
    maxPlayers: Number(payload.maxPlayers),
    expiresAt: Number(payload.expiresAt),
  };
}

function verifyResearchToken(token, request, secret, now = new Date()) {
  return Boolean(researchTokenClaims(token, request, secret, now));
}

function buildSearchRequest(player, allowedDomains) {
  const teamTerm = player.mlbTeam === "FA" ? "" : ` ${player.mlbTeam}`;
  return {
    query: `"${player.name}"${teamTerm} ${RESEARCH_TERMS}`.slice(0, 500),
    limit: MAX_ARTICLES_PER_PLAYER,
    sources: [{ type: "web" }],
    tbs: "sbd:1,qdr:w",
    includeDomains: allowedDomains,
    country: "US",
    location: "United States",
    ignoreInvalidURLs: true,
    scrapeOptions: {
      formats: [{ type: "markdown" }],
      onlyMainContent: true,
      maxAge: 300_000,
      storeInCache: true,
      skipTlsVerification: false,
      proxy: "basic",
      parsers: [],
      timeout: 30_000,
      location: {
        country: "US",
        languages: ["en-US"],
      },
    },
    timeout: 45_000,
  };
}

function playerMatchTokens(name) {
  const parts = normalizedSearchText(name)
    .split(/\s+/)
    .filter(
      (part) =>
        part.length > 1 &&
        !["jr", "sr", "ii", "iii", "iv"].includes(part.replace(/\./g, ""))
    );
  return {
    full: parts.join(" "),
    last: parts.at(-1) || "",
  };
}

function contentMentionsPlayer(content, player) {
  const normalized = normalizedSearchText(content);
  const tokens = playerMatchTokens(player.name);
  return Boolean(
    tokens.full &&
      (normalized.includes(tokens.full) ||
        (tokens.last.length >= 4 && normalized.includes(tokens.last)))
  );
}

function relevantQuote(markdown, player) {
  const chunks = String(markdown || "")
    .replace(/\r/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((chunk) => cleanText(chunk, 500))
    .filter(
      (chunk) =>
        chunk.length >= 20 &&
        RELEVANT_PATTERN.test(chunk) &&
        contentMentionsPlayer(chunk, player)
    );
  return chunks[0] || "";
}

function injuryStateFromQuote(quote) {
  const text = normalizedSearchText(quote);
  if (!text) return {};
  if (/season[- ]ending|out for the (?:rest of the )?season/.test(text)) {
    return {
      eventType: "injury",
      status: "Out for season",
      severity: "season-ending",
      ilDays: null,
      impact: -1,
    };
  }
  const durationPatterns = [
    [/\b60[- ]day (?:il|injured list)\b|\b(?:il|d)60\b/, 60, "long-term"],
    [/\b15[- ]day (?:il|injured list)\b|\b(?:il|d)15\b/, 15, "medium-term"],
    [/\b10[- ]day (?:il|injured list)\b|\b(?:il|d)10\b/, 10, "short-term"],
    [/\b7[- ]day (?:il|injured list)\b|\b(?:il|d)7\b/, 7, "short-term"],
  ];
  for (const [pattern, ilDays, severity] of durationPatterns) {
    if (pattern.test(text)) {
      return {
        eventType: "injury",
        status: `${ilDays}-day IL`,
        severity,
        ilDays,
        impact: -0.9,
      };
    }
  }
  if (/\bactivated\b|returns? from (?:the )?(?:il|injured list)/.test(text)) {
    return {
      eventType: "transaction",
      status: "Active",
      severity: "active",
      ilDays: null,
      impact: 0.65,
    };
  }
  if (/\bday[- ]to[- ]day\b|\bdtd\b/.test(text)) {
    return {
      eventType: "injury",
      status: "Day-to-day",
      severity: "day-to-day",
      ilDays: null,
      impact: -0.3,
    };
  }
  if (/\binjured list\b|\bon (?:the )?il\b|\bplaced on (?:the )?il\b/.test(text)) {
    return {
      eventType: "injury",
      status: "IL",
      severity: "",
      ilDays: null,
      impact: -0.7,
    };
  }
  return {};
}

function roleStateFromQuote(quote) {
  const text = normalizedSearchText(quote);
  if (/\boptioned\b|\bdemoted\b/.test(text)) {
    return { eventType: "role", role: "Minors", impact: -0.75 };
  }
  if (/\brecalled\b|\bpromoted\b/.test(text)) {
    return { eventType: "role", role: "Active roster", impact: 0.55 };
  }
  if (/\bcloser\b|\bsave opportunities\b|\bninth inning\b/.test(text)) {
    return { eventType: "role", role: "Late-inning role", impact: 0.35 };
  }
  if (/\brotation\b|\bstarting pitcher\b|\bstarter\b/.test(text)) {
    return { eventType: "role", role: "Rotation", impact: 0.3 };
  }
  if (/\bplatoon\b/.test(text)) {
    return { eventType: "role", role: "Platoon", impact: -0.35 };
  }
  if (/\bleadoff\b|\bcleanup\b|\bheart of the order\b/.test(text)) {
    return { eventType: "lineup", role: "Premium lineup spot", impact: 0.25 };
  }
  return {};
}

function sourceIdForDomain(domain) {
  const normalized = String(domain || "")
    .replace(/^www\./, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `web-${normalized || "source"}`;
}

function sourceNameForDomain(domain) {
  return String(domain || "")
    .replace(/^www\./, "")
    .split(".")
    .slice(0, -1)
    .join(".")
    .split(/[-.]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ");
}

function publisherForDomain(domain) {
  return (
    PUBLISHERS.find(
      (publisher) =>
        domain === publisher.domain || domain.endsWith(`.${publisher.domain}`)
    ) || {
      domain,
      id: sourceIdForDomain(domain).replace(/^web-/, ""),
      name: sourceNameForDomain(domain) || domain,
    }
  );
}

function candidateFromResult(result, player, allowedDomains, now) {
  const originalUrl = safeArticleUrl(
    result?.metadata?.sourceURL || result?.url,
    allowedDomains
  );
  const sourceUrl = safeArticleUrl(result?.metadata?.url, allowedDomains);
  const statusCode = Number(result?.metadata?.statusCode);
  if (
    !originalUrl ||
    !sourceUrl ||
    !Number.isFinite(statusCode) ||
    statusCode < 200 ||
    statusCode >= 300 ||
    result?.metadata?.error
  ) {
    return null;
  }
  const title = cleanText(result?.title || result?.metadata?.title, 240);
  const snippet = cleanText(result?.description || result?.snippet, 400);
  const markdown = String(result?.markdown || "").slice(0, 300_000);
  const searchable = `${title}\n${snippet}\n${markdown}`;
  if (!contentMentionsPlayer(searchable, player)) return null;
  const quote = relevantQuote(markdown, player);
  if (!quote && !RELEVANT_PATTERN.test(`${title} ${snippet}`)) return null;
  const state = {
    ...roleStateFromQuote(quote || `${title}. ${snippet}`),
    ...injuryStateFromQuote(quote || `${title}. ${snippet}`),
  };
  const reportedDate = validDate(
    result?.metadata?.publishedTime ||
      result?.metadata?.publishedDate ||
      result?.date,
    now
  );
  if (
    reportedDate &&
    now.getTime() - reportedDate.getTime() > 14 * 86_400_000
  ) {
    return null;
  }
  const publishedAt = reportedDate || now;
  const domain = new URL(sourceUrl).hostname.toLowerCase();
  const publisher = publisherForDomain(domain);
  return {
    domain,
    publisherId: publisher.id,
    sourceId: `web-${publisher.id}`.slice(0, 50),
    sourceName: publisher.name,
    sourceUrl,
    title: title || `${player.name} update`,
    summary: snippet || quote || title,
    evidenceQuote: quote,
    publicationVerified: Boolean(reportedDate),
    speculative: /\b(could|might|may|considering|possible|possibly)\b/i.test(
      quote
    ),
    asOf: publishedAt.toISOString(),
    reportType: state.eventType || "report",
  };
}

function normalizeResearchResults({
  response,
  player,
  allowedDomains,
  officialDomains = [],
  now = new Date(),
}) {
  const rawResults = Array.isArray(response?.data?.web)
    ? response.data.web
    : Array.isArray(response?.web)
      ? response.web
      : [];
  const candidates = rawResults
    .map((result) =>
      candidateFromResult(result, player, allowedDomains, now)
    )
    .filter(Boolean)
    .slice(0, MAX_ARTICLES_PER_PLAYER);
  const corroboration = new Map();
  candidates.forEach((candidate) => {
    if (!corroboration.has(candidate.reportType)) {
      corroboration.set(candidate.reportType, new Set());
    }
    corroboration.get(candidate.reportType).add(candidate.publisherId);
  });

  const sources = new Map();
  const qualitative = candidates.map((candidate) => {
    const official = domainAllowed(candidate.domain, officialDomains);
    const corroborated =
      (corroboration.get(candidate.reportType)?.size || 0) >= 2;
    sources.set(candidate.sourceId, {
      id: candidate.sourceId,
      name: candidate.sourceName,
      url: `https://${candidate.domain}/`,
      kind: "qualitative",
      access: official ? "official" : "user-provided",
      coverage: "Firecrawl-discovered player news with citations",
      cadence: "On-demand web research",
      updatedAt: now.toISOString(),
    });
    return {
      sourceId: candidate.sourceId,
      asOf: candidate.asOf,
      confidence: official ? 0.86 : corroborated ? 0.72 : 0.45,
      type: "report",
      summary: candidate.title,
      impact: 0,
      status: "",
      role: "",
      severity: "",
      ilDays: null,
      sourceUrl: candidate.sourceUrl,
      evidenceQuote: candidate.evidenceQuote,
      publisher: candidate.sourceName,
      reportType: candidate.reportType,
      corroborated,
      publicationVerified: candidate.publicationVerified,
      modelEligible: false,
    };
  });
  return {
    sources: [...sources.values()],
    qualitative,
  };
}

function buildSnapshot(cachedRecords, research, now = new Date()) {
  const sources = new Map();
  const players = [];
  let estimatedBytes = 4_096;
  let truncated = false;
  cachedRecords.forEach((record) => {
    const payload = record?.payload;
    if (!payload || !Array.isArray(payload.qualitative)) return;
    const entry = {
      playerId: record.player.id,
      externalIds: { espn: record.player.espnId },
      qualitative: payload.qualitative,
      quantitative: [],
    };
    const sourceEntries = (
      Array.isArray(payload.sources) ? payload.sources : []
    ).filter((source) => source?.id && !sources.has(source.id));
    const entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
    const sourceBytes = Buffer.byteLength(
      JSON.stringify(sourceEntries),
      "utf8"
    );
    if (estimatedBytes + entryBytes + sourceBytes > MAX_SNAPSHOT_BYTES) {
      truncated = true;
      return;
    }
    sourceEntries.forEach((source) => sources.set(source.id, source));
    players.push(entry);
    estimatedBytes += entryBytes + sourceBytes;
  });
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    sources: [...sources.values()],
    players,
    research: {
      ...(research || {}),
      returned: players.length,
      truncated,
    },
  };
}

module.exports = {
  MAX_PLAYERS,
  buildSearchRequest,
  buildSnapshot,
  cleanText,
  domainAllowed,
  normalizePlayer,
  normalizeResearchResults,
  parseDomains,
  parseResearchRequest,
  researchTokenClaims,
  safeArticleUrl,
  verifyResearchToken,
};
