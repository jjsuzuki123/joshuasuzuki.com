"use strict";

const crypto = require("node:crypto");

const ESPN_BASE =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://joshuasuzuki.com",
  "https://www.joshuasuzuki.com",
];
const MAX_BODY_BYTES = 12 * 1024;
const MAX_ESPN_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_LAMBDA_PAYLOAD_BYTES = 6 * 1024 * 1024 - 64 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const ESPN_PLAYER_FILTER = JSON.stringify({
  players: {
    filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
    filterStatsForSplitTypeIds: { value: [0, 1] },
    limit: 100,
    sortPercOwned: { sortPriority: 1, sortAsc: false },
    sortDraftRanks: {
      sortPriority: 100,
      sortAsc: true,
      value: "STANDARD",
    },
  },
});
const PRO_TEAM_BY_ID = {
  0: "FA",
  1: "BAL",
  2: "BOS",
  3: "LAA",
  4: "CWS",
  5: "CLE",
  6: "DET",
  7: "KC",
  8: "MIL",
  9: "MIN",
  10: "NYY",
  11: "ATH",
  12: "SEA",
  13: "TEX",
  14: "TOR",
  15: "ATL",
  16: "CHC",
  17: "CIN",
  18: "HOU",
  19: "LAD",
  20: "WSH",
  21: "NYM",
  22: "PHI",
  23: "PIT",
  24: "STL",
  25: "SD",
  26: "SF",
  27: "COL",
  28: "MIA",
  29: "ARI",
  30: "TB",
};
const researchSecretCache = new Map();

exports.handler = async function handler(event) {
  const origin = requestOrigin(event);
  if (!allowedOrigins().has(origin)) {
    return response(
      403,
      { code: "ORIGIN_NOT_ALLOWED", message: "Origin not allowed." },
      null
    );
  }

  const method =
    event?.requestContext?.http?.method || event?.httpMethod || "POST";
  if (method === "OPTIONS") {
    return response(204, null, origin);
  }
  if (method !== "POST") {
    return response(
      405,
      { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
      origin
    );
  }

  const rawBody = decodeBody(event);
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return response(
      413,
      { code: "REQUEST_TOO_LARGE", message: "Request is too large." },
      origin
    );
  }

  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch (error) {
    return response(
      400,
      { code: "INVALID_JSON", message: "Request body must be valid JSON." },
      origin
    );
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return response(
      400,
      { code: "INVALID_BODY", message: "Request body must be a JSON object." },
      origin
    );
  }

  const leagueId = normalizedDigits(body.leagueId);
  const season = normalizedDigits(body.season);
  const teamId = body.teamId ? normalizedDigits(body.teamId) : null;
  if (!leagueId || !season || season.length !== 4 || (body.teamId && !teamId)) {
    return response(
      400,
      {
        code: "INVALID_IDS",
        message: "League, season, or team ID is invalid.",
      },
      origin
    );
  }

  const espnS2 = secretValue(body.espnS2, 8_192);
  const swid = secretValue(body.swid, 160);
  const researchAccessCode = secretValue(body.researchAccessCode, 256);
  const hasPrivateCredentials = Boolean(espnS2 || swid);
  if (hasPrivateCredentials && (!espnS2 || !swid)) {
    return response(
      400,
      {
        code: "MISSING_SESSION",
        message: "Private leagues require both espn_s2 and SWID.",
      },
      origin
    );
  }
  if (
    (body.espnS2 && !espnS2) ||
    (body.swid && !swid)
  ) {
    return response(
      400,
      {
        code: "INVALID_SESSION",
        message: "The ESPN session values are malformed.",
      },
      origin
    );
  }

  const url = leagueUrl({ leagueId, season });
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const headers = {
      Accept: "application/json",
      "User-Agent": "RosterLab/1.0",
      "X-Fantasy-Filter": ESPN_PLAYER_FILTER,
    };
    if (hasPrivateCredentials) {
      headers.Cookie = `espn_s2=${espnS2}; SWID=${swid}`;
    }

    const espnResponse = await fetch(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: controller.signal,
    });

    if (espnResponse.status === 401 || espnResponse.status === 403) {
      return response(
        401,
        {
          message: hasPrivateCredentials
            ? "ESPN rejected these session values. Sign in to ESPN again and copy fresh values."
            : "This league is private. Choose Private league and add your ESPN session values.",
          code: hasPrivateCredentials
            ? "INVALID_SESSION"
            : "PRIVATE_LEAGUE",
        },
        origin
      );
    }
    if (espnResponse.status === 404) {
      return response(
        404,
        {
          code: "LEAGUE_NOT_FOUND",
          message: "ESPN could not find that league and season.",
        },
        origin
      );
    }
    if (espnResponse.status === 429) {
      return response(
        429,
        {
          code: "ESPN_RATE_LIMITED",
          message: "ESPN is rate limiting imports. Try again shortly.",
        },
        origin
      );
    }
    if (!espnResponse.ok) {
      return response(
        502,
        {
          code: "ESPN_ERROR",
          message: `ESPN returned ${espnResponse.status}.`,
        },
        origin
      );
    }

    const contentLength = Number(espnResponse.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_ESPN_RESPONSE_BYTES
    ) {
      return response(
        502,
        { code: "ESPN_RESPONSE_TOO_LARGE", message: "ESPN returned too much data." },
        origin
      );
    }

    let responseText;
    try {
      responseText = await readTextWithLimit(
        espnResponse,
        MAX_ESPN_RESPONSE_BYTES
      );
    } catch (error) {
      if (error?.name === "ResponseTooLargeError") {
        return response(
          502,
          {
            code: "ESPN_RESPONSE_TOO_LARGE",
            message: "ESPN returned too much data.",
          },
          origin
        );
      }
      throw error;
    }

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      return response(
        502,
        {
          code: "INVALID_ESPN_RESPONSE",
          message: "ESPN returned an unreadable response.",
        },
        origin
      );
    }

    let researchToken = "";
    if (
      process.env.RESEARCH_SIGNING_SECRET_NAME &&
      process.env.RESEARCH_ACCESS_SECRET_NAME &&
      researchAccessCode
    ) {
      try {
        if (await validResearchAccessCode(researchAccessCode)) {
          const secret = await researchSigningSecret();
          researchToken = createResearchToken({
            secret,
            leagueId,
            season,
            players: authorizedPlayersForPayload(payload),
          });
        }
      } catch (_error) {
        researchToken = "";
      }
    }

    const successResponse = serializedResponse(
      200,
      JSON.stringify({ payload, teamId, researchToken }),
      origin
    );
    if (
      Buffer.byteLength(JSON.stringify(successResponse), "utf8") >
      MAX_LAMBDA_PAYLOAD_BYTES
    ) {
      return response(
        502,
        {
          code: "ESPN_RESPONSE_TOO_LARGE",
          message: "ESPN returned too much data.",
        },
        origin
      );
    }

    return successResponse;
  } catch (error) {
    if (timedOut) {
      return response(
        504,
        {
          code: "ESPN_TIMEOUT",
          message: "ESPN took too long to respond.",
        },
        origin
      );
    }
    if (error?.name === "AbortError") {
      return response(
        499,
        { code: "IMPORT_CANCELLED", message: "Import cancelled." },
        origin
      );
    }
    console.error("RosterLab ESPN relay failed", error?.name || "Error");
    return response(
      502,
      {
        code: "RELAY_ERROR",
        message: "The ESPN import service could not complete the request.",
      },
      origin
    );
  } finally {
    clearTimeout(timeoutId);
  }
};

function leagueUrl({ leagueId, season }) {
  const url = new URL(
    `${ESPN_BASE}/seasons/${season}/segments/0/leagues/${leagueId}`
  );
  [
    "mTeam",
    "mRoster",
    "mSettings",
    "mStandings",
    "kona_player_info",
  ].forEach((view) => {
    url.searchParams.append("view", view);
  });
  return url;
}

async function readTextWithLimit(upstreamResponse, maximumBytes) {
  if (!upstreamResponse.body?.getReader) {
    const text = await upstreamResponse.text();
    if (Buffer.byteLength(text, "utf8") > maximumBytes) {
      const error = new Error("Response too large");
      error.name = "ResponseTooLargeError";
      throw error;
    }
    return text;
  }

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel("Response too large");
      const error = new Error("Response too large");
      error.name = "ResponseTooLargeError";
      throw error;
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function decodeBody(event) {
  const body = typeof event?.body === "string" ? event.body : "";
  return event?.isBase64Encoded
    ? Buffer.from(body, "base64").toString("utf8")
    : body;
}

function normalizedDigits(value) {
  const text = String(value || "").trim();
  return /^\d+$/.test(text) ? text : null;
}

function secretValue(value, maximumLength) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > maximumLength) return null;
  if (/[\u0000-\u001f\u007f;]/.test(value)) return null;
  return value.trim() || null;
}

function playerNameForResearch(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[^\p{L}\p{N} .'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function authorizedPlayersForPayload(payload) {
  const rawPlayers = [];
  (Array.isArray(payload?.teams) ? payload.teams : []).forEach((team) => {
    (Array.isArray(team?.roster?.entries) ? team.roster.entries : []).forEach(
      (entry) => rawPlayers.push(entry?.playerPoolEntry?.player)
    );
  });
  (Array.isArray(payload?.players) ? payload.players : []).forEach((entry) => {
    rawPlayers.push(entry?.player || entry?.playerPoolEntry?.player);
  });
  const authorized = new Set();
  rawPlayers.forEach((player) => {
    const espnId = String(player?.id || "").trim();
    const name = playerNameForResearch(player?.fullName || player?.displayName);
    if (!/^\d{1,12}$/.test(espnId) || name.length < 2) return;
    const nameHash = crypto
      .createHash("sha256")
      .update(name.toLowerCase())
      .digest("hex")
      .slice(0, 16);
    const mlbTeam = PRO_TEAM_BY_ID[Number(player?.proTeamId)] || "FA";
    authorized.add(`${espnId}:${nameHash}:${mlbTeam}`);
  });
  return [...authorized].slice(0, 500);
}

function createResearchToken({
  secret,
  leagueId,
  season,
  players,
  now = new Date(),
}) {
  if (!secret || !Array.isArray(players) || players.length === 0) return "";
  const payload = {
    version: 1,
    jti: crypto.randomUUID(),
    maxPlayers: 12,
    leagueId: String(leagueId),
    season: Number(season),
    issuedAt: Math.floor(now.getTime() / 1000),
    expiresAt: Math.floor(now.getTime() / 1000) + 2 * 60 * 60,
    players,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

async function researchSigningSecret() {
  return researchSecret(process.env.RESEARCH_SIGNING_SECRET_NAME);
}

async function validResearchAccessCode(value) {
  const expected = await researchSecret(
    process.env.RESEARCH_ACCESS_SECRET_NAME
  );
  const suppliedBuffer = Buffer.from(String(value || ""), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    suppliedBuffer.length > 0 &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

async function researchSecret(secretName) {
  const cached = researchSecretCache.get(secretName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const {
    GetSecretValueCommand,
    SecretsManagerClient,
  } = require("@aws-sdk/client-secrets-manager");
  const client = new SecretsManagerClient({});
  const output = await client.send(
    new GetSecretValueCommand({
      SecretId: secretName,
    })
  );
  const value = String(output.SecretString || "");
  if (!value) throw new Error("Research secret is empty.");
  researchSecretCache.set(secretName, {
    value,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return value;
}

function allowedOrigins() {
  const configured = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS);
}

function requestOrigin(event) {
  return event?.headers?.origin || event?.headers?.Origin || "";
}

function response(statusCode, body, origin) {
  return serializedResponse(
    statusCode,
    body === null ? "" : JSON.stringify(body),
    origin
  );
}

function serializedResponse(statusCode, body, origin) {
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Allow-Methods"] = "OPTIONS,POST";
    headers.Vary = "Origin";
  }

  return {
    statusCode,
    headers,
    body,
  };
}

exports.authorizedPlayersForPayload = authorizedPlayersForPayload;
exports.createResearchToken = createResearchToken;
