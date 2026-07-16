import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildDashboard, dateRange, fetchAll, pearson, sampleRaw, sourceRecord } from "./cursor-analytics-refresh.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "cursor-analytics-refresh.mjs");

function makeCtx(overrides = {}) {
  const { startDate, endDate } = dateRange(30);
  return {
    baseUrl: "http://unused",
    windowDays: 30,
    startDate,
    endDate,
    anonymize: true,
    sampleMode: true,
    generatedAt: new Date().toISOString(),
    apiKey: null,
    ...overrides,
  };
}

test("pearson computes a sane correlation", () => {
  const up = Array.from({ length: 12 }, (_, i) => [i, i * 2 + 1]);
  const res = pearson(up);
  assert.ok(res && res.r > 0.99, `expected ~1, got ${res?.r}`);
  assert.equal(res.n, 12);
  assert.equal(pearson([[1, 2], [3, 4]]), null, "too few points");
  assert.equal(pearson(Array.from({ length: 10 }, () => [5, Math.random()])), null, "zero variance x");
});

test("sample pipeline produces a complete, internally consistent dashboard", () => {
  const ctx = makeCtx();
  const raw = sampleRaw(ctx);
  const sources = Object.keys(raw).map((id) => sourceRecord(id, "ok", "sample data"));
  const d = buildDashboard(raw, sources, ctx);

  assert.equal(d.schemaVersion, "2.0");
  assert.equal(d.sampleMode, true);
  assert.equal(d.daily.length, 30);
  assert.ok(d.kpis.dauLatest > 0, "dau kpi");
  assert.ok(d.kpis.agentAcceptRatePct > 0 && d.kpis.agentAcceptRatePct < 100, "acceptance in range");
  assert.ok(d.models.totals.length >= 5, "model totals");
  const shareSum = d.models.totals.reduce((a, t) => a + (t.sharePct ?? 0), 0);
  assert.ok(shareSum > 95 && shareSum <= 101, `model shares ~100, got ${shareSum}`);
  assert.ok(d.conversationInsights.totalConversations > 0, "conversations counted");
  assert.equal(
    d.conversationInsights.intents.reduce((a, i) => a + i.count, 0),
    d.conversationInsights.totalConversations,
  );
  assert.ok(d.aiCode.aiSharePct > 0 && d.aiCode.aiSharePct < 100, "ai commit share");
  assert.equal(d.aiCode.aiLinesAdded, d.aiCode.tabLinesAdded + d.aiCode.composerLinesAdded);
  assert.ok(d.correlations.length >= 3, `expected correlations, got ${d.correlations.length}`);
  for (const c of d.correlations) {
    assert.ok(Math.abs(c.r) <= 1, "r bounded");
    assert.ok(c.n >= 8, "n floor");
    assert.ok(c.interpretation.length > 10, "interpretation text");
  }
  assert.ok(d.insights.length >= 4 && d.insights.length <= 6, `insights count ${d.insights.length}`);
  // Anonymization: no raw emails anywhere in people/spend.
  const blob = JSON.stringify({ people: d.people, spend: d.spend });
  assert.ok(!blob.includes("@sample.dev"), "emails must be anonymized");
  assert.ok(d.people.leaderboard[0].name.startsWith("Engineer "), "anonymized names");
});

test("no-anonymize keeps emails", () => {
  const ctx = makeCtx({ anonymize: false });
  const raw = sampleRaw(ctx);
  const d = buildDashboard(raw, Object.keys(raw).map((id) => sourceRecord(id, "ok")), ctx);
  assert.ok(d.people.leaderboard[0].name.includes("@sample.dev"));
});

test("dashboard degrades gracefully when sources are missing", () => {
  const ctx = makeCtx();
  const raw = sampleRaw(ctx);
  // Simulate: conversation insights disabled, ai-code not enabled, admin denied.
  raw["analytics.conversationInsights"] = null;
  raw["aiCode.commits"] = null;
  raw["admin.members"] = null;
  raw["admin.spend"] = null;
  const sources = Object.keys(raw).map((id) => sourceRecord(id, raw[id] ? "ok" : "error", raw[id] ? undefined : "401"));
  const d = buildDashboard(raw, sources, ctx);
  assert.equal(d.conversationInsights, null);
  assert.equal(d.aiCode, null);
  assert.equal(d.spend, null);
  assert.equal(d.team.memberCount, null);
  assert.ok(d.kpis.agentAcceptRatePct > 0, "analytics KPIs still present");
  assert.ok(d.insights.length > 0, "still generates insights from available data");
  assert.ok(d.correlations.every((c) => !c.id.includes("complexity") && !c.id.includes("ship")));
});

test("fetchAll pulls every endpoint from a mock API and builds the dashboard", async () => {
  const ctx = makeCtx({ sampleMode: false, apiKey: "crsr_test_key" });
  const fixtures = sampleRaw(ctx);
  const hits = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const auth = req.headers.authorization ?? "";
    const expected = `Basic ${Buffer.from("crsr_test_key:").toString("base64")}`;
    if (auth !== expected) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "error", message: "Invalid Team API Key" }));
      return;
    }
    hits.add(`${req.method} ${url.pathname}`);
    const table = {
      "/analytics/team/dau": fixtures["analytics.dau"],
      "/analytics/team/models": fixtures["analytics.models"],
      "/analytics/team/agent-edits": fixtures["analytics.agentEdits"],
      "/analytics/team/tabs": fixtures["analytics.tabs"],
      "/analytics/team/conversation-insights": fixtures["analytics.conversationInsights"],
      "/analytics/team/mcp": fixtures["analytics.mcp"],
      "/analytics/team/commands": fixtures["analytics.commands"],
      "/analytics/team/skills": fixtures["analytics.skills"],
      "/analytics/team/plans": fixtures["analytics.plans"],
      "/analytics/team/ask-mode": fixtures["analytics.askMode"],
      "/analytics/team/leaderboard": fixtures["analytics.leaderboard"],
      "/analytics/team/client-versions": fixtures["analytics.clientVersions"],
      "/analytics/team/top-file-extensions": fixtures["analytics.topExtensions"],
      "/analytics/team/bugbot": fixtures["analytics.bugbot"],
      "/analytics/ai-code/commits": fixtures["aiCode.commits"],
      "/teams/members": fixtures["admin.members"],
      "/teams/spend": fixtures["admin.spend"],
    };
    const body = table[url.pathname];
    if (!body) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "error", message: `no fixture for ${url.pathname}` }));
      return;
    }
    if (url.pathname === "/analytics/team/conversation-insights") {
      assert.ok(url.searchParams.get("include")?.includes("workTypes"), "include param sent");
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    ctx.baseUrl = `http://127.0.0.1:${port}`;
    const { raw, sources } = await fetchAll(ctx);
    assert.equal(sources.filter((s) => s.status === "error").length, 0, JSON.stringify(sources.filter((s) => s.status === "error")));
    assert.ok(hits.has("GET /analytics/team/conversation-insights"), "conversation insights fetched");
    assert.ok(hits.has("GET /analytics/ai-code/commits"), "ai code fetched");
    assert.ok(hits.has("POST /teams/spend"), "spend fetched");
    const d = buildDashboard(raw, sources, ctx);
    assert.ok(d.kpis.aiCommitSharePct > 0);
    assert.ok(d.conversationInsights.totalConversations > 0);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test("auth failure across all sources exits 2 and writes nothing", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "error", message: "Invalid Team API Key" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-analytics-test-"));
  try {
    // Must be async: a sync child spawn would block this process's event loop,
    // deadlocking against the in-process mock server the child talks to.
    const { status, output } = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [scriptPath, "--key", "crsr_wrong", "--base-url", `http://127.0.0.1:${port}`, "--out", outDir],
        { encoding: "utf8", timeout: 60000 },
        (error, stdout, stderr) => resolve({ status: error?.code ?? 0, output: `${stdout}${stderr}` }),
      );
    });
    assert.equal(status, 2, "exit code 2 on total auth failure");
    assert.match(output, /admin-scoped team key|Invalid Team API Key/);
    assert.ok(!fs.existsSync(path.join(outDir, "cursor-model-usage.canvas.data.json")), "must not write sidecar");
  } finally {
    server.closeAllConnections?.();
    server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test("--sample CLI writes a valid sidecar", () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-analytics-sample-"));
  try {
    const output = execFileSync(process.execPath, [scriptPath, "--sample", "--out", outDir], { encoding: "utf8" });
    assert.match(output, /SAMPLE MODE/);
    const sidecar = JSON.parse(fs.readFileSync(path.join(outDir, "cursor-model-usage.canvas.data.json"), "utf8"));
    assert.equal(sidecar.dashboard.sampleMode, true);
    assert.ok(Array.isArray(sidecar.dashboard.insights));
    assert.ok(sidecar.dashboard.daily.length === 30);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
