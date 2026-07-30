"use strict";

const assert = require("node:assert/strict");
const {
  MODEL,
  VENDORS,
  aggregateSignals,
  adoptionTierForScore,
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
    unit: extra.unit || "count",
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

const stripePayload = {
  schemaVersion: 1,
  domain: "stripe.com",
  company: {
    domain: "stripe.com",
    name: "Stripe",
    githubOrgs: [
      {
        login: "stripe",
        publicRepos: 500,
        publicMembers: 80,
        followers: 50000,
      },
    ],
    scale: { engineers: 3200, employees: 8500, source: "directory" },
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
    reading("github.stripe.claudeMdFiles", "claude-code", 18),
    reading("github.stripe.claudeCoauthoredCommits", "claude-code", 420),
    reading("github.stripe.cursorRulesDir", "cursor", 9),
    reading("github.stripe.devinPrs", "devin", 40),
    reading("web.jobs.cursor.0", "cursor", 1),
    reading("web.mention.claude-code.0", "claude-code", 1),
  ],
  collectedAt: "2026-07-20T00:00:00.000Z",
};

assert.equal(MODEL.id, "ACES");
assert.equal(MODEL.version, "2.0.0");
assert.equal(saturate(0, 5), 0);
assert.ok(Math.abs(saturate(5, 5) - 0.5) < 1e-9);
assert.equal(roundSpend(0), 0);
assert.equal(roundSpend(930), 950);
assert.equal(roundSpend(1234), 1200);
assert.equal(roundSpend(10010), 10000);
assert.equal(roundSpend(83720), 84000);
assert.equal(roundSpend(287500), 290000);
assert.equal(adoptionTierForScore(0).id, "none");
assert.equal(adoptionTierForScore(80).id, "company-wide");

const totals = aggregateSignals(richPayload.readings, "claude-code");
assert.equal(totals.get("claudeMdFiles"), 18);
assert.equal(totals.get("claudeCoauthoredCommits"), 420);
assert.equal(totals.get("webMentions"), 1);
assert.equal(
  aggregateSignals(
    [reading("web.jobs.claude-code.0", "claude-code", 1)],
    "claude-code"
  ).get("jobMentions"),
  1
);

assert.equal(estimateHeadcount(richPayload).estimate, 960);
assert.equal(estimateHeadcount(richPayload).basis, "github-scale");
assert.equal(estimateHeadcount(richPayload, 1000).estimate, 1000);
assert.equal(estimateHeadcount(richPayload, 1000).basis, "manual");
assert.equal(estimateHeadcount(emptyPayload).estimate, null);
assert.equal(estimateHeadcount(emptyPayload).basis, "unknown");
assert.equal(estimateHeadcount(stripePayload).estimate, 3200);
assert.equal(estimateHeadcount(stripePayload).basis, "directory-scale");
const repoOnly = {
  ...richPayload,
  company: {
    ...richPayload.company,
    githubOrgs: [{ login: "acme", publicRepos: 50, publicMembers: 0, followers: 0 }],
  },
};
assert.equal(estimateHeadcount(repoOnly).basis, "github-repos");
assert.equal(estimateHeadcount(repoOnly).estimate, 400);
const webSized = {
  ...emptyPayload,
  readings: [reading("web.headcount.engineers", "company", 80)],
};
assert.equal(estimateHeadcount(webSized).basis, "web-reported");
assert.equal(estimateHeadcount(webSized).estimate, 80);

assert.ok(Math.abs(snapshotConfidence(richPayload, now) - 0.9) < 1e-9);
assert.ok(Math.abs(snapshotConfidence(emptyPayload, now) - 0.15) < 1e-9);

const report = scoreCompany(richPayload, { now });
assert.equal(report.domain, "acme.com");
assert.equal(report.headcount.estimate, 960);
assert.equal(report.confidence, 0.9);
assert.ok(report.totalMonthly.mid >= 100000);
assert.ok(report.totalAnnual.mid >= 1_000_000);

const claude = report.vendors.find((vendor) => vendor.id === "claude-code");
assert.ok(claude.adoptionScore >= 90);
assert.equal(claude.adoptionTier, "company-wide");
assert.ok(claude.seats >= 800);
assert.ok(claude.monthly.mid >= 80000);
assert.ok(claude.monthly.low <= claude.monthly.mid);
assert.ok(claude.monthly.mid <= claude.monthly.high);

const cursor = report.vendors.find((vendor) => vendor.id === "cursor");
assert.ok(cursor.adoptionScore >= 60);
assert.ok(cursor.monthly.mid >= 30000);

const devin = report.vendors.find((vendor) => vendor.id === "devin");
assert.ok(devin.agents >= 10);
assert.ok(devin.monthly.mid >= 5000);

const openai = report.vendors.find((vendor) => vendor.id === "openai");
assert.equal(openai.adoptionScore, 0);
assert.deepEqual(openai.monthly, { low: 0, mid: 0, high: 0 });

assert.ok(report.overall.score >= 90);
assert.equal(report.overall.tier, "Heavy adopter");
assert.ok(report.brief.headline.includes("Acme"));
assert.ok(report.brief.mix.length >= 1);

const overridden = scoreCompany(richPayload, { now, headcountOverride: 1000 });
const claudeBig = overridden.vendors.find((vendor) => vendor.id === "claude-code");
assert.equal(overridden.headcount.basis, "manual");
assert.ok(claudeBig.seats >= claude.seats * 0.9);

const stripe = scoreCompany(stripePayload, { now });
const stripeCursor = stripe.vendors.find((vendor) => vendor.id === "cursor");
assert.equal(stripe.headcount.estimate, 3200);
assert.equal(stripeCursor.adoptionTier, "company-wide");
assert.ok(
  stripeCursor.annual.mid >= 2_400_000 && stripeCursor.annual.mid <= 2_700_000,
  `Cursor ACV should land near Stripe's $2.5M contract, got ${stripeCursor.annual.mid}`
);
assert.ok(
  stripe.totalAnnual.mid >= 5_000_000,
  `Stripe total AI coding stack should be multi-million, got ${stripe.totalAnnual.mid}`
);
assert.match(stripe.brief.headline, /\$[0-9.]+M\/yr/);

const noOrgPayload = {
  ...richPayload,
  domain: "unknown-startup.example",
  company: { domain: "unknown-startup.example", name: "Unknown", githubOrgs: [] },
  coverage: { ...richPayload.coverage, githubOrgResolved: false },
};
const noOrgReport = scoreCompany(noOrgPayload, { now });
const claudeNoOrg = noOrgReport.vendors.find((vendor) => vendor.id === "claude-code");
assert.ok(claudeNoOrg.adoptionScore > 0);
assert.equal(claudeNoOrg.seats, null);
assert.equal(claudeNoOrg.monthly, null);
assert.ok(claudeNoOrg.notes.length > 0);
assert.ok(noOrgReport.confidence <= 0.4);

const emptyReport = scoreCompany(emptyPayload, { now });
assert.equal(emptyReport.overall.score, 0);
assert.equal(emptyReport.totalMonthly, null);
for (const vendor of emptyReport.vendors) {
  assert.equal(vendor.adoptionScore, 0);
  assert.deepEqual(vendor.monthly, { low: 0, mid: 0, high: 0 });
}

const lighterPayload = {
  ...richPayload,
  readings: richPayload.readings.map((entry) =>
    entry.id === "github.acme.claudeMdFiles" ? { ...entry, value: 1 } : entry
  ),
};
const lighterReport = scoreCompany(lighterPayload, { now });
const claudeLighter = lighterReport.vendors.find((vendor) => vendor.id === "claude-code");
assert.ok(claudeLighter.adoptionScore <= claude.adoptionScore);

const devinWebOnly = {
  ...emptyPayload,
  readings: [
    reading("web.mention.devin.0", "devin", 1, { url: "https://example.com/devin" }),
  ],
};
const devinWebReport = scoreCompany(devinWebOnly, { now });
const devinVendor = devinWebReport.vendors.find((vendor) => vendor.id === "devin");
assert.ok(devinVendor.adoptionScore > 0);
assert.equal(devinVendor.agents, 0);

assert.equal(VENDORS.length, 5);
assert.ok(VENDORS.every((vendor) => vendor.signals.length > 0));
assert.ok(
  VENDORS.every((vendor) => vendor.pricePerSeat > 0 || vendor.pricePerAgent > 0)
);

console.log("aispend-score-engine tests passed");
