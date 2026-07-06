"use strict";

const ESPN_BASE =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://joshuasuzuki.com",
  "https://www.joshuasuzuki.com",
];
const MAX_BODY_BYTES = 12 * 1024;
const MAX_ESPN_RESPONSE_BYTES = 7 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

exports.handler = async function handler(event) {
  const origin = requestOrigin(event);
  if (!allowedOrigins().has(origin)) {
    return response(403, { message: "Origin not allowed." }, null);
  }

  const method =
    event?.requestContext?.http?.method || event?.httpMethod || "POST";
  if (method === "OPTIONS") {
    return response(204, null, origin);
  }
  if (method !== "POST") {
    return response(405, { message: "Method not allowed." }, origin);
  }

  const rawBody = decodeBody(event);
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return response(413, { message: "Request is too large." }, origin);
  }

  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch (error) {
    return response(400, { message: "Request body must be valid JSON." }, origin);
  }

  const leagueId = normalizedDigits(body.leagueId);
  const season = normalizedDigits(body.season);
  const teamId = body.teamId ? normalizedDigits(body.teamId) : null;
  if (!leagueId || !season || season.length !== 4 || (body.teamId && !teamId)) {
    return response(
      400,
      { message: "League, season, or team ID is invalid." },
      origin
    );
  }

  const espnS2 = secretValue(body.espnS2, 8_192);
  const swid = secretValue(body.swid, 160);
  const hasPrivateCredentials = Boolean(espnS2 || swid);
  if (hasPrivateCredentials && (!espnS2 || !swid)) {
    return response(
      400,
      { message: "Private leagues require both espn_s2 and SWID." },
      origin
    );
  }
  if (
    (body.espnS2 && !espnS2) ||
    (body.swid && !swid)
  ) {
    return response(
      400,
      { message: "The ESPN session values are malformed." },
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
        },
        origin
      );
    }
    if (espnResponse.status === 404) {
      return response(
        404,
        { message: "ESPN could not find that league and season." },
        origin
      );
    }
    if (espnResponse.status === 429) {
      return response(
        429,
        { message: "ESPN is rate limiting imports. Try again shortly." },
        origin
      );
    }
    if (!espnResponse.ok) {
      return response(
        502,
        { message: `ESPN returned ${espnResponse.status}.` },
        origin
      );
    }

    const contentLength = Number(espnResponse.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_ESPN_RESPONSE_BYTES
    ) {
      return response(502, { message: "ESPN returned too much data." }, origin);
    }

    const responseText = await espnResponse.text();
    if (Buffer.byteLength(responseText, "utf8") > MAX_ESPN_RESPONSE_BYTES) {
      return response(502, { message: "ESPN returned too much data." }, origin);
    }

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      return response(
        502,
        { message: "ESPN returned an unreadable response." },
        origin
      );
    }

    return response(200, { payload, teamId }, origin);
  } catch (error) {
    if (timedOut) {
      return response(504, { message: "ESPN took too long to respond." }, origin);
    }
    if (error?.name === "AbortError") {
      return response(499, { message: "Import cancelled." }, origin);
    }
    console.error("RosterLab ESPN relay failed", error?.name || "Error");
    return response(
      502,
      { message: "The ESPN import service could not complete the request." },
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
  ["mTeam", "mRoster", "mSettings", "mStandings"].forEach((view) => {
    url.searchParams.append("view", view);
  });
  return url;
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
    body: body === null ? "" : JSON.stringify(body),
  };
}
