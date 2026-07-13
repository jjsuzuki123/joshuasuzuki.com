"use strict";

// A small Resy client built on top of a pluggable HTTP transport.
//
// In production the transport is `impers` (a libcurl-impersonate binding) so
// the TLS/JA3/JA4 + HTTP-2 fingerprint matches real Chrome and clears
// Cloudflare's edge. For unit tests, a fake transport is injected via
// `config.transport`, so none of the logic here needs the network.
//
// Resy has no public API; these are the same private api.resy.com endpoints
// the web app calls. Endpoint shapes and the public web-app api_key can change
// without notice, so both are overridable via config/env.

const DEFAULT_BASE_URL = "https://api.resy.com";
// Public web-app api_key baked into resy.com's JS bundle (shared by all
// clients). Overridable via RESY_API_KEY if Resy rotates it.
const DEFAULT_API_KEY =
  "VbWk7s3L4KiK5fzlO7JD3Q5EYolDskn7wr5ugasv8yMLNJ9iqHOqBL3";
const DEFAULT_IMPERSONATE = "chrome";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

class ResyError extends Error {
  constructor(message, code, status, details) {
    super(message);
    this.name = "ResyError";
    this.code = code || "RESY_ERROR";
    this.status = status ?? null;
    this.details = details ?? null;
  }
}

function encodeForm(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    )
    .join("&");
}

function readHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") {
    return headers.get(name);
  }
  const lower = String(name).toLowerCase();
  if (lower in headers) return headers[lower];
  return headers[name] ?? null;
}

// Lazily create the production transport backed by `impers`. Kept out of the
// module top level so that (a) tests never load the native binding and (b) a
// missing binding degrades to Node's fetch instead of crashing at import.
async function createDefaultTransport({ impersonate, proxy }) {
  try {
    const impers = await import("impers");
    const session = new impers.Session({
      impersonate: impersonate || DEFAULT_IMPERSONATE,
      http2Multiplexing: true,
      maxHostConnections: 6,
      ...(proxy ? { proxy } : {}),
    });

    const transport = async (method, url, options = {}) => {
      const sentAt = Date.now();
      const res = await session.request(method, url, {
        headers: options.headers,
        content: options.body,
        timeout: Math.ceil((options.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000),
        allowRedirects: false,
        ...(options.impersonate ? { impersonate: options.impersonate } : {}),
      });
      const receivedAt = Date.now();
      const body = await Promise.resolve(res.text());
      return {
        status: res.status,
        headers: res.headers,
        body,
        timing: { sentAt, receivedAt },
      };
    };
    transport.close = async () => {
      try {
        await session.close();
      } catch {
        /* best effort */
      }
    };
    transport.kind = "impers";
    return transport;
  } catch (err) {
    return createFetchTransport();
  }
}

// Fallback transport using Node's global fetch (undici). This does NOT defeat
// TLS fingerprinting; it exists so the module runs in environments without the
// native impersonation binding (local dev, CI smoke checks).
function createFetchTransport() {
  const transport = async (method, url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs || DEFAULT_TIMEOUT_MS
    );
    const sentAt = Date.now();
    try {
      const res = await fetch(url, {
        method,
        headers: options.headers,
        body: options.body,
        redirect: "manual",
        signal: controller.signal,
      });
      const receivedAt = Date.now();
      const body = await res.text();
      return { status: res.status, headers: res.headers, body, timing: { sentAt, receivedAt } };
    } finally {
      clearTimeout(timer);
    }
  };
  transport.kind = "fetch";
  return transport;
}

function createResyClient(config = {}) {
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const apiKey = config.apiKey || process.env.RESY_API_KEY || DEFAULT_API_KEY;
  const impersonate = config.impersonate || DEFAULT_IMPERSONATE;
  const proxy = config.proxy || process.env.RESY_PROXY || null;
  const userAgent = config.userAgent || DEFAULT_USER_AGENT;
  const defaultTimeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;

  const state = {
    authToken: config.authToken || process.env.RESY_AUTH_TOKEN || null,
    transport: config.transport || null,
  };

  async function getTransport() {
    if (!state.transport) {
      state.transport = await createDefaultTransport({ impersonate, proxy });
    }
    return state.transport;
  }

  // Browser-like header set. Header ordering itself is handled by the
  // impersonation layer; here we make the values realistic.
  function baseHeaders(extra = {}) {
    const headers = {
      Authorization: `ResyAPI api_key="${apiKey}"`,
      "X-Origin": "https://resy.com",
      Origin: "https://resy.com",
      Referer: "https://resy.com/",
      "User-Agent": userAgent,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
    };
    if (state.authToken) {
      headers["X-Resy-Auth-Token"] = state.authToken;
      headers["X-Resy-Universal-Auth"] = state.authToken;
    }
    return { ...headers, ...extra };
  }

  function buildUrl(path, query) {
    const url = new URL(path.startsWith("http") ? path : `${baseUrl}${path}`);
    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async function rawRequest(method, path, opts = {}) {
    const transport = await getTransport();
    const url = buildUrl(path, opts.query);
    const headers = baseHeaders(opts.headers);

    let body;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form !== undefined) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = encodeForm(opts.form);
    }

    return transport(method, url, {
      headers,
      body,
      timeoutMs: opts.timeoutMs || defaultTimeoutMs,
    });
  }

  // Perform a request and parse JSON, throwing typed errors on failure.
  async function jsonRequest(method, path, opts = {}) {
    const res = await rawRequest(method, path, opts);
    const status = res.status;
    let parsed = null;
    if (res.body) {
      try {
        parsed = JSON.parse(res.body);
      } catch {
        parsed = null;
      }
    }

    if (status === 401 || status === 419) {
      throw new ResyError("Resy auth token rejected.", "AUTH_REJECTED", status, parsed);
    }
    if (status === 403) {
      throw new ResyError("Resy blocked the request (bot check?).", "BLOCKED", status, parsed);
    }
    if (status === 429) {
      throw new ResyError("Resy rate limited the request.", "RATE_LIMITED", status, parsed);
    }
    if (status < 200 || status >= 300) {
      const message =
        parsed?.message || parsed?.error || `Resy returned HTTP ${status}.`;
      throw new ResyError(message, "HTTP_ERROR", status, parsed);
    }
    return { status, data: parsed, raw: res };
  }

  async function authenticate() {
    if (state.authToken) return state.authToken;
    const email = config.email || process.env.RESY_EMAIL;
    const password = config.password || process.env.RESY_PASSWORD;
    if (!email || !password) {
      throw new ResyError(
        "No auth token and no email/password to log in with.",
        "NO_CREDENTIALS"
      );
    }
    const { data } = await jsonRequest("POST", "/3/auth/password", {
      form: { email, password },
    });
    const token = data?.token || null;
    if (!token) {
      throw new ResyError("Login succeeded but no token was returned.", "NO_TOKEN");
    }
    state.authToken = token;
    return token;
  }

  function setAuthToken(token) {
    state.authToken = token || null;
  }

  async function getUser() {
    const { data } = await jsonRequest("GET", "/2/user");
    return data;
  }

  // Resolve a usable payment method id. Prefers an explicit id, then the
  // account's default, then the first available.
  async function resolvePaymentMethodId(preferredId) {
    if (preferredId) return Number(preferredId);
    const user = await getUser();
    const methods = user?.payment_methods || [];
    if (!methods.length) return null;
    const preferred = methods.find((m) => m.is_default) || methods[0];
    return preferred?.id ?? null;
  }

  async function searchVenues(query) {
    const { data } = await jsonRequest("POST", "/3/venuesearch/search", {
      json: { query: String(query || ""), per_page: 20 },
    });
    return data?.search?.hits || data?.hits || [];
  }

  async function findSlots({ venueId, day, partySize, lat = 0, long = 0 }) {
    if (!venueId) throw new ResyError("findSlots requires venueId.", "BAD_ARGS");
    const { data, raw } = await jsonRequest("GET", "/4/find", {
      query: {
        lat,
        long,
        day,
        party_size: partySize,
        venue_id: venueId,
      },
    });
    const venues = data?.results?.venues || [];
    const match =
      venues.find((v) => String(v?.venue?.id?.resy) === String(venueId)) ||
      venues[0] ||
      null;
    const slots = match?.slots || [];
    return {
      slots,
      venue: match?.venue || null,
      serverDate: readHeader(raw?.headers, "date"),
    };
  }

  // Exchange a slot's config token for a real book token (required before
  // booking). Returns { bookToken, ... } from Resy's details endpoint.
  async function getReservationDetails({ configToken, day, partySize }) {
    if (!configToken) {
      throw new ResyError("getReservationDetails requires a config token.", "BAD_ARGS");
    }
    const { data } = await jsonRequest("POST", "/3/details", {
      json: { commit: 1, config_id: configToken, day, party_size: partySize },
    });
    const bookToken = data?.book_token?.value || null;
    if (!bookToken) {
      throw new ResyError("Details response had no book token.", "NO_BOOK_TOKEN", null, data);
    }
    return {
      bookToken,
      expires: data?.book_token?.date_expires || null,
      paymentMethods: data?.user?.payment_methods || data?.payment_methods || [],
      raw: data,
    };
  }

  async function book({ bookToken, paymentMethodId }) {
    if (!bookToken) throw new ResyError("book requires a book token.", "BAD_ARGS");
    const form = {
      book_token: bookToken,
      source_id: "resy.com-venue-details",
    };
    if (paymentMethodId !== undefined && paymentMethodId !== null) {
      form.struct_payment_method = JSON.stringify({ id: Number(paymentMethodId) });
    }
    const { data } = await jsonRequest("POST", "/3/book", { form });
    const reservationId = data?.reservation_id || data?.resy_token || null;
    if (!reservationId) {
      throw new ResyError("Book response had no reservation id.", "BOOK_INCOMPLETE", null, data);
    }
    return { reservationId, resyToken: data?.resy_token || null, raw: data };
  }

  // Measure our clock offset from Resy's servers and the round-trip time, by
  // reading the `Date` response header across a few samples and keeping the one
  // with the smallest RTT (least measurement error), NTP-style.
  async function measureServerClock({ samples = 3, path = "/2/config" } = {}) {
    let best = null;
    for (let i = 0; i < samples; i += 1) {
      let res;
      try {
        res = await rawRequest("GET", path, { timeoutMs: defaultTimeoutMs });
      } catch {
        continue;
      }
      const dateHeader = readHeader(res.headers, "date");
      if (!dateHeader) continue;
      const serverMs = Date.parse(dateHeader);
      if (!Number.isFinite(serverMs)) continue;
      const { sentAt, receivedAt } = res.timing;
      const rttMs = receivedAt - sentAt;
      const localMidpoint = sentAt + rttMs / 2;
      // The Date header has 1s resolution; treat it as the server time at the
      // moment the response was generated (approximately the midpoint).
      const offsetMs = serverMs - localMidpoint;
      if (!best || rttMs < best.rttMs) {
        best = { offsetMs, rttMs, serverMs, sampledAt: receivedAt };
      }
    }
    if (!best) {
      throw new ResyError("Could not measure server clock.", "CLOCK_UNAVAILABLE");
    }
    return best;
  }

  // Pre-warm: authenticate and open the connection so the TLS handshake is
  // already paid for before the drop. Returns the measured clock offset.
  async function prewarm() {
    await authenticate();
    const clock = await measureServerClock().catch(() => null);
    return { clock };
  }

  async function close() {
    const transport = state.transport;
    if (transport && typeof transport.close === "function") {
      await transport.close();
    }
  }

  return {
    ResyError,
    setAuthToken,
    getAuthToken: () => state.authToken,
    authenticate,
    getUser,
    resolvePaymentMethodId,
    searchVenues,
    findSlots,
    getReservationDetails,
    book,
    measureServerClock,
    prewarm,
    close,
    // exposed for tests / advanced callers
    _rawRequest: rawRequest,
    _buildUrl: buildUrl,
  };
}

module.exports = {
  createResyClient,
  ResyError,
  createFetchTransport,
  DEFAULT_API_KEY,
  DEFAULT_BASE_URL,
};
