const ESPN_PAGE_HOSTS = new Set(["www.espn.com", "fantasy.espn.com"]);
const ROSTERLAB_ORIGINS = new Set([
  "https://joshuasuzuki.com",
  "https://www.joshuasuzuki.com",
]);
const ROSTERLAB_PATHS = new Set([
  "/fantasy",
  "/fantasy/",
  "/fantasy/index.html",
]);
const NUMERIC_ID_PATTERN = /^\d{1,20}$/;
const SEASON_PATTERN = /^20\d{2}$/;

export const ESPN_DASHBOARD_URL = "https://www.espn.com/fantasy/baseball/";
export const ESPN_API_ORIGIN = "https://lm-api-reads.fantasy.espn.com";
export const ESPN_VIEWS = Object.freeze([
  "mTeam",
  "mRoster",
  "mSettings",
  "mStandings",
]);

export class ConnectorInputError extends Error {
  constructor(message, code = "INVALID_REFERENCE") {
    super(message);
    this.name = "ConnectorInputError";
    this.code = code;
  }
}

function readUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch (error) {
    return null;
  }
}

function isAllowedEspnPath(url) {
  if (url.hostname === "www.espn.com") {
    return /^\/fantasy\/baseball(?:\/|$)/.test(url.pathname);
  }
  return /^\/baseball(?:\/|$)/.test(url.pathname);
}

function hashParameters(url) {
  const queryStart = url.hash.indexOf("?");
  return queryStart >= 0
    ? new URLSearchParams(url.hash.slice(queryStart + 1))
    : new URLSearchParams();
}

function validId(value) {
  const candidate = String(value || "").trim();
  return NUMERIC_ID_PATTERN.test(candidate) ? candidate : null;
}

function validSeason(value) {
  const candidate = String(value || "").trim();
  return SEASON_PATTERN.test(candidate) ? candidate : null;
}

export function isEspnPageUrl(value) {
  const url = readUrl(value);
  return Boolean(
    url &&
      url.protocol === "https:" &&
      ESPN_PAGE_HOSTS.has(url.hostname) &&
      isAllowedEspnPath(url)
  );
}

export function isRosterLabPageUrl(value) {
  const url = readUrl(value);
  return Boolean(
    url &&
      ROSTERLAB_ORIGINS.has(url.origin) &&
      ROSTERLAB_PATHS.has(url.pathname)
  );
}

export function parseEspnLeagueReference(value, options = {}) {
  const url = readUrl(value);
  if (!url || !isEspnPageUrl(url.href)) return null;

  const hash = hashParameters(url);
  const parameter = (name) =>
    url.searchParams.get(name) || hash.get(name) || null;
  const pathLeagueId =
    url.pathname.match(/\/leagues?\/(\d{1,20})(?:\/|$)/i)?.[1] || null;
  const pathSeason =
    url.pathname.match(/\/seasons\/(20\d{2})(?:\/|$)/i)?.[1] || null;
  const leagueId = validId(parameter("leagueId") || pathLeagueId);

  if (!leagueId) return null;

  const defaultSeason =
    validSeason(options.defaultSeason) || String(new Date().getFullYear());
  return {
    leagueId,
    season:
      validSeason(parameter("seasonId") || parameter("season") || pathSeason) ||
      defaultSeason,
    teamId: validId(parameter("teamId")),
  };
}

export function normalizeLeagueReference(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConnectorInputError("Choose an ESPN fantasy baseball league.");
  }

  const leagueId = validId(value.leagueId);
  const season =
    validSeason(value.season) ||
    validSeason(options.defaultSeason) ||
    String(new Date().getFullYear());
  const teamId = validId(value.teamId);

  if (!leagueId) {
    throw new ConnectorInputError("ESPN returned an invalid league ID.");
  }
  if (!season) {
    throw new ConnectorInputError("ESPN returned an invalid season.");
  }

  return { leagueId, season, teamId };
}

export function buildEspnApiUrl(reference) {
  const normalized = normalizeLeagueReference(reference);
  const url = new URL(
    `/apis/v3/games/flb/seasons/${normalized.season}/segments/0/leagues/${normalized.leagueId}`,
    ESPN_API_ORIGIN
  );
  ESPN_VIEWS.forEach((view) => url.searchParams.append("view", view));
  return url.href;
}

export function buildEspnLeaguePageUrl(reference) {
  const normalized = normalizeLeagueReference(reference);
  const path = normalized.teamId ? "/baseball/team" : "/baseball/league";
  const url = new URL(path, "https://fantasy.espn.com");
  url.searchParams.set("leagueId", normalized.leagueId);
  url.searchParams.set("seasonId", normalized.season);
  if (normalized.teamId) {
    url.searchParams.set("teamId", normalized.teamId);
  }
  return url.href;
}

export function isReadableLeaguePayload(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Array.isArray(value.teams) &&
      value.teams.length >= 2
  );
}
