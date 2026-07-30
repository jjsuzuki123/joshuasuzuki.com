"use strict";

const assert = require("node:assert/strict");
const {
  MODEL,
  VENDORS,
  COMPANY_TIERS,
  aggregateSignals,
  adoptionTierForScore,
  estimateHeadcount,
  roundSpend,
  saturate,
  scoreCompany,
  snapshotConfidence,
  techForwardness,
} = require("../aispend/score-engine.js");

const now = new Date("2026-07-30T00:00:00.000Z");

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
    observedAt: "2026-07-29T00:00:00.000Z",
  };
}

const fullCoverage = {
  githubOrgResolved: true,
  githubAuthenticated: true,
  codeSearch: true,
  commitSearch: true,
  prSearch: true,
  webResearch: "ok",
  notes: [],
};

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
  coverage: { ...fullCoverage },
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
  collectedAt: "2026-07-29T00:00:00.000Z",
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
  collectedAt: "2026-07-29T00:00:00.000Z",
};

const stripePayload = {
  schemaVersion: 1,
  domain: "stripe.com",
  company: {
    domain: "stripe.com",
    name: "Stripe",
    githubOrgs: [
      { login: "stripe", publicRepos: 500, publicMembers: 80, followers: 50000 },
    ],
    scale: { engineers: 3200, employees: 8500, tier: "tech-forward", source: "directory" },
  },
  coverage: { ...fullCoverage },
  readings: [
    reading("github.stripe.claudeMdFiles", "claude-code", 18),
    reading("github.stripe.claudeCoauthoredCommits", "claude-code", 420),
    reading("github.stripe.cursorRulesDir", "cursor", 9),
    reading("github.stripe.devinPrs", "devin", 40),
    reading("web.jobs.cursor.0", "cursor", 1),
    reading("web.mention.claude-code.0", "claude-code", 1),
  ],
  collectedAt: "2026-07-29T00:00:00.000Z",
};

// Private-monorepo tech-forward company: real org, zero public AI markers.
// The old model scored this $0; v3 must produce a prior-led estimate.
const wealthfrontPayload = {
  schemaVersion: 1,
  domain: "wealthfront.com",
  company: {
    domain: "wealthfront.com",
    name: "Wealthfront",
    githubOrgs: [
      {
        login: "wealthfront",
        name: "Wealthfront Engineering",
        url: "https://github.com/wealthfront",
        blog: "https://eng.wealthfront.com",
        isVerified: true,
        publicRepos: 15,
        publicMembers: 0,
        followers: 18,
        createdAt: "2010-11-12T22:51:17Z",
      },
    ],
    scale: { engineers: 195, employees: 400, tier: "tech-forward", source: "directory" },
  },
  coverage: { ...fullCoverage },
  readings: [
    reading("github.wealthfront.claudeMdFiles", "claude-code", 0),
    reading("github.wealthfront.cursorRulesDir", "cursor", 0),
    reading("github.wealthfront.devinPrs", "devin", 0),
    reading("web.headcount.employees", "company", 391, {
      unit: "employees",
      metric: "Reported employees (web)",
      url: "https://example.com/wlth-10k",
    }),
  ],
  collectedAt: "2026-07-29T00:00:00.000Z",
};

// Traditional company: only a web employee count, no GitHub org.
const traditionalPayload = {
  schemaVersion: 1,
  domain: "oldco.com",
  company: { domain: "oldco.com", name: "OldCo", githubOrgs: [] },
  coverage: {
    githubOrgResolved: false,
    githubAuthenticated: false,
    codeSearch: false,
    commitSearch: false,
    prSearch: false,
    webResearch: "ok",
    notes: [],
  },
  readings: [
    reading("web.headcount.employees", "company", 2400, {
      unit: "employees",
      metric: "Reported employees (web)",
      url: "https://example.com/oldco-about",
    }),
  ],
  collectedAt: "2026-07-29T00:00:00.000Z",
};

/* ---------- primitives ---------- */

assert.equal(MODEL.id, "ACES");
assert.equal(MODEL.version, "3.0.0");
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
assert.ok(
  Math.abs(VENDORS.reduce((sum, vendor) => sum + vendor.priorMix, 0) - 1) < 1e-9,
  "vendor prior mix must sum to 1"
);
assert.ok(COMPANY_TIERS["tech-forward"].tech > COMPANY_TIERS.traditional.tech);

const totals = aggregateSignals(richPayload.readings, "claude-code");
assert.equal(totals.get("claudeMdFiles"), 18);
assert.equal(totals.get("claudeCoauthoredCommits"), 420);
assert.equal(totals.get("webMentions"), 1);

/* ---------- sizing ---------- */

assert.equal(estimateHeadcount(richPayload).estimate, 960);
assert.equal(estimateHeadcount(richPayload).basis, "github-scale");
assert.equal(estimateHeadcount(richPayload, 1000).estimate, 1000);
assert.equal(estimateHeadcount(richPayload, 1000).basis, "manual");
assert.equal(estimateHeadcount(emptyPayload).estimate, null);
assert.equal(estimateHeadcount(wealthfrontPayload).estimate, 195);
assert.equal(estimateHeadcount(wealthfrontPayload).basis, "directory-scale");
assert.equal(estimateHeadcount(traditionalPayload).estimate, 1080);
assert.equal(estimateHeadcount(traditionalPayload).basis, "web-reported");

assert.ok(Math.abs(snapshotConfidence(richPayload, now) - 0.9) < 1e-9);
assert.ok(Math.abs(snapshotConfidence(emptyPayload, now) - 0.15) < 1e-9);

/* ---------- tech-forwardness ---------- */

const wfTech = techForwardness(wealthfrontPayload, 0);
assert.equal(wfTech.tierId, "tech-forward");
assert.ok(Math.abs(wfTech.value - 0.85) < 1e-9);
const oldcoTech = techForwardness(traditionalPayload, 0);
assert.equal(oldcoTech.tierId, null);
assert.ok(oldcoTech.value < 0.5);

/* ---------- prior-led read: never $0 for a sized tech company ---------- */

const wealthfront = scoreCompany(wealthfrontPayload, { now });
assert.equal(wealthfront.headcount.estimate, 195);
assert.ok(
  wealthfront.totalAnnual.mid >= 500_000 && wealthfront.totalAnnual.mid <= 1_600_000,
  `Wealthfront prior-led read should land near $0.9M/yr, got ${wealthfront.totalAnnual.mid}`
);
assert.ok(wealthfront.totalAnnual.high >= 1_500_000, "high band should reach millions");
assert.equal(wealthfront.signalStrength, 0);
assert.equal(wealthfront.overall.tier, "Modeled adopter (prior-led)");
assert.ok(wealthfront.brief.headline.includes("prior-led"));
for (const vendor of wealthfront.vendors) {
  assert.ok(vendor.monthly.mid > 0, `${vendor.id} must carry prior spend`);
  assert.equal(vendor.adoptionTier, "modeled");
}
const wfCursor = wealthfront.vendors.find((vendor) => vendor.id === "cursor");
assert.ok(
  wfCursor.monthly.mid * 12 >= 150_000,
  `Cursor prior share should be six figures annually, got ${wfCursor.monthly.mid * 12}`
);
assert.ok(
  wealthfront.economics.perEngineerMonthly >= 300,
  "blended per-engineer spend must sit far above list seat prices"
);

/* ---------- evidence-led read: Stripe calibration ---------- */

const stripe = scoreCompany(stripePayload, { now });
assert.equal(stripe.headcount.estimate, 3200);
assert.ok(
  stripe.totalAnnual.mid >= 9_000_000 && stripe.totalAnnual.mid <= 24_000_000,
  `Stripe stack should model in the low tens of millions, got ${stripe.totalAnnual.mid}`
);
const stripeCursor = stripe.vendors.find((vendor) => vendor.id === "cursor");
assert.ok(
  stripeCursor.annual.mid >= 2_500_000 && stripeCursor.annual.mid <= 8_000_000,
  `Cursor at Stripe must clear the known ~$2.5M contract, got ${stripeCursor.annual.mid}`
);
const stripeClaude = stripe.vendors.find((vendor) => vendor.id === "claude-code");
assert.ok(stripeClaude.annual.mid > stripeCursor.annual.mid);
assert.equal(stripeCursor.adoptionTier, "company-wide");
assert.ok(stripe.overall.score >= 70);
assert.equal(stripe.overall.tier, "Heavy adopter (evidence-led)");
assert.match(stripe.brief.headline, /\$[0-9.]+M\/yr/);

/* ---------- evidence-led read: mid-size org ---------- */

const report = scoreCompany(richPayload, { now });
assert.equal(report.domain, "acme.com");
assert.equal(report.headcount.estimate, 960);
assert.equal(report.confidence, 0.9);
assert.ok(report.totalAnnual.mid >= 2_000_000);
const claude = report.vendors.find((vendor) => vendor.id === "claude-code");
assert.ok(claude.adoptionScore >= 90);
assert.equal(claude.adoptionTier, "company-wide");
assert.ok(claude.seats >= 300);
assert.ok(claude.monthly.low <= claude.monthly.mid);
assert.ok(claude.monthly.mid <= claude.monthly.high);
const devin = report.vendors.find((vendor) => vendor.id === "devin");
assert.ok(devin.agents >= 10);

// Evidence raises spend above the pure prior for the same org.
const priorOnly = scoreCompany(
  { ...richPayload, readings: [] },
  { now }
);
assert.ok(report.totalAnnual.mid > priorOnly.totalAnnual.mid);
assert.ok(priorOnly.totalAnnual.mid > 0, "prior must still price a sized org");

// Weaker markers lower the evidence score.
const lighterPayload = {
  ...richPayload,
  readings: richPayload.readings.map((entry) =>
    entry.id === "github.acme.claudeMdFiles" ? { ...entry, value: 1 } : entry
  ),
};
const lighter = scoreCompany(lighterPayload, { now });
const claudeLighter = lighter.vendors.find((vendor) => vendor.id === "claude-code");
assert.ok(claudeLighter.adoptionScore <= claude.adoptionScore);

/* ---------- traditional company: modest but non-zero ---------- */

const oldco = scoreCompany(traditionalPayload, { now });
assert.ok(oldco.totalAnnual.mid > 0);
assert.ok(
  oldco.economics.perEngineerMonthly < wealthfront.economics.perEngineerMonthly,
  "traditional orgs must model cheaper per engineer than tech-forward ones"
);
assert.ok(oldco.confidence <= 0.4);

/* ---------- headcount override rescales ---------- */

const overridden = scoreCompany(wealthfrontPayload, { now, headcountOverride: 1000 });
assert.equal(overridden.headcount.basis, "manual");
assert.ok(overridden.totalAnnual.mid > wealthfront.totalAnnual.mid * 2);

/* ---------- devin agent cap at giant orgs ---------- */

const giant = scoreCompany(
  {
    ...emptyPayload,
    domain: "google.com",
    company: { domain: "google.com", name: "Google", githubOrgs: [] },
    coverage: { ...fullCoverage },
  },
  { now }
);
const giantDevin = giant.vendors.find((vendor) => vendor.id === "devin");
assert.ok(giantDevin.monthly.mid <= 400 * 500);
assert.equal(giantDevin.agents, 400);
assert.ok(giant.totalAnnual.mid >= 20_000_000, "big tech should model eight figures");

/* ---------- signals without size: dollars withheld, not faked ---------- */

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
assert.equal(noOrgReport.totalMonthly, null);
assert.ok(noOrgReport.confidence <= 0.4);

/* ---------- nothing known: no fabricated dollars ---------- */

const emptyReport = scoreCompany(emptyPayload, { now });
assert.equal(emptyReport.overall.score, 0);
assert.equal(emptyReport.totalMonthly, null);
for (const vendor of emptyReport.vendors) {
  assert.equal(vendor.adoptionScore, 0);
  assert.deepEqual(vendor.monthly, { low: 0, mid: 0, high: 0 });
}

assert.equal(VENDORS.length, 5);
assert.ok(VENDORS.every((vendor) => vendor.signals.length > 0));

console.log("aispend-score-engine tests passed");
