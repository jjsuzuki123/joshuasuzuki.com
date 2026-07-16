#!/usr/bin/env node
/**
 * Cursor Analytics canvas refresh.
 *
 * Pulls team analytics directly from the Cursor Analytics API (plus the Admin
 * API and the AI Code Tracking API), computes derived insights and
 * cross-source correlations, and writes the data sidecar consumed by
 * `.cursor/canvases/cursor-model-usage.canvas.tsx`.
 *
 * Data sources (all first-party Cursor APIs, Basic auth with an admin-scoped
 * team API key — create one in cursor.com/dashboard -> API Keys):
 *   Analytics API   GET  /analytics/team/{dau,models,agent-edits,tabs,mcp,
 *                        commands,skills,plans,ask-mode,leaderboard,
 *                        client-versions,top-file-extensions,bugbot}
 *   Conversation    GET  /analytics/team/conversation-insights
 *   AI Code (git)   GET  /analytics/ai-code/commits
 *   Admin API       GET  /teams/members     POST /teams/spend
 *
 * Usage:
 *   node scripts/cursor-analytics-refresh.mjs [options]
 *
 * Options:
 *   --key <key>        API key (else CURSOR_ADMIN_KEY / CURSOR_ANALYTICS_API_KEY /
 *                      CURSOR_API_KEY / "API Key" env / ~/.config/cursor-analytics/env)
 *   --window <days>    Analytics window in days (default 30, max 30)
 *   --sample           Write clearly-labeled sample data (no network, for demos)
 *   --no-anonymize     Keep real names/emails (default anonymizes for customer demos)
 *   --base-url <url>   Override API base URL (testing)
 *   --out <dir>        Extra directory to write the sidecar into
 *
 * The sidecar is written to .cursor/canvases/ in the repo (gitignored — this
 * repo is public) and mirrored into the Cursor managed canvases directory
 * (~/.cursor/projects/<workspace-slug>/canvases/) when it exists, so the
 * canvas you already have open picks up fresh data automatically.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = "2.0";
const CANVAS_BASENAME = "cursor-model-usage";
const DEFAULT_BASE_URL = "https://api.cursor.com";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    key: null,
    window: 30,
    sample: false,
    anonymize: true,
    baseUrl: process.env.CURSOR_API_BASE_URL || DEFAULT_BASE_URL,
    out: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--key") args.key = argv[++i];
    else if (a === "--window") args.window = Number(argv[++i]);
    else if (a === "--sample") args.sample = true;
    else if (a === "--anonymize") args.anonymize = true;
    else if (a === "--no-anonymize") args.anonymize = false;
    else if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log("See header comment in scripts/cursor-analytics-refresh.mjs");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.window) || args.window < 7) args.window = 30;
  if (args.window > 30) args.window = 30; // Analytics API caps ranges at 30 days
  return args;
}

function resolveApiKey(args) {
  if (args.key) return args.key;
  for (const name of [
    "CURSOR_ADMIN_KEY",
    "CURSOR_ANALYTICS_API_KEY",
    "CURSOR_API_KEY",
    "API Key",
  ]) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  const envFile = path.join(os.homedir(), ".config", "cursor-analytics", "env");
  try {
    const text = fs.readFileSync(envFile, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?CURSOR_(?:ADMIN|ANALYTICS_API|API)_KEY\s*=\s*["']?([^"'\n]+)["']?\s*$/);
      if (m) return m[1].trim();
    }
  } catch {
    /* no key file */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function utcDateString(d) {
  return d.toISOString().slice(0, 10);
}

function dateRange(windowDays) {
  const end = new Date();
  const start = new Date(end.getTime() - (windowDays - 1) * 86400000);
  return { startDate: utcDateString(start), endDate: utcDateString(end) };
}

function eachDate(startDate, endDate) {
  const out = [];
  const d = new Date(`${startDate}T00:00:00Z`);
  const stop = new Date(`${endDate}T00:00:00Z`);
  while (d <= stop) {
    out.push(utcDateString(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function shortLabel(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return utcDateString(d);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function basicAuthHeader(key) {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function apiRequest(ctx, { method = "GET", endpoint, query, body }) {
  const url = new URL(endpoint, ctx.baseUrl);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: basicAuthHeader(ctx.apiKey),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON body */
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        await sleep(Math.max(retryAfter * 1000, attempt * 2500));
        continue;
      }
      if (!res.ok) {
        const message = json?.message || json?.error || text.slice(0, 200) || `HTTP ${res.status}`;
        const err = new Error(message);
        err.status = res.status;
        throw err;
      }
      return json;
    } catch (e) {
      if (e.status) throw e; // definitive API error — don't retry
      lastError = e;
      await sleep(attempt * 2000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("request failed");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Fetch layer — each source is independent; failures degrade gracefully
// ---------------------------------------------------------------------------

const SOURCE_DEFS = [
  { id: "analytics.dau", label: "Daily active users", endpoint: "/analytics/team/dau" },
  { id: "analytics.models", label: "Model usage", endpoint: "/analytics/team/models" },
  { id: "analytics.agentEdits", label: "Agent edits", endpoint: "/analytics/team/agent-edits" },
  { id: "analytics.tabs", label: "Tab completions", endpoint: "/analytics/team/tabs" },
  { id: "analytics.conversationInsights", label: "Conversation Insights", endpoint: "/analytics/team/conversation-insights" },
  { id: "analytics.mcp", label: "MCP adoption", endpoint: "/analytics/team/mcp" },
  { id: "analytics.commands", label: "Commands adoption", endpoint: "/analytics/team/commands" },
  { id: "analytics.skills", label: "Skills adoption", endpoint: "/analytics/team/skills" },
  { id: "analytics.plans", label: "Plan mode adoption", endpoint: "/analytics/team/plans" },
  { id: "analytics.askMode", label: "Ask mode adoption", endpoint: "/analytics/team/ask-mode" },
  { id: "analytics.leaderboard", label: "Leaderboard", endpoint: "/analytics/team/leaderboard" },
  { id: "analytics.clientVersions", label: "Client versions", endpoint: "/analytics/team/client-versions" },
  { id: "analytics.topExtensions", label: "Top file extensions", endpoint: "/analytics/team/top-file-extensions" },
  { id: "analytics.bugbot", label: "Bugbot PR analytics", endpoint: "/analytics/team/bugbot" },
  { id: "aiCode.commits", label: "AI code tracking (git commits)", endpoint: "/analytics/ai-code/commits" },
  { id: "admin.members", label: "Team members", endpoint: "/teams/members" },
  { id: "admin.spend", label: "Spend (billing cycle)", endpoint: "/teams/spend" },
];

function sourceRecord(id, status, detail) {
  const def = SOURCE_DEFS.find((s) => s.id === id);
  return { id, label: def?.label ?? id, endpoint: def?.endpoint ?? "", status, ...(detail ? { detail } : {}) };
}

async function fetchAll(ctx) {
  const { startDate, endDate } = ctx;
  const range = { startDate, endDate };
  const raw = {};
  const sources = [];

  const jobs = [
    ["analytics.dau", () => apiRequest(ctx, { endpoint: "/analytics/team/dau", query: range })],
    ["analytics.models", () => apiRequest(ctx, { endpoint: "/analytics/team/models", query: range })],
    ["analytics.agentEdits", () => apiRequest(ctx, { endpoint: "/analytics/team/agent-edits", query: range })],
    ["analytics.tabs", () => apiRequest(ctx, { endpoint: "/analytics/team/tabs", query: range })],
    [
      "analytics.conversationInsights",
      () =>
        apiRequest(ctx, {
          endpoint: "/analytics/team/conversation-insights",
          query: { ...range, include: "intents,complexity,categories,guidanceLevels,workTypes" },
        }),
    ],
    ["analytics.mcp", () => apiRequest(ctx, { endpoint: "/analytics/team/mcp", query: range })],
    ["analytics.commands", () => apiRequest(ctx, { endpoint: "/analytics/team/commands", query: range })],
    ["analytics.skills", () => apiRequest(ctx, { endpoint: "/analytics/team/skills", query: range })],
    ["analytics.plans", () => apiRequest(ctx, { endpoint: "/analytics/team/plans", query: range })],
    ["analytics.askMode", () => apiRequest(ctx, { endpoint: "/analytics/team/ask-mode", query: range })],
    [
      "analytics.leaderboard",
      () => apiRequest(ctx, { endpoint: "/analytics/team/leaderboard", query: { ...range, pageSize: 10 } }),
    ],
    ["analytics.clientVersions", () => apiRequest(ctx, { endpoint: "/analytics/team/client-versions", query: range })],
    ["analytics.topExtensions", () => apiRequest(ctx, { endpoint: "/analytics/team/top-file-extensions", query: range })],
    [
      "analytics.bugbot",
      () => apiRequest(ctx, { endpoint: "/analytics/team/bugbot", query: { ...range, prState: "all", pageSize: 250 } }),
    ],
    ["aiCode.commits", () => fetchAiCommits(ctx)],
    ["admin.members", () => apiRequest(ctx, { endpoint: "/teams/members" })],
    ["admin.spend", () => apiRequest(ctx, { method: "POST", endpoint: "/teams/spend", body: { page: 1, pageSize: 500 } })],
  ];

  // Run sequentially with a small delay: total ~19 requests, comfortably under
  // the per-minute limits (analytics 100/min, conversation-insights 20/min,
  // ai-code 20/min, admin 20/min) even when launchd retries.
  for (const [id, run] of jobs) {
    try {
      raw[id] = await run();
      sources.push(sourceRecord(id, isEmptyPayload(raw[id]) ? "empty" : "ok"));
    } catch (e) {
      raw[id] = null;
      sources.push(sourceRecord(id, "error", describeApiError(id, e)));
    }
    await sleep(150);
  }
  return { raw, sources };
}

function isEmptyPayload(json) {
  if (!json) return true;
  if (Array.isArray(json.data)) return json.data.length === 0;
  if (Array.isArray(json.items)) return json.items.length === 0;
  return false;
}

async function fetchAiCommits(ctx) {
  const items = [];
  let totalCount = null;
  for (let page = 1; page <= 5; page++) {
    const json = await apiRequest(ctx, {
      endpoint: "/analytics/ai-code/commits",
      query: { startDate: ctx.startDate, endDate: "now", page, pageSize: 1000 },
    });
    const batch = json?.items ?? [];
    items.push(...batch);
    totalCount = json?.totalCount ?? totalCount;
    if (batch.length < 1000) break;
  }
  return { items, totalCount };
}

function describeApiError(id, e) {
  const msg = String(e.message || e);
  if (/Invalid Team API Key/i.test(msg)) {
    return "401 Invalid Team API Key — the key is not an admin-scoped team key. Create one with admin:* scope in cursor.com/dashboard -> API Keys (Enterprise team).";
  }
  if (/missing required scope/i.test(msg)) {
    return `401 — key is a team key but lacks the required scope (${msg}).`;
  }
  if (id === "analytics.conversationInsights" && e.status === 401) {
    return "401 — Conversation Insights may be disabled in team settings, or the key lacks access.";
  }
  if (id === "aiCode.commits" && (e.status === 401 || e.status === 403 || e.status === 404)) {
    return `${e.status ?? ""} — AI Code Tracking is Enterprise alpha; ask your Cursor contact to enable it. (${msg})`;
  }
  return msg.slice(0, 240);
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function sum(xs) {
  return xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

function round(x, digits = 1) {
  if (!Number.isFinite(x)) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function pct(part, whole, digits = 1) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return round((part / whole) * 100, digits);
}

/** Pearson correlation over paired finite values. Returns null when undefined. */
function pearson(pairs) {
  const clean = pairs.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = clean.length;
  if (n < 8) return null;
  const mx = sum(clean.map((p) => p[0])) / n;
  const my = sum(clean.map((p) => p[1])) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (const [x, y] of clean) {
    cov += (x - mx) * (y - my);
    vx += (x - mx) ** 2;
    vy += (y - my) ** 2;
  }
  if (vx === 0 || vy === 0) return null;
  return { r: cov / Math.sqrt(vx * vy), n };
}

function last7Prior7(dailyValues) {
  const vals = dailyValues.filter((v) => Number.isFinite(v));
  if (dailyValues.length < 14) return null;
  const last7 = sum(dailyValues.slice(-7));
  const prior7 = sum(dailyValues.slice(-14, -7));
  if (vals.length === 0) return null;
  return { last7, prior7 };
}

// ---------------------------------------------------------------------------
// Transforms: raw API responses -> dashboard payload
// ---------------------------------------------------------------------------

function buildDashboard(raw, sources, ctx) {
  const dates = eachDate(ctx.startDate, ctx.endDate);
  const byDate = new Map(
    dates.map((date) => [
      date,
      {
        date,
        label: shortLabel(date),
        dau: null,
        cliDau: null,
        cloudAgentDau: null,
        bugbotDau: null,
        agentSuggested: null,
        agentAccepted: null,
        tabSuggestions: null,
        tabAccepts: null,
        messages: null,
        aiCommitLines: null,
        totalCommitLines: null,
      },
    ]),
  );

  // --- DAU ---
  for (const row of raw["analytics.dau"]?.data ?? []) {
    const d = byDate.get(row.date);
    if (!d) continue;
    d.dau = row.dau ?? null;
    d.cliDau = row.cli_dau ?? null;
    d.cloudAgentDau = row.cloud_agent_dau ?? null;
    d.bugbotDau = row.bugbot_dau ?? null;
  }

  // --- Agent edits ---
  for (const row of raw["analytics.agentEdits"]?.data ?? []) {
    const d = byDate.get(row.event_date);
    if (!d) continue;
    d.agentSuggested = row.total_lines_suggested ?? null;
    d.agentAccepted = row.total_lines_accepted ?? null;
  }

  // --- Tabs ---
  for (const row of raw["analytics.tabs"]?.data ?? []) {
    const d = byDate.get(row.event_date);
    if (!d) continue;
    d.tabSuggestions = row.total_suggestions ?? null;
    d.tabAccepts = row.total_accepts ?? null;
  }

  // --- Models ---
  const modelDaily = new Map(); // model -> Map(date -> messages)
  const modelUsersPeak = new Map();
  for (const row of raw["analytics.models"]?.data ?? []) {
    const date = row.date;
    const d = byDate.get(date);
    let dayTotal = 0;
    for (const [model, stats] of Object.entries(row.model_breakdown ?? {})) {
      const messages = stats?.messages ?? 0;
      dayTotal += messages;
      if (!modelDaily.has(model)) modelDaily.set(model, new Map());
      modelDaily.get(model).set(date, (modelDaily.get(model).get(date) ?? 0) + messages);
      modelUsersPeak.set(model, Math.max(modelUsersPeak.get(model) ?? 0, stats?.users ?? 0));
    }
    if (d) d.messages = (d.messages ?? 0) + dayTotal;
  }
  const models = buildModels(modelDaily, modelUsersPeak, dates);

  // --- Conversation Insights ---
  const conversationInsights = buildConversationInsights(raw["analytics.conversationInsights"]);

  // --- AI code (git level) ---
  const aiCode = buildAiCode(raw["aiCode.commits"], byDate, ctx);

  const daily = dates.map((d) => byDate.get(d));

  // --- KPIs ---
  const dauSeries = daily.map((d) => d.dau);
  const dauWindow = last7Prior7(dauSeries.map((v) => v ?? 0));
  const agentSuggested30d = sum(daily.map((d) => d.agentSuggested ?? 0));
  const agentAccepted30d = sum(daily.map((d) => d.agentAccepted ?? 0));
  const acceptDelta = acceptanceWoW(daily);
  const tabSuggestions30d = sum(daily.map((d) => d.tabSuggestions ?? 0));
  const tabAccepts30d = sum(daily.map((d) => d.tabAccepts ?? 0));
  const latestDau = [...daily].reverse().find((d) => Number.isFinite(d.dau))?.dau ?? null;

  const kpis = {
    dauLatest: latestDau,
    dauAvg7: dauWindow ? round(dauWindow.last7 / 7, 1) : null,
    dauWoWPct: dauWindow && dauWindow.prior7 > 0 ? round(((dauWindow.last7 - dauWindow.prior7) / dauWindow.prior7) * 100, 1) : null,
    agentLinesAccepted: agentAccepted30d || null,
    agentAcceptRatePct: pct(agentAccepted30d, agentSuggested30d),
    agentAcceptRateWoWPts: acceptDelta,
    tabAcceptRatePct: pct(tabAccepts30d, tabSuggestions30d),
    tabAccepts: tabAccepts30d || null,
    aiMessages: models ? sum(models.totals.map((m) => m.messages)) : null,
    conversations: conversationInsights?.totalConversations ?? null,
    aiCommitSharePct: aiCode?.aiSharePct ?? null,
    spendCycleDollars: null, // filled below from spend
  };

  // --- Adoption ---
  const adoption = buildAdoption(raw);

  // --- People ---
  const people = buildPeople(raw, ctx);

  // --- Spend ---
  const spend = buildSpend(raw["admin.spend"], ctx);
  if (spend) kpis.spendCycleDollars = spend.totalDollars;

  // --- Team ---
  const memberRows = raw["admin.members"]?.teamMembers ?? null;
  const team = {
    memberCount: memberRows ? memberRows.filter((m) => !m.isRemoved).length : null,
    dauPeak: Math.max(0, ...daily.map((d) => d.dau ?? 0)) || null,
  };

  // --- File extensions ---
  const fileExtensions = buildFileExtensions(raw["analytics.topExtensions"]);

  // --- Bugbot ---
  const bugbot = buildBugbot(raw["analytics.bugbot"]);

  // --- Correlations + insights ---
  const correlations = buildCorrelations(daily, conversationInsights, aiCode);
  const insights = buildInsights({
    models,
    conversationInsights,
    aiCode,
    kpis,
    correlations,
    adoption,
    bugbot,
    daily,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: ctx.generatedAt,
    sampleMode: Boolean(ctx.sampleMode),
    anonymized: Boolean(ctx.anonymize),
    window: { days: ctx.windowDays, startDate: ctx.startDate, endDate: ctx.endDate },
    team,
    sources,
    kpis,
    daily,
    models,
    conversationInsights,
    aiCode,
    adoption,
    people,
    fileExtensions,
    spend,
    bugbot,
    correlations,
    insights,
  };
}

function acceptanceWoW(daily) {
  const rate = (rows) => {
    const s = sum(rows.map((d) => d.agentSuggested ?? 0));
    const a = sum(rows.map((d) => d.agentAccepted ?? 0));
    return s > 0 ? (a / s) * 100 : null;
  };
  if (daily.length < 14) return null;
  const cur = rate(daily.slice(-7));
  const prev = rate(daily.slice(-14, -7));
  if (cur === null || prev === null) return null;
  return round(cur - prev, 1);
}

function buildModels(modelDaily, modelUsersPeak, dates) {
  if (modelDaily.size === 0) return null;
  const totals = [...modelDaily.entries()]
    .map(([model, perDate]) => ({ model, messages: sum([...perDate.values()]), peakDailyUsers: modelUsersPeak.get(model) ?? null }))
    .sort((a, b) => b.messages - a.messages);
  const grand = sum(totals.map((t) => t.messages));
  for (const t of totals) t.sharePct = pct(t.messages, grand);

  // Weekly stacked series: top 5 models + Other
  const top = totals.slice(0, 5).map((t) => t.model);
  const weeks = [...new Set(dates.map(mondayOf))];
  const weekIndex = new Map(weeks.map((w, i) => [w, i]));
  const seriesMap = new Map(top.map((m) => [m, new Array(weeks.length).fill(0)]));
  const other = new Array(weeks.length).fill(0);
  for (const [model, perDate] of modelDaily.entries()) {
    for (const [date, messages] of perDate.entries()) {
      const wi = weekIndex.get(mondayOf(date));
      if (wi === undefined) continue;
      if (seriesMap.has(model)) seriesMap.get(model)[wi] += messages;
      else other[wi] += messages;
    }
  }
  const weekly = {
    categories: weeks.map((w) => `Wk ${shortLabel(w)}`),
    series: [
      ...[...seriesMap.entries()].map(([name, data]) => ({ name, data })),
      ...(sum(other) > 0 ? [{ name: "Other", data: other }] : []),
    ],
  };

  // Rising model: last 7 days vs prior 7 days
  const lastDates = new Set(dates.slice(-7));
  const priorDates = new Set(dates.slice(-14, -7));
  let rising = null;
  for (const [model, perDate] of modelDaily.entries()) {
    let cur = 0;
    let prev = 0;
    for (const [date, m] of perDate.entries()) {
      if (lastDates.has(date)) cur += m;
      if (priorDates.has(date)) prev += m;
    }
    if (prev >= 25 && cur > prev) {
      const growthPct = round(((cur - prev) / prev) * 100, 1);
      if (!rising || growthPct > rising.growthPct) rising = { model, growthPct, prevMessages: prev, currMessages: cur };
    }
  }

  return {
    totals: totals.slice(0, 8),
    otherMessages: sum(totals.slice(8).map((t) => t.messages)) || 0,
    weekly,
    topModel: totals[0] ? { model: totals[0].model, sharePct: totals[0].sharePct } : null,
    rising,
  };
}

function buildConversationInsights(json) {
  const data = json?.data;
  if (!data) return null;
  const dist = (slice, key) =>
    (data[slice]?.distribution ?? [])
      .map((row) => ({ label: String(row[key] ?? "unknown"), count: row.count ?? 0 }))
      .sort((a, b) => b.count - a.count);

  const intents = dist("intents", "intent");
  const complexity = dist("complexity", "complexity");
  const categories = dist("categories", "category");
  const guidanceLevels = dist("guidanceLevels", "guidanceLevel");
  const workTypes = dist("workTypes", "workType");

  // Daily high-complexity share from the complexity time series (for correlation).
  const complexityByDate = new Map();
  for (const row of data.complexity?.timeSeries ?? []) {
    if (!complexityByDate.has(row.date)) complexityByDate.set(row.date, { high: 0, total: 0 });
    const bucket = complexityByDate.get(row.date);
    bucket.total += row.count ?? 0;
    if (String(row.complexity).toLowerCase() === "high") bucket.high += row.count ?? 0;
  }
  const complexityDaily = [...complexityByDate.entries()]
    .map(([date, { high, total }]) => ({ date, highSharePct: pct(high, total), total }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Weekly work type mix for the normalized stacked chart.
  const wtWeeks = new Map(); // week -> Map(workType -> count)
  for (const row of data.workTypes?.timeSeries ?? []) {
    const wk = mondayOf(row.date);
    if (!wtWeeks.has(wk)) wtWeeks.set(wk, new Map());
    const m = wtWeeks.get(wk);
    m.set(row.workType, (m.get(row.workType) ?? 0) + (row.count ?? 0));
  }
  let workTypesWeekly = null;
  if (wtWeeks.size >= 2) {
    const weeks = [...wtWeeks.keys()].sort();
    const names = workTypes.slice(0, 5).map((w) => w.label);
    workTypesWeekly = {
      categories: weeks.map((w) => `Wk ${shortLabel(w)}`),
      series: names.map((name) => ({
        name: humanizeToken(name),
        data: weeks.map((w) => wtWeeks.get(w).get(name) ?? 0),
      })),
    };
  }

  const subs = data.intents?.subcategories ?? null;
  const subTop = (rows) =>
    (rows ?? [])
      .slice()
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, 4)
      .map((r) => ({ label: humanizeToken(r.subcategory), count: r.count ?? 0 }));

  return {
    totalConversations: sum(intents.map((i) => i.count)),
    intents,
    complexity,
    categories,
    guidanceLevels,
    workTypes: workTypes.map((w) => ({ ...w, label: humanizeToken(w.label) })),
    workTypesWeekly,
    complexityDaily,
    subcategories: subs
      ? { askMode: subTop(subs.askMode), planMode: subTop(subs.planMode), writeCode: subTop(subs.writeCode) }
      : null,
  };
}

function humanizeToken(s) {
  return String(s)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildAiCode(commitsJson, byDate, ctx) {
  const items = commitsJson?.items ?? null;
  if (!items || items.length === 0) return null;
  let totalAdded = 0;
  let tabAdded = 0;
  let composerAdded = 0;
  let primaryTotal = 0;
  let primaryAi = 0;
  const bySource = new Map();
  const byRepo = new Map();
  for (const c of items) {
    const total = c.totalLinesAdded ?? 0;
    const ai = (c.tabLinesAdded ?? 0) + (c.composerLinesAdded ?? 0);
    totalAdded += total;
    tabAdded += c.tabLinesAdded ?? 0;
    composerAdded += c.composerLinesAdded ?? 0;
    if (c.isPrimaryBranch) {
      primaryTotal += total;
      primaryAi += ai;
    }
    const src = c.commitSource ?? "unknown";
    if (!bySource.has(src)) bySource.set(src, { commits: 0, total: 0, ai: 0 });
    const s = bySource.get(src);
    s.commits += 1;
    s.total += total;
    s.ai += ai;
    const repo = c.repoName ?? "(unknown repo)";
    if (!byRepo.has(repo)) byRepo.set(repo, { commits: 0, total: 0, ai: 0 });
    const r = byRepo.get(repo);
    r.commits += 1;
    r.total += total;
    r.ai += ai;

    const date = (c.commitTs ?? c.createdAt ?? "").slice(0, 10);
    const d = byDate.get(date);
    if (d) {
      d.aiCommitLines = (d.aiCommitLines ?? 0) + ai;
      d.totalCommitLines = (d.totalCommitLines ?? 0) + total;
    }
  }
  const aiAdded = tabAdded + composerAdded;
  return {
    commitsAnalyzed: items.length,
    totalCountReported: commitsJson.totalCount ?? items.length,
    totalLinesAdded: totalAdded,
    aiLinesAdded: aiAdded,
    tabLinesAdded: tabAdded,
    composerLinesAdded: composerAdded,
    nonAiLinesAdded: Math.max(0, totalAdded - aiAdded),
    aiSharePct: pct(aiAdded, totalAdded),
    primaryBranchAiSharePct: pct(primaryAi, primaryTotal),
    bySource: [...bySource.entries()]
      .map(([source, s]) => ({ source, commits: s.commits, linesAdded: s.total, aiSharePct: pct(s.ai, s.total) }))
      .sort((a, b) => b.commits - a.commits),
    topRepos: [...byRepo.entries()]
      .map(([repo, r]) => ({ repo, commits: r.commits, linesAdded: r.total, aiSharePct: pct(r.ai, r.total) }))
      .sort((a, b) => b.linesAdded - a.linesAdded)
      .slice(0, 5),
  };
}

function buildAdoption(raw) {
  const aggregate = (rows, keyFields, usageField = "usage") => {
    const m = new Map();
    for (const row of rows ?? []) {
      const key = keyFields.map((f) => row[f] ?? "?").join("\u0000");
      m.set(key, (m.get(key) ?? 0) + (row[usageField] ?? 0));
    }
    return [...m.entries()]
      .map(([key, usage]) => {
        const parts = key.split("\u0000");
        return { parts, usage };
      })
      .sort((a, b) => b.usage - a.usage);
  };

  const mcpRows = aggregate(raw["analytics.mcp"]?.data, ["mcp_server_name", "tool_name"]);
  const commandRows = aggregate(raw["analytics.commands"]?.data, ["command_name"]);
  const skillRows = aggregate(raw["analytics.skills"]?.data, ["skill_name"]);
  const planUsage = sum((raw["analytics.plans"]?.data ?? []).map((r) => r.usage ?? 0));
  const askUsage = sum((raw["analytics.askMode"]?.data ?? []).map((r) => r.usage ?? 0));

  const present = mcpRows.length > 0 || commandRows.length > 0 || skillRows.length > 0 || planUsage > 0 || askUsage > 0;
  if (!present) return null;
  return {
    mcpTop: mcpRows.slice(0, 8).map(({ parts, usage }) => ({ server: parts[0], tool: parts[1], usage })),
    mcpTotal: sum(mcpRows.map((r) => r.usage)),
    mcpServers: new Set(mcpRows.map((r) => r.parts[0])).size,
    commandsTop: commandRows.slice(0, 6).map(({ parts, usage }) => ({ name: parts[0], usage })),
    skillsTop: skillRows.slice(0, 6).map(({ parts, usage }) => ({ name: parts[0], usage })),
    planUsage: planUsage || null,
    askUsage: askUsage || null,
  };
}

function anonymizeName(index) {
  return `Engineer ${String(index + 1).padStart(2, "0")}`;
}

function buildPeople(raw, ctx) {
  const lb = raw["analytics.leaderboard"]?.data?.agent_leaderboard;
  const leaderboard = (lb?.data ?? []).map((row, i) => ({
    rank: row.rank ?? i + 1,
    name: ctx.anonymize ? anonymizeName(i) : row.email ?? `user ${i + 1}`,
    linesAccepted: row.total_lines_accepted ?? 0,
    linesSuggested: row.total_lines_suggested ?? 0,
    acceptRatePct: pct(row.total_lines_accepted, row.total_lines_suggested),
  }));

  const cvRows = raw["analytics.clientVersions"]?.data ?? [];
  let clientVersions = [];
  if (cvRows.length > 0) {
    const latestDate = cvRows.map((r) => r.event_date).sort().at(-1);
    clientVersions = cvRows
      .filter((r) => r.event_date === latestDate)
      .map((r) => ({ version: r.client_version, users: r.user_count ?? 0 }))
      .sort((a, b) => b.users - a.users)
      .slice(0, 5);
  }

  if (leaderboard.length === 0 && clientVersions.length === 0) return null;
  return {
    leaderboard: leaderboard.slice(0, 8),
    totalUsers: lb?.total_users ?? null,
    clientVersions,
  };
}

function buildSpend(json, ctx) {
  const rows = json?.teamMemberSpend;
  if (!rows) return null;
  const overallCents = sum(rows.map((r) => r.overallSpendCents ?? 0));
  const onDemandCents = sum(rows.map((r) => r.spendCents ?? 0));
  const sorted = rows.slice().sort((a, b) => (b.overallSpendCents ?? 0) - (a.overallSpendCents ?? 0));
  return {
    cycleStartDate: json.subscriptionCycleStart ? utcDateString(new Date(json.subscriptionCycleStart)) : null,
    totalDollars: round(overallCents / 100, 2),
    onDemandDollars: round(onDemandCents / 100, 2),
    members: json.totalMembers ?? rows.length,
    topSpenders: sorted.slice(0, 3).map((r, i) => ({
      name: ctx.anonymize ? anonymizeName(i) : r.email ?? r.name ?? `user ${i + 1}`,
      dollars: round((r.overallSpendCents ?? 0) / 100, 2),
    })),
  };
}

function buildFileExtensions(json) {
  const rows = json?.data ?? [];
  if (rows.length === 0) return null;
  const m = new Map();
  for (const r of rows) {
    const ext = r.file_extension ?? "?";
    m.set(ext, (m.get(ext) ?? 0) + (r.total_lines_accepted ?? 0));
  }
  const totals = [...m.entries()].map(([ext, lines]) => ({ ext, linesAccepted: lines })).sort((a, b) => b.linesAccepted - a.linesAccepted);
  const grand = sum(totals.map((t) => t.linesAccepted));
  return totals.slice(0, 6).map((t) => ({ ...t, sharePct: pct(t.linesAccepted, grand) }));
}

function buildBugbot(json) {
  const rows = json?.data ?? [];
  if (rows.length === 0) return null;
  let issues = 0;
  let resolved = 0;
  let high = 0;
  let reviews = 0;
  for (const r of rows) {
    reviews += r.reviews ?? 0;
    issues += r.issues?.total ?? 0;
    resolved += r.issues_resolved?.total ?? 0;
    high += r.issues?.by_severity?.high ?? 0;
  }
  return {
    prsReviewed: rows.length,
    reviews,
    issuesFound: issues,
    issuesResolved: resolved,
    resolvedRatePct: pct(resolved, issues),
    highSeverity: high,
    truncated: Boolean(json?.pagination?.hasNextPage),
  };
}

// ---------------------------------------------------------------------------
// Correlations + narrative insights (only from computed real values)
// ---------------------------------------------------------------------------

function strengthOf(r) {
  const a = Math.abs(r);
  if (a >= 0.5) return "strong";
  if (a >= 0.25) return "moderate";
  return "weak";
}

function buildCorrelations(daily, ci, aiCode) {
  const out = [];
  const push = (id, label, pairs, interpretation) => {
    const res = pearson(pairs);
    if (!res) return;
    const r = round(res.r, 2);
    out.push({
      id,
      label,
      r,
      n: res.n,
      strength: strengthOf(r),
      direction: r >= 0 ? "positive" : "negative",
      interpretation: interpretation(r, res.n),
    });
  };

  push(
    "dau-output",
    "Active developers vs accepted AI lines (daily)",
    daily.map((d) => [d.dau, d.agentAccepted]),
    (r) =>
      r >= 0.25
        ? `More developers online means proportionally more shipped AI output (r=${r}) — adoption is converting into work, not idle seats.`
        : `Accepted output does not simply track headcount (r=${r}); a subset of power users drives most volume.`,
  );

  push(
    "tab-agent",
    "Tab accepts vs agent lines accepted (daily)",
    daily.map((d) => [d.tabAccepts, d.agentAccepted]),
    (r) =>
      r >= 0.25
        ? `Tab and Agent usage rise together (r=${r}) — developers lean on both, they are complements rather than substitutes.`
        : `Tab and Agent usage move independently (r=${r}) — different workflows or different users.`,
  );

  push(
    "messages-output",
    "Agent messages vs accepted lines (daily)",
    daily.map((d) => [d.messages, d.agentAccepted]),
    (r) =>
      r >= 0.25
        ? `Conversation volume converts to accepted code (r=${r}); prompting effort is paying off.`
        : `More messages did not linearly produce more accepted code (r=${r}) — sessions vary a lot in yield.`,
  );

  if (ci?.complexityDaily?.length >= 8) {
    const rateByDate = new Map(
      daily
        .filter((d) => (d.agentSuggested ?? 0) > 0)
        .map((d) => [d.date, (d.agentAccepted / d.agentSuggested) * 100]),
    );
    push(
      "complexity-acceptance",
      "High-complexity conversation share vs agent acceptance rate (daily)",
      ci.complexityDaily.filter((c) => c.total >= 3).map((c) => [c.highSharePct, rateByDate.get(c.date)]),
      (r) =>
        r >= 0.25
          ? `Acceptance holds up — even rises — on high-complexity days (r=${r}); the team trusts agents with hard work.`
          : r <= -0.25
            ? `Acceptance dips on high-complexity days (r=${r}); complex tasks still need more review and iteration.`
            : `Acceptance is stable regardless of task complexity (r=${r}) — output quality is consistent.`,
    );
  }

  if (aiCode) {
    push(
      "accept-ship",
      "Accepted AI lines vs AI lines landing in commits (daily)",
      daily.map((d) => [d.agentAccepted, d.aiCommitLines]),
      (r) =>
        r >= 0.25
          ? `Accepted suggestions flow into committed code the same day (r=${r}) — a tight suggestion-to-ship loop.`
          : `Commits lag acceptance (r=${r}); AI output ships in batches rather than same-day.`,
    );
  }

  return out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

function buildInsights({ models, conversationInsights: ci, aiCode, kpis, correlations, adoption, bugbot, daily }) {
  const out = [];
  const fmtK = (n) => (n >= 1000 ? `${round(n / 1000, n >= 10000 ? 0 : 1)}k` : String(n));

  if (aiCode?.aiSharePct != null) {
    out.push({
      tone: "success",
      title: `${aiCode.aiSharePct}% of committed code was AI-written`,
      detail: `Across ${aiCode.commitsAnalyzed.toLocaleString()} commits in the window, ${fmtK(aiCode.aiLinesAdded)} of ${fmtK(aiCode.totalLinesAdded)} added lines came from Tab or Agent${aiCode.primaryBranchAiSharePct != null ? `; on primary branches the AI share is ${aiCode.primaryBranchAiSharePct}%` : ""}. Source: AI Code Tracking API.`,
    });
  }

  if (kpis.agentAcceptRatePct != null && kpis.agentAcceptRateWoWPts != null) {
    const up = kpis.agentAcceptRateWoWPts >= 0;
    if (Math.abs(kpis.agentAcceptRateWoWPts) >= 1) {
      out.push({
        tone: up ? "success" : "warning",
        title: `Agent acceptance ${up ? "climbed" : "slipped"} ${Math.abs(kpis.agentAcceptRateWoWPts)} pts week-over-week`,
        detail: `Line-level acceptance is ${kpis.agentAcceptRatePct}% over the window (${fmtK(kpis.agentLinesAccepted ?? 0)} lines accepted). ${up ? "Suggestions are landing with less rework." : "Worth reviewing which tasks or models drove the dip."}`,
      });
    }
  }

  if (ci) {
    const high = ci.complexity.find((c) => c.label.toLowerCase() === "high");
    const totalCx = sum(ci.complexity.map((c) => c.count));
    const highShare = pct(high?.count ?? 0, totalCx);
    if (highShare != null && totalCx >= 10) {
      out.push({
        tone: highShare >= 30 ? "success" : "info",
        title:
          highShare >= 30
            ? `Teams delegate real work: ${highShare}% of conversations are high-complexity`
            : `${highShare}% of conversations are high-complexity`,
        detail: `Conversation Insights classified ${ci.totalConversations.toLocaleString()} agent conversations on-device. ${highShare >= 30 ? "Agents are handling substantive engineering tasks, not just boilerplate." : "Most sessions are quick tasks — headroom to delegate bigger work."}`,
      });
    }
    const low = ci.guidanceLevels.find((g) => g.label.toLowerCase() === "low");
    const totalG = sum(ci.guidanceLevels.map((g) => g.count));
    const lowShare = pct(low?.count ?? 0, totalG);
    if (lowShare != null && lowShare >= 35) {
      out.push({
        tone: "info",
        title: `${lowShare}% of work ran with low guidance`,
        detail: `Developers increasingly hand agents a goal instead of step-by-step instructions — a marker of trust and of prompt maturity.`,
      });
    }
    const topCat = ci.categories[0];
    const totalCat = sum(ci.categories.map((c) => c.count));
    if (topCat && totalCat > 0) {
      out.push({
        tone: "neutral",
        title: `Work mix skews to ${topCat.label}`,
        detail: `${pct(topCat.count, totalCat)}% of classified work segments fall under ${topCat.label}${ci.categories[1] ? `, followed by ${ci.categories[1].label} at ${pct(ci.categories[1].count, totalCat)}%` : ""}.`,
      });
    }
  }

  if (models?.topModel) {
    const risingTxt = models.rising
      ? ` ${models.rising.model} is the fastest riser, up ${models.rising.growthPct}% week-over-week (${models.rising.prevMessages.toLocaleString()} to ${models.rising.currMessages.toLocaleString()} messages).`
      : "";
    out.push({
      tone: "info",
      title: `${models.topModel.model} carries ${models.topModel.sharePct}% of agent messages`,
      detail: `Model mix across ${fmtK(kpis.aiMessages ?? 0)} messages in the window.${risingTxt}`,
    });
  }

  const strongest = correlations.find((c) => c.strength !== "weak");
  if (strongest) {
    out.push({
      tone: "info",
      title: `Correlated: ${strongest.label}`,
      detail: `${strongest.interpretation} (r=${strongest.r}, n=${strongest.n} days; correlation, not causation.)`,
    });
  }

  if (kpis.dauWoWPct != null && Math.abs(kpis.dauWoWPct) >= 5) {
    const up = kpis.dauWoWPct > 0;
    out.push({
      tone: up ? "success" : "warning",
      title: `Active developers ${up ? "up" : "down"} ${Math.abs(kpis.dauWoWPct)}% week-over-week`,
      detail: `Latest DAU is ${kpis.dauLatest}; 7-day average ${kpis.dauAvg7}.`,
    });
  }

  if (adoption?.mcpTotal > 0) {
    const top = adoption.mcpTop[0];
    out.push({
      tone: "neutral",
      title: `${adoption.mcpTotal.toLocaleString()} MCP tool calls across ${adoption.mcpServers} servers`,
      detail: top ? `Most-used: ${top.server} / ${top.tool} (${top.usage.toLocaleString()} calls). Agents are wired into the team's real systems.` : "",
    });
  }

  if (bugbot?.resolvedRatePct != null) {
    out.push({
      tone: bugbot.resolvedRatePct >= 50 ? "success" : "info",
      title: `Bugbot: ${bugbot.issuesFound} issues flagged, ${bugbot.resolvedRatePct}% resolved`,
      detail: `${bugbot.prsReviewed} PRs reviewed in the window; ${bugbot.highSeverity} high-severity findings.`,
    });
  }

  return out.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Sample data (clearly labeled; used with --sample for customer-safe demos)
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleRaw(ctx) {
  const rnd = mulberry32(20260716);
  const dates = eachDate(ctx.startDate, ctx.endDate);
  const nDates = dates.length;
  const weekday = (date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  const modelsList = [
    { name: "claude-fable-5", base: 0.42, drift: +0.004 },
    { name: "gpt-5.6-sol", base: 0.24, drift: -0.001 },
    { name: "composer-2.5", base: 0.15, drift: 0 },
    { name: "claude-opus-4.8", base: 0.11, drift: -0.002 },
    { name: "grok-4.5", base: 0.05, drift: -0.001 },
    { name: "gpt-5.3-codex", base: 0.03, drift: 0 },
  ];

  const dau = { data: [] };
  const models = { data: [] };
  const agentEdits = { data: [] };
  const tabs = { data: [] };
  const mcp = { data: [] };
  const commands = { data: [] };
  const skills = { data: [] };
  const plans = { data: [] };
  const askMode = { data: [] };
  const ciComplexityTs = [];
  const ciWorkTs = [];
  const aiCommitItems = [];

  const mcpTools = [
    ["linear", "create_issue"],
    ["linear", "search_issues"],
    ["slack", "send_message"],
    ["datadog", "query_metrics"],
    ["github", "get_pull_request"],
    ["notion", "search"],
    ["stripe", "list_invoices"],
  ];
  const workTypes = ["new_feature", "bug", "refactor", "ktlo", "docs"];

  dates.forEach((date, i) => {
    const wd = weekday(date);
    const trend = 1 + (i / nDates) * 0.25; // gentle adoption growth
    const dauVal = Math.round((wd ? 26 : 9) * trend + rnd() * 5);
    dau.data.push({
      date,
      dau: dauVal,
      cli_dau: Math.round(dauVal * (0.12 + rnd() * 0.05)),
      cloud_agent_dau: Math.round(dauVal * (0.3 + rnd() * 0.1)),
      bugbot_dau: Math.round(dauVal * (0.2 + rnd() * 0.08)),
    });

    const dayMessages = Math.round((wd ? 1450 : 420) * trend * (0.9 + rnd() * 0.25));
    const breakdown = {};
    modelsList.forEach((m) => {
      const share = Math.max(0.01, m.base + m.drift * i + (rnd() - 0.5) * 0.02);
      breakdown[m.name] = {
        messages: Math.round(dayMessages * share),
        users: Math.max(1, Math.round(dauVal * share * 1.6)),
      };
    });
    models.data.push({ date, model_breakdown: breakdown });

    const suggested = Math.round((wd ? 30500 : 8200) * trend * (0.85 + rnd() * 0.35));
    const acceptRate = 0.4 + (i / nDates) * 0.06 + (rnd() - 0.5) * 0.05;
    agentEdits.data.push({
      event_date: date,
      total_lines_suggested: suggested,
      total_lines_accepted: Math.round(suggested * acceptRate),
      total_suggested_diffs: Math.round(suggested / 90),
      total_accepted_diffs: Math.round((suggested / 90) * (acceptRate + 0.12)),
    });

    const tabSuggested = Math.round((wd ? 6200 : 1900) * trend * (0.85 + rnd() * 0.3));
    tabs.data.push({
      event_date: date,
      total_suggestions: tabSuggested,
      total_accepts: Math.round(tabSuggested * (0.29 + rnd() * 0.05)),
    });

    if (wd) {
      for (const [server, tool] of mcpTools) {
        if (rnd() < 0.75) mcp.data.push({ event_date: date, mcp_server_name: server, tool_name: tool, usage: Math.round(4 + rnd() * 40 * trend) });
      }
      commands.data.push({ event_date: date, command_name: "deploy-all", usage: Math.round(2 + rnd() * 7) });
      commands.data.push({ event_date: date, command_name: "refresh-analytics", usage: Math.round(1 + rnd() * 3) });
      skills.data.push({ event_date: date, skill_name: "typescript-best-practices", usage: Math.round(3 + rnd() * 9) });
      skills.data.push({ event_date: date, skill_name: "hex-to-canvas", usage: Math.round(1 + rnd() * 4) });
      plans.data.push({ event_date: date, model: "claude-fable-5", usage: Math.round(8 + rnd() * 14) });
      askMode.data.push({ event_date: date, model: "default", usage: Math.round(12 + rnd() * 22) });
    }

    const convs = Math.round((wd ? 46 : 12) * trend * (0.9 + rnd() * 0.2));
    const highShare = 0.3 + (i / nDates) * 0.1 + (rnd() - 0.5) * 0.06;
    ciComplexityTs.push({ date, complexity: "high", count: Math.round(convs * highShare) });
    ciComplexityTs.push({ date, complexity: "medium", count: Math.round(convs * 0.42) });
    ciComplexityTs.push({ date, complexity: "low", count: Math.max(0, convs - Math.round(convs * highShare) - Math.round(convs * 0.42)) });
    workTypes.forEach((wt, wi) => {
      ciWorkTs.push({ date, workType: wt, count: Math.round(convs * [0.34, 0.27, 0.17, 0.13, 0.09][wi] * (0.8 + rnd() * 0.4)) });
    });

    const commitsToday = wd ? 6 + Math.floor(rnd() * 8) : Math.floor(rnd() * 3);
    for (let c = 0; c < commitsToday; c++) {
      const total = Math.round(40 + rnd() * 480);
      const aiShare = 0.34 + (i / nDates) * 0.1 + (rnd() - 0.5) * 0.18;
      const ai = Math.round(total * Math.min(0.85, Math.max(0.05, aiShare)));
      const tab = Math.round(ai * 0.35);
      aiCommitItems.push({
        commitHash: `sample${i}_${c}`,
        userEmail: `dev${1 + Math.floor(rnd() * 9)}@sample.dev`,
        repoName: ["acme/platform", "acme/webapp", "acme/infra"][Math.floor(rnd() * 3)],
        branchName: rnd() < 0.6 ? "main" : `feat/sample-${c}`,
        isPrimaryBranch: rnd() < 0.6,
        commitSource: rnd() < 0.68 ? "ide" : rnd() < 0.75 ? "cloud" : "cli",
        totalLinesAdded: total,
        totalLinesDeleted: Math.round(total * 0.4),
        tabLinesAdded: tab,
        tabLinesDeleted: 0,
        composerLinesAdded: ai - tab,
        composerLinesDeleted: 0,
        nonAiLinesAdded: total - ai,
        nonAiLinesDeleted: 0,
        commitTs: `${date}T15:0${c % 10}:00.000Z`,
        createdAt: `${date}T15:0${c % 10}:30.000Z`,
      });
    }
  });

  const sumBy = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const totalConvs = Math.round(sumBy(ciComplexityTs, (r) => r.count));
  const conversationInsights = {
    data: {
      intents: {
        distribution: [
          { intent: "Write Code", count: Math.round(totalConvs * 0.58) },
          { intent: "Ask", count: Math.round(totalConvs * 0.27) },
          { intent: "Plan", count: Math.round(totalConvs * 0.15) },
        ],
        timeSeries: [],
        subcategories: {
          askMode: [
            { subcategory: "error_fix", count: Math.round(totalConvs * 0.09) },
            { subcategory: "code_explanation", count: Math.round(totalConvs * 0.08) },
            { subcategory: "api_usage", count: Math.round(totalConvs * 0.05) },
          ],
          planMode: [
            { subcategory: "implementation", count: Math.round(totalConvs * 0.08) },
            { subcategory: "architecture", count: Math.round(totalConvs * 0.04) },
          ],
          writeCode: [
            { subcategory: "feature", count: Math.round(totalConvs * 0.3) },
            { subcategory: "bug_fix", count: Math.round(totalConvs * 0.16) },
            { subcategory: "refactor", count: Math.round(totalConvs * 0.09) },
          ],
        },
      },
      complexity: {
        distribution: ["high", "medium", "low"].map((label) => ({
          complexity: label,
          count: sumBy(ciComplexityTs.filter((r) => r.complexity === label), (r) => r.count),
        })),
        timeSeries: ciComplexityTs,
      },
      categories: {
        distribution: [
          { category: "New Features", count: Math.round(totalConvs * 0.33) },
          { category: "Bug Fixing & Debugging", count: Math.round(totalConvs * 0.26) },
          { category: "Code Refactoring", count: Math.round(totalConvs * 0.15) },
          { category: "Configuration", count: Math.round(totalConvs * 0.1) },
          { category: "UI/Styling", count: Math.round(totalConvs * 0.09) },
          { category: "Data/Database", count: Math.round(totalConvs * 0.07) },
        ],
        timeSeries: [],
      },
      guidanceLevels: {
        distribution: [
          { guidanceLevel: "low", count: Math.round(totalConvs * 0.41) },
          { guidanceLevel: "medium", count: Math.round(totalConvs * 0.38) },
          { guidanceLevel: "high", count: Math.round(totalConvs * 0.21) },
        ],
        timeSeries: [],
      },
      workTypes: {
        distribution: workTypes.map((wt) => ({
          workType: wt,
          count: sumBy(ciWorkTs.filter((r) => r.workType === wt), (r) => r.count),
        })),
        timeSeries: ciWorkTs,
      },
    },
  };

  const leaderboard = {
    data: {
      agent_leaderboard: {
        data: Array.from({ length: 8 }, (_, i) => {
          const suggested = Math.round(180000 * (1 - i * 0.11) * (0.9 + rnd() * 0.2));
          return {
            email: `dev${i + 1}@sample.dev`,
            total_accepts: Math.round(suggested / 110),
            total_lines_accepted: Math.round(suggested * (0.52 - i * 0.02)),
            total_lines_suggested: suggested,
            rank: i + 1,
          };
        }),
        total_users: 34,
      },
    },
  };

  const clientVersions = {
    data: [
      { event_date: ctx.endDate, client_version: "3.12.1", user_count: 21 },
      { event_date: ctx.endDate, client_version: "3.12.0", user_count: 8 },
      { event_date: ctx.endDate, client_version: "3.11.4", user_count: 5 },
    ],
  };

  const topExtensions = {
    data: ["ts", "tsx", "py", "go", "sql", "md"].flatMap((ext, i) =>
      dates.filter(weekday).map((event_date) => ({
        event_date,
        file_extension: ext,
        total_lines_accepted: Math.round((2600 - i * 380) * (0.8 + rnd() * 0.4)),
      })),
    ),
  };

  const bugbot = {
    data: Array.from({ length: 57 }, () => {
      const issues = Math.floor(rnd() * 6);
      const high = rnd() < 0.25 && issues > 0 ? 1 : 0;
      return {
        repo: "acme/platform",
        pr_number: Math.floor(rnd() * 900),
        reviews: 1 + Math.floor(rnd() * 2),
        issues: { total: issues, by_severity: { high, medium: Math.floor(issues / 2), low: issues - high - Math.floor(issues / 2) } },
        issues_resolved: { total: Math.round(issues * (0.45 + rnd() * 0.3)) },
      };
    }),
    pagination: { hasNextPage: false },
  };

  const members = {
    teamMembers: Array.from({ length: 34 }, (_, i) => ({ id: i + 1, name: `Dev ${i + 1}`, email: `dev${i + 1}@sample.dev`, role: i === 0 ? "owner" : "member", isRemoved: false })),
  };
  const spend = {
    teamMemberSpend: Array.from({ length: 34 }, (_, i) => ({
      email: `dev${i + 1}@sample.dev`,
      name: `Dev ${i + 1}`,
      spendCents: Math.round(1800 + rnd() * 14000),
      overallSpendCents: Math.round(5200 + rnd() * 22000),
    })),
    subscriptionCycleStart: new Date(`${ctx.startDate}T00:00:00Z`).getTime(),
    totalMembers: 34,
  };

  return {
    "analytics.dau": dau,
    "analytics.models": models,
    "analytics.agentEdits": agentEdits,
    "analytics.tabs": tabs,
    "analytics.conversationInsights": conversationInsights,
    "analytics.mcp": mcp,
    "analytics.commands": commands,
    "analytics.skills": skills,
    "analytics.plans": plans,
    "analytics.askMode": askMode,
    "analytics.leaderboard": leaderboard,
    "analytics.clientVersions": clientVersions,
    "analytics.topExtensions": topExtensions,
    "analytics.bugbot": bugbot,
    "aiCode.commits": { items: aiCommitItems, totalCount: aiCommitItems.length },
    "admin.members": members,
    "admin.spend": spend,
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function workspaceSlug(absPath) {
  return absPath.replace(/^[/\\]+/, "").replace(/[/\\.]/g, "-");
}

function writeOutputs(dashboard, args) {
  const payload = `${JSON.stringify({ dashboard }, null, 2)}\n`;
  const written = [];

  const repoCanvasDir = path.join(repoRoot, ".cursor", "canvases");
  fs.mkdirSync(repoCanvasDir, { recursive: true });
  const repoSidecar = path.join(repoCanvasDir, `${CANVAS_BASENAME}.canvas.data.json`);
  fs.writeFileSync(repoSidecar, payload);
  written.push(repoSidecar);

  // Mirror into the Cursor managed canvases directory for this workspace so an
  // already-open canvas refreshes in place (e.g.
  // ~/.cursor/projects/Users-josh-suzuki-joshuasuzuki-com/canvases/).
  let realRoot = repoRoot;
  try {
    realRoot = fs.realpathSync(repoRoot);
  } catch {
    /* keep repoRoot */
  }
  const managedProject = path.join(os.homedir(), ".cursor", "projects", workspaceSlug(realRoot));
  if (fs.existsSync(managedProject)) {
    const managedCanvases = path.join(managedProject, "canvases");
    fs.mkdirSync(managedCanvases, { recursive: true });
    const canvasSrc = path.join(repoCanvasDir, `${CANVAS_BASENAME}.canvas.tsx`);
    if (fs.existsSync(canvasSrc)) {
      fs.copyFileSync(canvasSrc, path.join(managedCanvases, `${CANVAS_BASENAME}.canvas.tsx`));
    }
    const managedSidecar = path.join(managedCanvases, `${CANVAS_BASENAME}.canvas.data.json`);
    fs.writeFileSync(managedSidecar, payload);
    written.push(managedSidecar);
  }

  if (args.out) {
    fs.mkdirSync(args.out, { recursive: true });
    const extra = path.join(args.out, `${CANVAS_BASENAME}.canvas.data.json`);
    fs.writeFileSync(extra, payload);
    written.push(extra);
  }
  return written;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const { startDate, endDate } = dateRange(args.window);
  const ctx = {
    baseUrl: args.baseUrl,
    windowDays: args.window,
    startDate,
    endDate,
    anonymize: args.anonymize,
    sampleMode: args.sample,
    generatedAt: new Date().toISOString(),
    apiKey: null,
  };

  let raw;
  let sources;
  if (args.sample) {
    raw = sampleRaw(ctx);
    sources = Object.keys(raw).map((id) => sourceRecord(id, "ok", "sample data"));
    console.log("Sample mode: generating labeled demo data (no API calls).");
  } else {
    ctx.apiKey = resolveApiKey(args);
    if (!ctx.apiKey) {
      console.error(
        [
          "No API key found. Provide one via:",
          "  --key <key>, or env CURSOR_ADMIN_KEY / CURSOR_ANALYTICS_API_KEY / CURSOR_API_KEY,",
          "  or ~/.config/cursor-analytics/env containing CURSOR_ADMIN_KEY=...",
          "",
          "The key must be an ADMIN-SCOPED TEAM key (admin:* scope) created in",
          "cursor.com/dashboard -> API Keys on an Enterprise team. User-scoped keys",
          "(used for Cloud Agents) are rejected by the Analytics API with",
          '"Invalid Team API Key".',
        ].join("\n"),
      );
      process.exit(2);
    }
    console.log(`Fetching Cursor analytics ${startDate} .. ${endDate} from ${ctx.baseUrl} ...`);
    ({ raw, sources } = await fetchAll(ctx));
  }

  const okCount = sources.filter((s) => s.status === "ok").length;
  const analyticsOk = sources.some((s) => s.id.startsWith("analytics.") && (s.status === "ok" || s.status === "empty"));
  for (const s of sources) {
    const mark = s.status === "ok" ? "  ok   " : s.status === "empty" ? "  empty" : s.status === "error" ? "  ERR  " : "  skip ";
    console.log(`${mark} ${s.id.padEnd(32)} ${s.detail ?? ""}`);
  }

  if (!analyticsOk) {
    console.error(
      [
        "",
        "No analytics source succeeded — refusing to overwrite the existing canvas data.",
        "Most common cause: the API key is not an admin-scoped team key.",
        "Fix: cursor.com/dashboard -> API Keys -> create key with admin:* scope,",
        "then store it in ~/.config/cursor-analytics/env as CURSOR_ADMIN_KEY=...",
      ].join("\n"),
    );
    process.exit(2);
  }

  const dashboard = buildDashboard(raw, sources, ctx);
  const written = writeOutputs(dashboard, args);

  console.log("");
  console.log(`Sources: ${okCount}/${sources.length} ok · insights: ${dashboard.insights.length} · correlations: ${dashboard.correlations.length}`);
  for (const w of written) console.log(`Wrote ${w}`);
  console.log(`Canvas data as of ${dashboard.generatedAt}${dashboard.sampleMode ? " (SAMPLE MODE)" : ""}${dashboard.anonymized ? " (names anonymized)" : ""}`);
}

// Allow importing transforms for tests without running main.
export { buildDashboard, sampleRaw, dateRange, pearson, fetchAll, sourceRecord };

const isDirectRun = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((e) => {
    console.error(`Refresh failed: ${e.stack || e}`);
    process.exit(1);
  });
}
