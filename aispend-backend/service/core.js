"use strict";

const MAX_REQUEST_BYTES = 10_000;
const MAX_TEXT = 500;
const MAX_WEB_READINGS = 8;
const SCHEMA_VERSION = 1;
const CACHE_KEY_VERSION = "v1";

// Approximate public-suffix handling for the common multi-label TLDs a
// company domain is likely to use. Anything else keeps its last two labels.
const MULTI_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.jp",
  "or.jp",
  "ne.jp",
  "co.kr",
  "com.br",
  "com.mx",
  "com.ar",
  "com.sg",
  "com.hk",
  "com.tw",
  "co.in",
  "co.il",
  "co.za",
  "com.cn",
]);

const VENDORS = [
  { id: "claude-code", name: "Claude Code", company: "Anthropic" },
  { id: "cursor", name: "Cursor", company: "Anysphere" },
  { id: "openai", name: "OpenAI Codex", company: "OpenAI" },
  { id: "github-copilot", name: "GitHub Copilot", company: "GitHub" },
  { id: "devin", name: "Devin", company: "Cognition" },
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

function validDomainLabels(labels) {
  return (
    labels.length >= 2 &&
    /^[a-z]{2,63}$/.test(labels.at(-1) || "") &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  );
}

// Accepts a bare domain, a hostname, or a pasted URL and returns the
// lowercase registrable domain (approximate eTLD+1), or null when invalid.
function normalizeCompanyDomain(value) {
  let raw = cleanText(value, 300).toLowerCase();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) {
    try {
      raw = new URL(raw).hostname;
    } catch (_error) {
      return null;
    }
  }
  raw = raw.split("/")[0].split("?")[0].split("#")[0];
  raw = raw.replace(/^\.+|\.+$/g, "").replace(/\.{2,}/g, ".");
  if (raw.includes("@") || raw.includes(":")) return null;
  if (raw.length > 253) return null;
  const labels = raw.split(".");
  if (!validDomainLabels(labels)) return null;
  // IP addresses are not company domains.
  if (labels.every((label) => /^\d+$/.test(label))) return null;
  const lastTwo = labels.slice(-2).join(".");
  const keep = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  if (labels.length < keep) return null;
  const registrable = labels.slice(-keep).join(".");
  const registrableLabels = registrable.split(".");
  // The registrable name itself must have a real, non-numeric owner label.
  if (!validDomainLabels(registrableLabels)) return null;
  if (/^\d+$/.test(registrableLabels[0])) return null;
  return registrable;
}

function companyCacheKey(domain) {
  return `company:${CACHE_KEY_VERSION}:${domain}`;
}

function parseCompanyRequest(body) {
  if (Number(body?.schemaVersion) !== SCHEMA_VERSION) return null;
  const domain = normalizeCompanyDomain(body?.domain);
  if (!domain) return null;
  return {
    domain,
    companyName: cleanText(body?.companyName, 120) || null,
    cacheKey: companyCacheKey(domain),
    refresh: body?.refresh === true,
  };
}

function parseLookupRequest(body) {
  if (Number(body?.schemaVersion) !== SCHEMA_VERSION) return null;
  const { resolveCompanyQuery } = require("./directory.js");
  const raw = body?.query || body?.domain || body?.company || "";
  const resolved = resolveCompanyQuery(raw);
  if (!resolved) return null;
  if (!resolved.domain) {
    return {
      unresolved: true,
      query: resolved.query,
      companyName: resolved.companyName,
      suggestions: resolved.suggestions || [],
      refresh: body?.refresh === true,
    };
  }
  return {
    unresolved: false,
    query: resolved.query,
    domain: resolved.domain,
    companyName:
      cleanText(body?.companyName, 120) || resolved.companyName || null,
    source: resolved.source,
    suggestions: resolved.suggestions || [],
    cacheKey: companyCacheKey(resolved.domain),
    refresh: body?.refresh === true,
  };
}

function parseSuggestRequest(body) {
  const query = cleanText(body?.query || body?.q || "", 200);
  if (!query) return null;
  const { suggestCompanies } = require("./directory.js");
  return {
    query,
    suggestions: suggestCompanies(query, 8),
  };
}

function parseQueueMessage(record) {
  let body;
  try {
    body = JSON.parse(String(record?.body || ""));
  } catch (_error) {
    return null;
  }
  const domain = normalizeCompanyDomain(body?.company?.domain);
  if (
    Number(body?.schemaVersion) !== SCHEMA_VERSION ||
    !domain ||
    body?.company?.cacheKey !== companyCacheKey(domain) ||
    !/^[0-9a-f-]{36}$/.test(String(body?.queueToken || ""))
  ) {
    return null;
  }
  return {
    company: {
      domain,
      cacheKey: companyCacheKey(domain),
      name: cleanText(body?.company?.name || body?.company?.companyName, 120),
    },
    queueToken: String(body.queueToken),
  };
}

// Citation URLs are displayed as links only and never fetched server-side.
function sanitizeCitationUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return null;
    }
    url.hash = "";
    return url.href.slice(0, 2048);
  } catch (_error) {
    return null;
  }
}

// "Cursor" is a common programming word, so a bare match is not evidence.
// It must appear near editor/agent/company context or the vendor domain.
const CURSOR_CONTEXT_PATTERN =
  /\b(anysphere|cursor\.com|cursor\.sh|ai (?:code )?editor|ai[- ]powered (?:code )?editor|code editor|ide|coding agent|composer|bugbot|cursor agent|cursor ai)\b/i;

const VENDOR_MENTION_PATTERNS = {
  "claude-code": /\bclaude(?:[ .-]?code| code max|\.md|\.ai|[ -]?(?:sonnet|opus|haiku))\b|\banthropic\b/i,
  cursor: /\bcursor\b/i,
  openai:
    /\bopenai\b|\bchatgpt (?:enterprise|business|team)\b|\bcodex\b|\bgpt-\d/i,
  "github-copilot": /\bcopilot\b/i,
  devin: /\bdevin\b|\bcognition(?:\s+labs| ai)?\b/i,
};

function classifyVendorMentions(text) {
  const haystack = cleanText(text, 2000);
  if (!haystack) return [];
  const vendors = [];
  for (const vendor of VENDORS) {
    const pattern = VENDOR_MENTION_PATTERNS[vendor.id];
    if (!pattern || !pattern.test(haystack)) continue;
    if (vendor.id === "cursor" && !CURSOR_CONTEXT_PATTERN.test(haystack)) {
      continue;
    }
    vendors.push(vendor.id);
  }
  return vendors;
}

// Search-only Firecrawl request: SERP titles/descriptions are enough for
// mention evidence, and skipping scrapes keeps the credit cost bounded.
function buildWebSearchRequest({ domain, companyName }) {
  const name = cleanText(companyName, 80).replace(/["\\]/g, "");
  const quotedCompany =
    name && name.toLowerCase() !== domain ? ` OR "${name}"` : "";
  return {
    query:
      `("${domain}"${quotedCompany}) ` +
      '("Claude Code" OR "Anthropic" OR "Cursor AI" OR "GitHub Copilot" OR "Devin AI" OR "OpenAI Codex" OR "we\'re hiring")',
    limit: 5,
    tbs: "qdr:y",
    sources: [{ type: "web" }],
  };
}

function buildHeadcountSearchRequest({ domain, companyName }) {
  const name = cleanText(companyName, 80).replace(/["\\]/g, "");
  const subject = name && name.toLowerCase() !== domain ? `"${name}"` : `"${domain}"`;
  return {
    query: `${subject} (engineers OR "engineering team" OR "software engineers" OR employees) (hiring OR about OR careers)`,
    limit: 5,
    tbs: "qdr:y",
    sources: [{ type: "web" }],
  };
}

function extractHeadcountFromText(text) {
  const haystack = cleanText(text, 2000);
  if (!haystack) return null;
  const patterns = [
    { re: /(\d[\d,]{1,6})\+?\s*(?:software\s+)?engineers\b/i, kind: "engineers" },
    { re: /(\d[\d,]{1,6})\+?\s*developers\b/i, kind: "developers" },
    { re: /(\d[\d,]{1,6})\+?\s*engineering\s+(?:team|org|organization)\b/i, kind: "engineers" },
    { re: /(\d[\d,]{1,6})\+?\s*employees\b/i, kind: "employees" },
  ];
  for (const pattern of patterns) {
    const match = haystack.match(pattern.re);
    if (!match) continue;
    const value = Number(String(match[1]).replace(/,/g, ""));
    if (!Number.isFinite(value) || value < 5 || value > 2_000_000) continue;
    return { value, kind: pattern.kind };
  }
  return null;
}

function normalizeWebResults({ response, now = new Date() }) {
  const rows = Array.isArray(response?.data?.web)
    ? response.data.web
    : Array.isArray(response?.data)
      ? response.data
      : [];
  const readings = [];
  const seen = new Set();
  for (const row of rows) {
    if (readings.length >= MAX_WEB_READINGS) break;
    const url = sanitizeCitationUrl(row?.url);
    if (!url || seen.has(url)) continue;
    const title = cleanText(row?.title, 200);
    const description = cleanText(row?.description || row?.snippet, 400);
    const blob = `${title} ${description}`;
    const vendors = classifyVendorMentions(blob);
    if (vendors.length === 0) continue;
    seen.add(url);
    const isJob = /\b(hiring|job|career|opening|role|we're hiring|join our)\b/i.test(blob);
    for (const vendor of vendors) {
      if (readings.length >= MAX_WEB_READINGS) break;
      readings.push({
        id: isJob
          ? `web.jobs.${vendor}.${readings.length}`
          : `web.mention.${vendor}.${readings.length}`,
        vendor,
        metric: isJob ? "Hiring / careers mention" : "Public web mention",
        value: 1,
        unit: "mention",
        source: "web",
        url,
        detail: title || description || url,
        observedAt: now.toISOString(),
      });
    }
  }
  return readings;
}

function normalizeHeadcountResults({ response, now = new Date() }) {
  const rows = Array.isArray(response?.data?.web)
    ? response.data.web
    : Array.isArray(response?.data)
      ? response.data
      : [];
  const readings = [];
  for (const row of rows) {
    const url = sanitizeCitationUrl(row?.url);
    const blob = `${row?.title || ""} ${row?.description || row?.snippet || ""}`;
    const extracted = extractHeadcountFromText(blob);
    if (!extracted || !url) continue;
    const isEmployees = extracted.kind === "employees";
    readings.push({
      id: `web.headcount.${extracted.kind}`,
      vendor: "company",
      metric: isEmployees
        ? "Reported employees (web)"
        : "Reported engineers (web)",
      value: extracted.value,
      unit: isEmployees ? "employees" : "engineers",
      source: "web",
      url,
      detail: cleanText(blob, 240),
      observedAt: now.toISOString(),
    });
    break;
  }
  return readings;
}

function normalizeReading(reading) {
  const vendorIds = new Set(VENDORS.map((vendor) => vendor.id));
  const vendor = String(reading?.vendor || "");
  const value = Number(reading?.value);
  if (
    (!vendorIds.has(vendor) && vendor !== "company") ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return null;
  }
  const url = reading?.url ? sanitizeCitationUrl(reading.url) : null;
  return {
    id: cleanText(reading?.id, 120) || "reading",
    vendor,
    metric: cleanText(reading?.metric, 120),
    value: Math.round(clamp(value, 0, 10_000_000)),
    unit: cleanText(reading?.unit, 40) || "count",
    source: reading?.source === "web" ? "web" : "github",
    url,
    detail: cleanText(reading?.detail, 300),
    observedAt: cleanText(reading?.observedAt, 40),
  };
}

function buildCompanyPayload({
  domain,
  companyName,
  github,
  webReadings,
  coverage,
  now,
  scale,
}) {
  const readings = [
    ...(Array.isArray(github?.readings) ? github.readings : []),
    ...(Array.isArray(webReadings) ? webReadings : []),
  ]
    .map(normalizeReading)
    .filter(Boolean)
    .slice(0, 80);
  const orgs = (Array.isArray(github?.orgs) ? github.orgs : [])
    .slice(0, 2)
    .map((org) => ({
      login: cleanText(org?.login, 60),
      name: cleanText(org?.name, 120),
      url: sanitizeCitationUrl(org?.url),
      blog: cleanText(org?.blog, 200),
      isVerified: org?.isVerified === true,
      publicRepos: Math.max(0, Math.round(Number(org?.publicRepos) || 0)),
      publicMembers: Math.max(0, Math.round(Number(org?.publicMembers) || 0)),
      followers: Math.max(0, Math.round(Number(org?.followers) || 0)),
      createdAt: cleanText(org?.createdAt, 40),
    }));
  return {
    schemaVersion: SCHEMA_VERSION,
    domain,
    company: {
      domain,
      name:
        cleanText(companyName, 120) ||
        orgs[0]?.name ||
        orgs[0]?.login ||
        domain.split(".")[0],
      githubOrgs: orgs,
      scale: scale && typeof scale === "object"
        ? {
            engineers: Math.max(0, Math.round(Number(scale.engineers) || 0)) || null,
            employees: Math.max(0, Math.round(Number(scale.employees) || 0)) || null,
            tier: cleanText(scale.tier, 40) || null,
            source: cleanText(scale.source || "directory", 40) || "directory",
          }
        : null,
    },
    coverage: {
      githubOrgResolved: coverage?.githubOrgResolved === true,
      githubAuthenticated: coverage?.githubAuthenticated === true,
      codeSearch: coverage?.codeSearch === true,
      commitSearch: coverage?.commitSearch === true,
      prSearch: coverage?.prSearch === true,
      webResearch: cleanText(coverage?.webResearch, 20) || "disabled",
      notes: (Array.isArray(coverage?.notes) ? coverage.notes : [])
        .map((note) => cleanText(note, 200))
        .filter(Boolean)
        .slice(0, 10),
    },
    readings,
    collectedAt: now.toISOString(),
  };
}

function parseCachedPayload(rawPayload) {
  try {
    const payload = JSON.parse(String(rawPayload || ""));
    if (
      Number(payload?.schemaVersion) !== SCHEMA_VERSION ||
      !normalizeCompanyDomain(payload?.domain) ||
      !Array.isArray(payload?.readings)
    ) {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
}

module.exports = {
  CACHE_KEY_VERSION,
  MAX_REQUEST_BYTES,
  SCHEMA_VERSION,
  VENDORS,
  buildCompanyPayload,
  buildHeadcountSearchRequest,
  buildWebSearchRequest,
  clamp,
  classifyVendorMentions,
  cleanText,
  companyCacheKey,
  extractHeadcountFromText,
  normalizeCompanyDomain,
  normalizeHeadcountResults,
  normalizeReading,
  normalizeWebResults,
  parseCachedPayload,
  parseCompanyRequest,
  parseLookupRequest,
  parseQueueMessage,
  parseSuggestRequest,
  sanitizeCitationUrl,
};
