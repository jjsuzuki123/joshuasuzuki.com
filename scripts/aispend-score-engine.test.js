"use strict";

const assert = require("node:assert/strict");
const {
  MODEL,
  VENDORS,
  aggregateSignals,
  estimateHeadcount,
  roundSpend,
  saturate,
  scoreCompany,
  snapshotConfidence,
} = require("../aispend/score-engine.js");

const now = new Date("2026-07-21T00:00:00.000Z");

function reading(id, vendor, value, extra = {}) {
  return {
    id,
    vendor,
    metric: extra.metric || id,
    value,
    unit: "count",
    source: id.startsWith("web.") ? "web" : "github",
    url: extra.url || "https://github.com/search?q=test&type=code",
    detail: extra.detail || "",
    observedAt: "2026-07-20T00:00:00.000Z",
  };
}

const richPayload = {
  schemaVersion: 1,
  domain: "acme.com",
  company: {
    domain: "acme.com",
    name: "Acme",
    githubOrgs: [
      {
        login: "acme",
        name: "Acme",
        url: "https://github.com/acme",
        publicRepos: 120,
        publicMembers: 40,
        followers: 800,
        createdAt: "2015-01-01T00:00:00Z",
      },
    ],
  },
  coverage: {
    githubOrgResolved: true,
    githubAuthenticated: true,
    codeSearch: true,
    commitSearch: true,
    prSearch: true,
    webResearch: "ok",
    notes: [],
  },
  readings: [
    reading("github.acme.claudeMdFiles", "claude-code", 18),
    reading("github.acme.claudeCoauthoredCommits", "claude-code", 420),
    reading("github.acme.claudeAppPrs", "claude-code", 12),
    reading("github.acme.cursorRulesDir", "cursor", 9),
    reading("github.acme.devinPrs", "devin", 130),
    reading("web.mention.claude-code.0", "claude-code", 1, {
      url: "https://example.com/acme-claude",
    }),
  ],
  collectedAt: "2026-07-20T00:00:00.000Z",
};

const emptyPayload = {
  schemaVersion: 1,
  domain: "empty.com",
  company: { domain: "empty.com", name: "empty", githubOrgs: [] },
  coverage: {
    githubOrgResolved: false,
    githubAuthenticated: false,
    codeSearch: false,
    commitSearch: false,
    prSearch: false,
    webResearch: "disabled",
    notes: [],
  },
  readings: [],
  collectedAt: "2026-07-20T00:00:00.000Z",
};

// ---------- primitives ----------

assert.equal(MODEL.id, "ACES");
assert.equal(saturate(0, 5), 0);
assert.ok(Math.abs(saturate(5, 5) - 0.5) < 1e-9);
assert.ok(saturate(50, 5) > 0.9);
assert.equal(roundSpend(0), 0);
assert.equal(roundSpend(930), 950);
assert.equal(roundSpend(1234), 1200);
assert.equal(roundSpend(10010), 10000);
assert.equal(roundSpend(83720), 84000);
assert.equal(roundSpend(287500), 290000);

const totals = aggregateSignals(richPayload.readings, "claude-code");
assert.equal(totals.get("claudeMdFiles"), 18);
assert.equal(totals.get("claudeCoauthoredCommits"), 420);
assert.equal(totals.get("webMentions"), 1);

// ---------- headcount ----------

assert.deepEqual(estimateHeadcount(richPayload).estimate, 120);
assert.equal(estimateHeadcount(richPayload).basis, "github-members");
assert.equal(estimateHeadcount(richPayload, 1000).estimate, 1000);
assert.equal(estimateHeadcount(richPayload, 1000).basis, "manual");
assert.equal(estimateHeadcount(emptyPayload).estimate, null);
assert.equal(estimateHeadcount(emptyPayload).basis, "unknown");
const repoOnly = {
  ...richPayload,
  company: {
    ...richPayload.company,
    githubOrgs: [{ login: "acme", publicRepos: 50, publicMembers: 0 }],
  },
};
assert.equal(estimateHeadcount(repoOnly).basis, "github-repos");
assert.equal(estimateHeadcount(repoOnly).estimate, 60);

// ---------- confidence ----------

assert.ok(Math.abs(snapshotConfidence(richPayload, now) - 0.9) < 1e-9);
assert.ok(Math.abs(snapshotConfidence(emptyPayload, now) - 0.15) < 1e-9);
const stalePayload = { ...richPayload, collectedAt: "2026-01-01T00:00:00.000Z" };
assert.ok(snapshotConfidence(stalePayload, now) < 0.9);
assert.ok(snapshotConfidence(stalePayload, now) >= 0.9 * 0.7 - 1e-9);

// ---------- full scoring: rich fixture ----------

const report = scoreCompany(richPayload, { now });
assert.equal(report.domain, "acme.com");
assert.equal(report.headcount.estimate, 120);
assert.equal(report.confidence, 0.9);

const claude = report.vendors.find((vendor) => vendor.id === "claude-code");
assert.equal(claude.adoptionScore, 92);
assert.equal(claude.seats, 77);
assert.deepEqual(claude.monthly, { low: 6200, mid: 10000, high: 13000 });
assert.ok(claude.monthly.low <= claude.monthly.mid);
assert.ok(claude.monthly.mid <= claude.monthly.high);
assert.equal(claude.evidence[0].id, "github.acme.claudeCoauthoredCommits");

const cursor = report.vendors.find((vendor) => vendor.id === "cursor");
assert.equal(cursor.adoptionScore, 42);
assert.equal(cursor.seats, 40);
assert.equal(cursor.monthly.mid, 1200);

const devin = report.vendors.find((vendor) => vendor.id === "devin");
assert.equal(devin.adoptionScore, 69);
assert.equal(devin.agents, 3);
assert.deepEqual(devin.monthly, { low: 950, mid: 1500, high: 2000 });

const openai = report.vendors.find((vendor) => vendor.id === "openai");
assert.equal(openai.adoptionScore, 0);
assert.deepEqual(openai.monthly, { low: 0, mid: 0, high: 0 });

assert.equal(report.overall.score, 95);
assert.equal(report.overall.tier, "Heavy adopter");
assert.deepEqual(report.totalMonthly, {
  low: 7900,
  mid: 12700,
  high: 16600,
  complete: true,
});
assert.equal(report.totalAnnual.mid, 12700 * 12);
assert.ok(report.caveats.length >= 3);

// ---------- headcount override scales seat-based spend ----------

const overridden = scoreCompany(richPayload, { now, headcountOverride: 1000 });
const claudeBig = overridden.vendors.find((vendor) => vendor.id === "claude-code");
assert.equal(overridden.headcount.basis, "manual");
assert.equal(claudeBig.seats, 644);
assert.equal(claudeBig.monthly.mid, 84000);
const devinSame = overridden.vendors.find((vendor) => vendor.id === "devin");
assert.equal(devinSame.monthly.mid, 1500); // agent-based, unaffected by headcount

// ---------- no headcount: adoption shown, spend withheld ----------

const noOrgPayload = {
  ...richPayload,
  company: { domain: "acme.com", name: "acme", githubOrgs: [] },
  coverage: { ...richPayload.coverage, githubOrgResolved: false },
};
const noOrgReport = scoreCompany(noOrgPayload, { now });
const claudeNoOrg = noOrgReport.vendors.find(
  (vendor) => vendor.id === "claude-code"
);
assert.ok(claudeNoOrg.adoptionScore > 0);
assert.equal(claudeNoOrg.seats, null);
assert.equal(claudeNoOrg.monthly, null);
assert.ok(claudeNoOrg.notes.length > 0);
assert.ok(noOrgReport.confidence <= 0.4);
assert.equal(noOrgReport.totalMonthly.complete, false);

// ---------- empty payload ----------

const emptyReport = scoreCompany(emptyPayload, { now });
assert.equal(emptyReport.overall.score, 0);
assert.equal(emptyReport.overall.tier, "No public signals");
assert.equal(emptyReport.totalMonthly, null);
assert.equal(emptyReport.totalAnnual, null);
for (const vendor of emptyReport.vendors) {
  assert.equal(vendor.adoptionScore, 0);
  assert.deepEqual(vendor.monthly, { low: 0, mid: 0, high: 0 });
}

// ---------- monotonicity: more evidence never lowers the score ----------

const lighterPayload = {
  ...richPayload,
  readings: richPayload.readings.map((entry) =>
    entry.id === "github.acme.claudeMdFiles" ? { ...entry, value: 2 } : entry
  ),
};
const lighterReport = scoreCompany(lighterPayload, { now });
const claudeLighter = lighterReport.vendors.find(
  (vendor) => vendor.id === "claude-code"
);
assert.ok(claudeLighter.adoptionScore < claude.adoptionScore);
assert.ok(lighterReport.overall.score <= report.overall.score);

// ---------- devin with web mention only: no agents priced ----------

const devinWebOnly = {
  ...emptyPayload,
  readings: [
    reading("web.mention.devin.0", "devin", 1, {
      url: "https://example.com/devin",
    }),
  ],
};
const devinWebReport = scoreCompany(devinWebOnly, { now });
const devinVendor = devinWebReport.vendors.find(
  (vendor) => vendor.id === "devin"
);
assert.ok(devinVendor.adoptionScore > 0);
assert.equal(devinVendor.agents, 0);
assert.deepEqual(devinVendor.monthly, { low: 0, mid: 0, high: 0 });

// ---------- vendor catalog sanity ----------

assert.equal(VENDORS.length, 5);
assert.ok(VENDORS.every((vendor) => vendor.signals.length > 0));
assert.ok(
  VENDORS.every(
    (vendor) => vendor.pricePerSeat > 0 || vendor.pricePerAgent > 0
  )
);

console.log("aispend-score-engine tests passed");
