(function initSpendscopeScoring(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.SpendscopeScoring = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSpendscopeScoring() {
  "use strict";

  /**
   * Spendscope ACES v3 — expected-spend model (Intricately-style).
   *
   * v1 priced public file counts like SMB seats ($8k/mo at Stripe — absurd).
   * v2 fixed org scale but still gated dollars behind public markers, so a
   * private-monorepo shop like Wealthfront scored $0 despite obviously
   * spending on AI.
   *
   * v3 flips the logic: every sized company gets a modeled dollar value.
   *
   *   1. Size the engineering org (curated directory, SEC/web headcount,
   *      GitHub expansion).
   *   2. Classify tech-forwardness from many sources (curated tier, GitHub
   *      org profile, engineering blog, repo footprint, job posts, any AI
   *      marker).
   *   3. Apply era priors: expected adoption rate and blended per-engineer
   *      monthly AI spend (seats + token/API + agents — far above list
   *      price), with volume discounts at scale.
   *   4. Let public evidence tune the estimate up (strong markers) or only
   *      mildly down (absence of public markers is weak evidence — private
   *      repos are invisible), then allocate across vendors by prior mix
   *      blended with observed signal share. Enterprise ACV floors still
   *      apply for large orgs.
   *
   * Like Intricately: it is a directional estimate that is sometimes wrong,
   * never a refusal to answer.
   */

  const MODEL = Object.freeze({
    id: "ACES",
    version: "3.0.0",
    name: "AI Coding Expenditure Signal",
  });

  const HEADCOUNT = Object.freeze({
    membersMultiplier: 12,
    reposMultiplier: 8,
    followerEngineerRatio: 0.35,
    minimum: 8,
    maximum: 80000,
    techEmployeeEngineerShare: 0.45,
  });

  // Firmographic company tiers. `tech` is the tech-forwardness prior in
  // [0, 1]; `vendorShare` dampens spend that goes to in-house tooling
  // instead of the vendors we track (big tech builds its own).
  const COMPANY_TIERS = Object.freeze({
    "ai-native": { tech: 1.0, label: "AI-native" },
    "dev-tools": { tech: 0.92, label: "Developer tooling / infrastructure" },
    "tech-forward": { tech: 0.85, label: "Tech-forward digital native" },
    "big-tech": { tech: 0.88, label: "Big tech (heavy in-house AI)", vendorShare: 0.55 },
    "enterprise-tech": { tech: 0.62, label: "Enterprise software" },
    "financial-enterprise": { tech: 0.55, label: "Financial enterprise" },
    "traditional": { tech: 0.38, label: "Traditional enterprise" },
  });

  // Era priors (2026): most engineers at tech companies use AI coding
  // tools, and blended spend per adopted engineer (seats + usage/tokens +
  // agents, across an overlapping stack) runs $100–$600+/mo — far above
  // any single list price.
  const ECONOMICS = Object.freeze({
    adoptionBase: 0.25,
    adoptionGain: 0.68,
    adoptionMax: 0.95,
    perEngineerBase: 110,
    perEngineerGain: 520,
    scaleRefEngineers: 80,
    scaleSlope: 0.115,
    scaleMin: 0.5,
    scaleMax: 1.1,
    evidenceBase: 0.75,
    evidenceGain: 0.85,
    evidenceMax: 1.25,
    noSignalHighTech: 0.85,
    noSignalMidTech: 0.7,
    noSignalLowTech: 0.6,
    techEvidenceLift: 0.08,
  });

  const BAND = Object.freeze({
    evidenceLowBase: 0.45,
    evidenceLowGain: 0.3,
    evidenceHighBase: 2.6,
    evidenceHighGain: 1.2,
    priorLowBase: 0.35,
    priorLowGain: 0.25,
    priorHighBase: 3.0,
    priorHighGain: 1.1,
  });

  const ADOPTION_TIERS = [
    { id: "none", minimum: 0, label: "No public signals", penetration: 0 },
    { id: "trace", minimum: 1, label: "Trace signals", penetration: 0.08 },
    { id: "emerging", minimum: 12, label: "Emerging rollout", penetration: 0.22 },
    { id: "rolling-out", minimum: 28, label: "Rolling out", penetration: 0.42 },
    { id: "standard", minimum: 50, label: "Org standard", penetration: 0.7 },
    { id: "company-wide", minimum: 75, label: "Company-wide", penetration: 0.9 },
  ];

  const MODELED_TIER = Object.freeze({
    id: "modeled",
    label: "Modeled baseline (no public markers)",
    penetration: null,
  });

  // Client-side fallback so stale cached snapshots still size and classify
  // correctly. Mirrors the server directory.
  const DIRECTORY_PROFILES = Object.freeze({
    "stripe.com": { employees: 8500, engineers: 3200, tier: "tech-forward" },
    "wealthfront.com": { employees: 400, engineers: 195, tier: "tech-forward" },
    "vercel.com": { employees: 700, engineers: 380, tier: "dev-tools" },
    "linear.app": { employees: 100, engineers: 60, tier: "dev-tools" },
    "notion.so": { employees: 800, engineers: 280, tier: "tech-forward" },
    "figma.com": { employees: 1600, engineers: 600, tier: "tech-forward" },
    "github.com": { employees: 4000, engineers: 1800, tier: "dev-tools" },
    "gitlab.com": { employees: 2200, engineers: 900, tier: "dev-tools" },
    "datadoghq.com": { employees: 6500, engineers: 2400, tier: "dev-tools" },
    "snowflake.com": { employees: 7500, engineers: 2800, tier: "dev-tools" },
    "databricks.com": { employees: 6000, engineers: 2600, tier: "dev-tools" },
    "cloudflare.com": { employees: 4000, engineers: 1600, tier: "dev-tools" },
    "twilio.com": { employees: 5500, engineers: 1800, tier: "dev-tools" },
    "shopify.com": { employees: 11000, engineers: 3500, tier: "tech-forward" },
    "coinbase.com": { employees: 4000, engineers: 1500, tier: "tech-forward" },
    "robinhood.com": { employees: 2300, engineers: 800, tier: "tech-forward" },
    "openai.com": { employees: 3500, engineers: 1600, tier: "ai-native" },
    "anthropic.com": { employees: 2000, engineers: 900, tier: "ai-native" },
    "cursor.com": { employees: 200, engineers: 140, tier: "ai-native" },
    "anysphere.com": { employees: 200, engineers: 140, tier: "ai-native" },
    "google.com": { employees: 180000, engineers: 50000, tier: "big-tech" },
    "abc.xyz": { employees: 180000, engineers: 50000, tier: "big-tech" },
    "microsoft.com": { employees: 220000, engineers: 60000, tier: "big-tech" },
    "amazon.com": { employees: 1500000, engineers: 80000, tier: "big-tech" },
    "apple.com": { employees: 160000, engineers: 40000, tier: "big-tech" },
    "meta.com": { employees: 70000, engineers: 28000, tier: "big-tech" },
    "nvidia.com": { employees: 30000, engineers: 12000, tier: "big-tech" },
    "netflix.com": { employees: 13000, engineers: 3500, tier: "tech-forward" },
    "uber.com": { employees: 30000, engineers: 8000, tier: "tech-forward" },
    "airbnb.com": { employees: 7000, engineers: 2200, tier: "tech-forward" },
    "spotify.com": { employees: 10000, engineers: 2800, tier: "tech-forward" },
    "salesforce.com": { employees: 70000, engineers: 15000, tier: "enterprise-tech" },
    "adobe.com": { employees: 30000, engineers: 8000, tier: "enterprise-tech" },
    "tesla.com": { employees: 140000, engineers: 15000, tier: "tech-forward" },
    "palantir.com": { employees: 4000, engineers: 1800, tier: "tech-forward" },
    "intuit.com": { employees: 18000, engineers: 4500, tier: "enterprise-tech" },
    "block.xyz": { employees: 10000, engineers: 2800, tier: "tech-forward" },
    "squareup.com": { employees: 10000, engineers: 2800, tier: "tech-forward" },
    "plaid.com": { employees: 1500, engineers: 600, tier: "tech-forward" },
    "brex.com": { employees: 1200, engineers: 450, tier: "tech-forward" },
    "ramp.com": { employees: 1000, engineers: 400, tier: "tech-forward" },
    "rippling.com": { employees: 2500, engineers: 800, tier: "tech-forward" },
    "hubspot.com": { employees: 8000, engineers: 2200, tier: "tech-forward" },
    "atlassian.com": { employees: 12000, engineers: 4000, tier: "dev-tools" },
    "okta.com": { employees: 5500, engineers: 1800, tier: "dev-tools" },
    "crowdstrike.com": { employees: 8000, engineers: 2500, tier: "dev-tools" },
    "servicenow.com": { employees: 22000, engineers: 5000, tier: "enterprise-tech" },
    "oracle.com": { employees: 160000, engineers: 25000, tier: "enterprise-tech" },
    "ibm.com": { employees: 280000, engineers: 40000, tier: "enterprise-tech" },
    "cisco.com": { employees: 85000, engineers: 18000, tier: "enterprise-tech" },
    "intel.com": { employees: 120000, engineers: 30000, tier: "enterprise-tech" },
    "amd.com": { employees: 26000, engineers: 9000, tier: "enterprise-tech" },
    "discord.com": { employees: 800, engineers: 400, tier: "tech-forward" },
    "slack.com": { employees: 2500, engineers: 900, tier: "tech-forward" },
    "zoom.us": { employees: 8000, engineers: 2200, tier: "enterprise-tech" },
    "dropbox.com": { employees: 2500, engineers: 900, tier: "tech-forward" },
    "reddit.com": { employees: 2500, engineers: 900, tier: "tech-forward" },
    "pinterest.com": { employees: 4000, engineers: 1400, tier: "tech-forward" },
    "snap.com": { employees: 5000, engineers: 1800, tier: "tech-forward" },
    "roblox.com": { employees: 2500, engineers: 1200, tier: "tech-forward" },
    "unity.com": { employees: 5000, engineers: 2000, tier: "dev-tools" },
    "canva.com": { employees: 4000, engineers: 1400, tier: "tech-forward" },
    "grammarly.com": { employees: 1000, engineers: 400, tier: "tech-forward" },
    "duolingo.com": { employees: 800, engineers: 350, tier: "tech-forward" },
    "fastly.com": { employees: 1200, engineers: 450, tier: "dev-tools" },
    "hashicorp.com": { employees: 2000, engineers: 800, tier: "dev-tools" },
    "elastic.co": { employees: 3000, engineers: 1100, tier: "dev-tools" },
    "mongodb.com": { employees: 5000, engineers: 1800, tier: "dev-tools" },
    "sentry.io": { employees: 300, engineers: 160, tier: "dev-tools" },
    "launchdarkly.com": { employees: 700, engineers: 280, tier: "dev-tools" },
    "statsig.com": { employees: 150, engineers: 80, tier: "dev-tools" },
    "retool.com": { employees: 400, engineers: 180, tier: "dev-tools" },
    "supabase.com": { employees: 120, engineers: 70, tier: "dev-tools" },
    "planetscale.com": { employees: 100, engineers: 55, tier: "dev-tools" },
    "neon.tech": { employees: 80, engineers: 45, tier: "dev-tools" },
    "temporal.io": { employees: 150, engineers: 80, tier: "dev-tools" },
    "pulumi.com": { employees: 200, engineers: 90, tier: "dev-tools" },
    "sourcegraph.com": { employees: 300, engineers: 140, tier: "ai-native" },
    "cognition.ai": { employees: 150, engineers: 90, tier: "ai-native" },
    "perplexity.ai": { employees: 300, engineers: 140, tier: "ai-native" },
    "scale.com": { employees: 1000, engineers: 350, tier: "ai-native" },
    "cohere.com": { employees: 400, engineers: 180, tier: "ai-native" },
    "huggingface.co": { employees: 250, engineers: 140, tier: "ai-native" },
    "doordash.com": { employees: 19000, engineers: 4500, tier: "tech-forward" },
    "instacart.com": { employees: 3000, engineers: 900, tier: "tech-forward" },
    "lyft.com": { employees: 4500, engineers: 1400, tier: "tech-forward" },
    "capitalone.com": { employees: 50000, engineers: 12000, tier: "financial-enterprise" },
    "jpmorganchase.com": { employees: 300000, engineers: 50000, tier: "financial-enterprise" },
    "goldmansachs.com": { employees: 45000, engineers: 12000, tier: "financial-enterprise" },
    "morganstanley.com": { employees: 80000, engineers: 15000, tier: "financial-enterprise" },
    "americanexpress.com": { employees: 75000, engineers: 10000, tier: "financial-enterprise" },
    "visa.com": { employees: 30000, engineers: 5000, tier: "financial-enterprise" },
    "mastercard.com": { employees: 33000, engineers: 5500, tier: "financial-enterprise" },
    "paypal.com": { employees: 27000, engineers: 6000, tier: "financial-enterprise" },
    "walmart.com": { employees: 2100000, engineers: 25000, tier: "traditional" },
    "target.com": { employees: 400000, engineers: 8000, tier: "traditional" },
    "nike.com": { employees: 80000, engineers: 5000, tier: "traditional" },
    "starbucks.com": { employees: 380000, engineers: 4000, tier: "traditional" },
    "disney.com": { employees: 220000, engineers: 8000, tier: "traditional" },
    "nytimes.com": { employees: 5000, engineers: 700, tier: "enterprise-tech" },
    "bloomberg.com": { employees: 20000, engineers: 5000, tier: "enterprise-tech" },
  });

  // Backwards-compatible alias (cached client bundles referenced this name).
  const DIRECTORY_SCALE = DIRECTORY_PROFILES;

  // priorMix: expected share of the AI coding wallet in 2026 when no
  // vendor-specific evidence exists. Evidence reweights the mix.
  const VENDORS = [
    {
      id: "claude-code",
      name: "Claude Code",
      company: "Anthropic",
      priorMix: 0.3,
      pricingBasis:
        "Blended Claude seats plus heavy token/API usage (agentic coding routinely exceeds list price)",
      seatModel: "per-developer",
      overallWeight: 0.95,
      contractFloors: [
        { minEngineers: 500, minTier: "standard", annual: 750_000 },
        { minEngineers: 2000, minTier: "standard", annual: 1_800_000 },
        { minEngineers: 2000, minTier: "company-wide", annual: 2_800_000 },
      ],
      signals: [
        { key: "claudeMdFiles", weight: 0.92, halfMax: 2, repoMarker: true },
        { key: "claudeSettings", weight: 0.55, halfMax: 2, repoMarker: true },
        { key: "claudeCoauthoredCommits", weight: 0.8, halfMax: 40 },
        { key: "claudeAppPrs", weight: 0.55, halfMax: 8 },
        { key: "webMentions", weight: 0.5, halfMax: 1 },
        { key: "jobMentions", weight: 0.55, halfMax: 1 },
      ],
    },
    {
      id: "cursor",
      name: "Cursor",
      company: "Anysphere",
      priorMix: 0.27,
      pricingBasis:
        "Cursor Business/Enterprise seats plus usage and Bugbot (large-co ACVs run seven figures)",
      seatModel: "per-developer",
      overallWeight: 0.9,
      contractFloors: [
        { minEngineers: 400, minTier: "standard", annual: 600_000 },
        { minEngineers: 1500, minTier: "standard", annual: 2_000_000 },
        { minEngineers: 1500, minTier: "company-wide", annual: 2_500_000 },
      ],
      signals: [
        { key: "cursorRulesFiles", weight: 0.88, halfMax: 2, repoMarker: true },
        { key: "cursorRulesDir", weight: 0.88, halfMax: 2, repoMarker: true },
        { key: "cursorCoauthoredCommits", weight: 0.78, halfMax: 30 },
        { key: "cursorAgentPrs", weight: 0.6, halfMax: 8 },
        { key: "webMentions", weight: 0.5, halfMax: 1 },
        { key: "jobMentions", weight: 0.55, halfMax: 1 },
      ],
    },
    {
      id: "openai",
      name: "OpenAI Codex",
      company: "OpenAI",
      priorMix: 0.17,
      pricingBasis: "ChatGPT Enterprise/Business plus Codex and API usage",
      seatModel: "per-developer",
      overallWeight: 0.7,
      contractFloors: [
        { minEngineers: 800, minTier: "standard", annual: 600_000 },
        { minEngineers: 2000, minTier: "company-wide", annual: 1_500_000 },
      ],
      signals: [
        { key: "agentsMdFiles", weight: 0.55, halfMax: 3, repoMarker: true },
        { key: "codexConnectorPrs", weight: 0.7, halfMax: 8 },
        { key: "webMentions", weight: 0.5, halfMax: 1 },
        { key: "jobMentions", weight: 0.45, halfMax: 1 },
      ],
    },
    {
      id: "github-copilot",
      name: "GitHub Copilot",
      company: "GitHub",
      priorMix: 0.14,
      pricingBasis: "Copilot Business/Enterprise seats; often a default add-on at large orgs",
      seatModel: "per-developer",
      overallWeight: 0.55,
      contractFloors: [
        { minEngineers: 1500, minTier: "standard", annual: 800_000 },
      ],
      signals: [
        { key: "copilotInstructions", weight: 0.8, halfMax: 2, repoMarker: true },
        { key: "copilotAgentPrs", weight: 0.6, halfMax: 8 },
        { key: "webMentions", weight: 0.45, halfMax: 1 },
        { key: "jobMentions", weight: 0.45, halfMax: 1 },
      ],
    },
    {
      id: "devin",
      name: "Devin",
      company: "Cognition",
      priorMix: 0.12,
      pricePerAgent: 500,
      pricingBasis: "Devin Team/Enterprise, ~$500/mo per concurrent agent",
      seatModel: "per-agent",
      maxAgents: 400,
      overallWeight: 0.45,
      signals: [
        { key: "devinPrs", weight: 0.9, halfMax: 8 },
        { key: "webMentions", weight: 0.55, halfMax: 1 },
        { key: "jobMentions", weight: 0.5, halfMax: 1 },
      ],
    },
  ];

  const OVERALL_TIERS = [
    { minimum: 70, label: "Heavy adopter (evidence-led)" },
    { minimum: 45, label: "Active adopter" },
    { minimum: 25, label: "Modeled adopter (prior-led)" },
    { minimum: 1, label: "Trace signals" },
    { minimum: 0, label: "No basis yet" },
  ];

  const TIER_RANK = Object.fromEntries(
    ADOPTION_TIERS.map((tier, index) => [tier.id, index])
  );

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function saturate(value, halfMax) {
    const v = Math.max(0, Number(value) || 0);
    return v / (v + halfMax);
  }

  function roundSpend(value) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value < 1000) return Math.round(value / 50) * 50;
    if (value < 10000) return Math.round(value / 100) * 100;
    if (value < 100000) return Math.round(value / 1000) * 1000;
    if (value < 1_000_000) return Math.round(value / 5000) * 5000;
    return Math.round(value / 50_000) * 50_000;
  }

  function readingSignalKey(reading) {
    const id = String(reading?.id || "");
    if (id.startsWith("web.mention.")) return "webMentions";
    if (id.startsWith("web.jobs.")) return "jobMentions";
    if (id.startsWith("web.headcount.")) return "webHeadcount";
    const parts = id.split(".");
    return parts.length >= 3 && parts[0] === "github" ? parts.at(-1) : null;
  }

  function webEngineerEstimate(payload) {
    const reading = (payload?.readings || []).find(
      (entry) =>
        entry?.vendor === "company" && String(entry.id || "").startsWith("web.headcount.")
    );
    const value = Number(reading?.value);
    if (!Number.isFinite(value) || value <= 0) return null;
    const unit = String(reading.unit || "engineers");
    const isEmployees = String(reading.id || "").includes(".employees");
    const engineers =
      isEmployees && unit === "employees"
        ? Math.round(value * HEADCOUNT.techEmployeeEngineerShare)
        : value;
    return {
      estimate: Math.round(clamp(engineers, HEADCOUNT.minimum, HEADCOUNT.maximum)),
      detail: reading.detail,
      metric: reading.metric,
      url: reading.url,
    };
  }

  function directoryProfile(payload) {
    const attached = payload?.company?.scale;
    if (attached && (attached.engineers || attached.employees)) {
      const engineers = Number(attached.engineers);
      const employees = Number(attached.employees);
      const tier =
        typeof attached.tier === "string" && COMPANY_TIERS[attached.tier]
          ? attached.tier
          : null;
      if (Number.isFinite(engineers) && engineers > 0) {
        return {
          estimate: Math.round(clamp(engineers, HEADCOUNT.minimum, HEADCOUNT.maximum)),
          employees: Number.isFinite(employees) && employees > 0 ? employees : null,
          tier,
          source: attached.source || "directory",
        };
      }
      if (Number.isFinite(employees) && employees > 0) {
        return {
          estimate: Math.round(
            clamp(
              employees * HEADCOUNT.techEmployeeEngineerShare,
              HEADCOUNT.minimum,
              HEADCOUNT.maximum
            )
          ),
          employees,
          tier,
          source: attached.source || "directory",
        };
      }
    }
    const domain = String(payload?.domain || payload?.company?.domain || "").toLowerCase();
    const known = DIRECTORY_PROFILES[domain];
    if (!known) return null;
    return {
      estimate: Math.round(
        clamp(
          known.engineers || known.employees * HEADCOUNT.techEmployeeEngineerShare,
          HEADCOUNT.minimum,
          HEADCOUNT.maximum
        )
      ),
      employees: known.employees || null,
      tier: known.tier || null,
      source: "directory",
    };
  }

  function aggregateSignals(readings, vendorId) {
    const totals = new Map();
    for (const reading of Array.isArray(readings) ? readings : []) {
      if (reading?.vendor !== vendorId) continue;
      const key = readingSignalKey(reading);
      if (!key) continue;
      const value = Math.max(0, Number(reading.value) || 0);
      totals.set(key, (totals.get(key) || 0) + value);
    }
    return totals;
  }

  function totalPublicRepos(payload) {
    return (payload?.company?.githubOrgs || []).reduce(
      (sum, org) => sum + Math.max(0, Number(org?.publicRepos) || 0),
      0
    );
  }

  function totalPublicMembers(payload) {
    return (payload?.company?.githubOrgs || []).reduce(
      (sum, org) => sum + Math.max(0, Number(org?.publicMembers) || 0),
      0
    );
  }

  function totalFollowers(payload) {
    return (payload?.company?.githubOrgs || []).reduce(
      (sum, org) => sum + Math.max(0, Number(org?.followers) || 0),
      0
    );
  }

  function githubScaleEstimate(payload) {
    const members = totalPublicMembers(payload);
    const repos = totalPublicRepos(payload);
    const followers = totalFollowers(payload);
    const candidates = [];
    if (members > 0) candidates.push(members * HEADCOUNT.membersMultiplier);
    if (repos > 0) candidates.push(repos * HEADCOUNT.reposMultiplier);
    if (followers >= 400) candidates.push(followers * HEADCOUNT.followerEngineerRatio);
    if (candidates.length === 0) return null;
    return Math.round(
      clamp(Math.max(...candidates), HEADCOUNT.minimum, HEADCOUNT.maximum)
    );
  }

  function estimateHeadcount(payload, headcountOverride) {
    const override = Number(headcountOverride);
    if (Number.isFinite(override) && override > 0) {
      return {
        estimate: Math.round(clamp(override, 1, 500000)),
        basis: "manual",
        description: "Developer headcount entered manually.",
      };
    }
    const known = directoryProfile(payload);
    if (known) {
      const tierLabelText = known.tier ? COMPANY_TIERS[known.tier].label : null;
      return {
        estimate: known.estimate,
        basis: "directory-scale",
        description: known.employees
          ? `Curated scale: ~${known.estimate.toLocaleString("en-US")} engineers (${known.employees.toLocaleString("en-US")} employees${tierLabelText ? `, ${tierLabelText.toLowerCase()}` : ""}).`
          : `Curated scale: ~${known.estimate.toLocaleString("en-US")} engineers.`,
      };
    }
    const web = webEngineerEstimate(payload);
    const github = githubScaleEstimate(payload);
    if (web && github) {
      const estimate = Math.round(
        clamp(Math.max(web.estimate, github), HEADCOUNT.minimum, HEADCOUNT.maximum)
      );
      return {
        estimate,
        basis: "web+github",
        description: `${web.metric} plus GitHub org scale; using ~${estimate.toLocaleString("en-US")} engineers.`,
        url: web.url,
      };
    }
    if (web) {
      return {
        estimate: web.estimate,
        basis: "web-reported",
        description: `${web.metric}: about ${web.estimate.toLocaleString("en-US")} engineers from public pages.`,
        url: web.url,
      };
    }
    if (github) {
      const members = totalPublicMembers(payload);
      const repos = totalPublicRepos(payload);
      return {
        estimate: github,
        basis: members > 0 ? "github-scale" : "github-repos",
        description: members > 0
          ? `${members} public GitHub members × ${HEADCOUNT.membersMultiplier} (public membership is a thin slice) and repo/follower floors.`
          : `${repos} public repositories × ${HEADCOUNT.reposMultiplier} (weak proxy).`,
      };
    }
    return {
      estimate: null,
      basis: "unknown",
      description:
        "No org scale yet — enter engineer headcount to model expected spend.",
    };
  }

  function snapshotConfidence(payload, now) {
    const coverage = payload?.coverage || {};
    let confidence = 0.15;
    if (coverage.githubOrgResolved) confidence += 0.2;
    if (coverage.codeSearch) confidence += 0.15;
    if (coverage.commitSearch) confidence += 0.15;
    if (coverage.prSearch) confidence += 0.1;
    if (coverage.webResearch === "ok") confidence += 0.1;
    if (coverage.githubAuthenticated) confidence += 0.05;
    if (directoryProfile(payload)) confidence += 0.08;
    if (!coverage.githubOrgResolved && !directoryProfile(payload)) {
      confidence = Math.min(confidence, 0.4);
    }
    const collected = Date.parse(payload?.collectedAt || "");
    if (Number.isFinite(collected)) {
      const ageDays = Math.max(0, (now.getTime() - collected) / 86400000);
      const recency =
        ageDays <= 30 ? 1 : Math.max(0.7, 1 - ((ageDays - 30) / 150) * 0.3);
      confidence *= recency;
    }
    return clamp(confidence, 0.05, 0.92);
  }

  // Tech-forwardness in [0.15, 1]: curated tier when known, otherwise a
  // multi-source heuristic over the public footprint.
  function techForwardness(payload, signalStrength) {
    const profile = directoryProfile(payload);
    if (profile?.tier) {
      const tier = COMPANY_TIERS[profile.tier];
      const value = clamp(
        tier.tech + ECONOMICS.techEvidenceLift * (signalStrength || 0),
        0.15,
        1
      );
      return {
        value,
        tierId: profile.tier,
        label: tier.label,
        basis: "directory",
        vendorShare: tier.vendorShare || 1,
      };
    }
    const orgs = payload?.company?.githubOrgs || [];
    const drivers = [];
    let value = 0.45;
    if (payload?.coverage?.githubOrgResolved && orgs.length > 0) {
      value += 0.15;
      drivers.push("public GitHub engineering org");
    }
    if (orgs.some((org) => org?.isVerified)) {
      value += 0.05;
      drivers.push("verified GitHub org");
    }
    const blog = String(orgs[0]?.blog || "");
    if (/(^|\/\/)(eng|engineering|tech|developer|dev)\./i.test(blog) || /\/(engineering|eng|blog)\b/i.test(blog)) {
      value += 0.08;
      drivers.push("engineering blog");
    }
    if (totalPublicRepos(payload) >= 15) {
      value += 0.06;
      drivers.push("meaningful OSS footprint");
    }
    const hasJobSignal = (payload?.readings || []).some(
      (reading) => String(reading?.id || "").startsWith("web.jobs.") && reading.value > 0
    );
    if (hasJobSignal) {
      value += 0.05;
      drivers.push("AI tooling in job posts");
    }
    if ((signalStrength || 0) > 0) {
      value += 0.1 + ECONOMICS.techEvidenceLift * signalStrength;
      drivers.push("direct AI coding markers");
    }
    return {
      value: clamp(value, 0.15, 0.9),
      tierId: null,
      label: "Heuristic classification",
      basis: drivers.length > 0 ? drivers.join(", ") : "no strong firmographic markers",
      vendorShare: 1,
    };
  }

  function vendorAdoption(vendor, totals, repoBase) {
    const components = [];
    let survivor = 1;
    for (const signal of vendor.signals) {
      const value = totals.get(signal.key) || 0;
      let fraction = saturate(value, signal.halfMax);
      if (signal.repoMarker && value > 0 && repoBase > 0) {
        const coverage = value / repoBase;
        fraction = Math.max(fraction, saturate(coverage, 0.08));
      }
      const contribution = signal.weight * fraction;
      components.push({
        key: signal.key,
        value,
        weight: signal.weight,
        contribution: Math.round(contribution * 1000) / 1000,
      });
      survivor *= 1 - contribution;
    }
    return {
      adoptionScore: Math.round(100 * (1 - survivor)),
      components,
    };
  }

  function adoptionTierForScore(score) {
    let selected = ADOPTION_TIERS[0];
    for (const tier of ADOPTION_TIERS) {
      if (score >= tier.minimum) selected = tier;
    }
    return selected;
  }

  function spendBand(mid, confidence, hasEvidence) {
    const lowFactor = hasEvidence
      ? BAND.evidenceLowBase + BAND.evidenceLowGain * confidence
      : BAND.priorLowBase + BAND.priorLowGain * confidence;
    const highFactor = hasEvidence
      ? BAND.evidenceHighBase - BAND.evidenceHighGain * confidence
      : BAND.priorHighBase - BAND.priorHighGain * confidence;
    const low = roundSpend(mid * lowFactor);
    const high = roundSpend(mid * highFactor);
    return {
      low: Math.min(low, roundSpend(mid)),
      mid: roundSpend(mid),
      high: Math.max(high, roundSpend(mid)),
    };
  }

  function contractFloorMonthly(vendor, tierId, engineers) {
    if (!Array.isArray(vendor.contractFloors) || !engineers) return 0;
    const rank = TIER_RANK[tierId] || 0;
    let best = 0;
    for (const floor of vendor.contractFloors) {
      if (engineers < floor.minEngineers) continue;
      if (rank < (TIER_RANK[floor.minTier] || 0)) continue;
      best = Math.max(best, floor.annual / 12);
    }
    return best;
  }

  function overallSignalStrength(vendorScores) {
    let survivor = 1;
    for (const vendor of VENDORS) {
      const score = (vendorScores.get(vendor.id) || 0) / 100;
      survivor *= 1 - score * vendor.overallWeight;
    }
    return 1 - survivor;
  }

  function tierLabel(score) {
    for (const tier of OVERALL_TIERS) {
      if (score >= tier.minimum) return tier.label;
    }
    return OVERALL_TIERS.at(-1).label;
  }

  function scoreCompany(payload, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const headcount = estimateHeadcount(payload, options.headcountOverride);
    const confidence = snapshotConfidence(payload, now);
    const repoBase = clamp(totalPublicRepos(payload), 5, 400);

    // Per-vendor evidence.
    const vendorEvidence = new Map();
    for (const vendor of VENDORS) {
      const totals = aggregateSignals(payload?.readings, vendor.id);
      vendorEvidence.set(vendor.id, {
        totals,
        ...vendorAdoption(vendor, totals, repoBase),
      });
    }
    const vendorScores = new Map(
      VENDORS.map((vendor) => [vendor.id, vendorEvidence.get(vendor.id).adoptionScore])
    );
    const signalStrength = overallSignalStrength(vendorScores);
    const hasEvidence = signalStrength > 0;

    const tech = techForwardness(payload, signalStrength);
    const engineers = headcount.estimate;

    // Expected-spend prior: org × adoption × blended $/engineer × evidence.
    let economics = null;
    if (engineers) {
      const adoptionRate = clamp(
        ECONOMICS.adoptionBase + ECONOMICS.adoptionGain * tech.value,
        0.2,
        ECONOMICS.adoptionMax
      );
      const adoptedEngineers = engineers * adoptionRate;
      const perEngineer =
        (ECONOMICS.perEngineerBase + ECONOMICS.perEngineerGain * tech.value) *
        clamp(
          ECONOMICS.scaleMax -
            ECONOMICS.scaleSlope * Math.log(engineers / ECONOMICS.scaleRefEngineers),
          ECONOMICS.scaleMin,
          ECONOMICS.scaleMax
        );
      const evidenceMultiplier = hasEvidence
        ? clamp(
            ECONOMICS.evidenceBase + ECONOMICS.evidenceGain * signalStrength,
            ECONOMICS.evidenceBase,
            ECONOMICS.evidenceMax
          )
        : tech.value >= 0.75
          ? ECONOMICS.noSignalHighTech
          : tech.value >= 0.5
            ? ECONOMICS.noSignalMidTech
            : ECONOMICS.noSignalLowTech;
      const totalMonthlyMid =
        adoptedEngineers * perEngineer * evidenceMultiplier * (tech.vendorShare || 1);
      economics = {
        adoptionRate: Math.round(adoptionRate * 100) / 100,
        adoptedEngineers: Math.round(adoptedEngineers),
        perEngineerMonthly: Math.round(perEngineer),
        evidenceMultiplier: Math.round(evidenceMultiplier * 100) / 100,
        vendorShare: tech.vendorShare || 1,
        totalMonthlyMid,
      };
    }

    // Vendor allocation: prior mix blended with observed signal share.
    const weights = VENDORS.map((vendor) => {
      const score = (vendorScores.get(vendor.id) || 0) / 100;
      return vendor.priorMix * (0.35 + 1.3 * score);
    });
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || 1;

    const vendors = VENDORS.map((vendor, index) => {
      const evidence = vendorEvidence.get(vendor.id);
      const share = weights[index] / weightSum;
      const score = evidence.adoptionScore;
      const evidenceTier = adoptionTierForScore(score);
      const readings = (payload?.readings || [])
        .filter((reading) => reading?.vendor === vendor.id)
        .slice()
        .sort((left, right) => (right.value || 0) - (left.value || 0));

      const result = {
        id: vendor.id,
        name: vendor.name,
        company: vendor.company,
        seatModel: vendor.seatModel,
        pricingBasis: vendor.pricingBasis,
        adoptionScore: score,
        adoptionTier: evidenceTier.id,
        adoptionTierLabel: evidenceTier.label,
        mixShare: Math.round(share * 100) / 100,
        confidence,
        signals: evidence.components,
        evidence: readings,
        seats: null,
        agents: null,
        monthly: null,
        annual: null,
        notes: [],
      };

      if (!engineers) {
        if (score > 0) {
          result.notes.push(
            "Adoption signals found, but no engineer headcount — enter one to model spend."
          );
        } else {
          result.monthly = { low: 0, mid: 0, high: 0 };
          result.annual = { low: 0, mid: 0, high: 0 };
        }
        return result;
      }

      let monthlyMid = economics.totalMonthlyMid * share;

      if (vendor.seatModel === "per-agent") {
        const capMonthly = vendor.maxAgents * vendor.pricePerAgent;
        monthlyMid = Math.min(monthlyMid, capMonthly);
        result.agents = Math.max(
          monthlyMid > 0 ? 1 : 0,
          Math.round(monthlyMid / vendor.pricePerAgent)
        );
      } else {
        const floor = contractFloorMonthly(vendor, evidenceTier.id, engineers);
        if (floor > monthlyMid) {
          monthlyMid = floor;
          result.notes.push(
            `Enterprise ACV floor applied (${formatUsd(floor * 12)}/yr) — large-co contracts exceed modeled share.`
          );
        }
        result.seats = Math.max(1, Math.round(economics.adoptedEngineers * share));
      }

      if (score === 0 && monthlyMid > 0) {
        result.adoptionTier = MODELED_TIER.id;
        result.adoptionTierLabel = MODELED_TIER.label;
        result.notes.push(
          "No public markers — spend is the firmographic prior share, not observed usage."
        );
      }

      const monthly = spendBand(monthlyMid, confidence, score > 0);
      result.monthly = monthly;
      result.annual = {
        low: monthly.low * 12,
        mid: monthly.mid * 12,
        high: monthly.high * 12,
      };
      return result;
    });

    const priced = vendors.filter((vendor) => vendor.monthly && vendor.monthly.mid > 0);
    const unpriced = vendors.filter(
      (vendor) => vendor.adoptionScore > 0 && !vendor.monthly
    );
    const totalMonthly =
      priced.length > 0
        ? {
            low: priced.reduce((sum, vendor) => sum + vendor.monthly.low, 0),
            mid: priced.reduce((sum, vendor) => sum + vendor.monthly.mid, 0),
            high: priced.reduce((sum, vendor) => sum + vendor.monthly.high, 0),
            complete: unpriced.length === 0,
          }
        : null;

    const score =
      engineers || hasEvidence
        ? Math.round(100 * clamp(0.45 * tech.value + 0.55 * signalStrength, 0, 1))
        : 0;

    const caveats = [
      "Expected-spend model — not invoices. Firmographic priors set the baseline; public evidence tunes it.",
      "Private repos and API bills are invisible; absence of public markers only mildly lowers the estimate.",
      "Blended per-engineer spend includes seats plus token/API/agent usage — routinely several times list price.",
    ];
    if (headcount.basis !== "manual" && headcount.estimate) {
      caveats.push(`Headcount is inferred: ${headcount.description}`);
    }
    if (!hasEvidence && engineers) {
      caveats.push(
        "No public AI markers were found — this read is prior-led with wide bands. Override headcount or re-scan to tighten."
      );
    }

    const report = {
      model: MODEL,
      domain: payload?.domain || null,
      company: payload?.company || null,
      coverage: payload?.coverage || null,
      collectedAt: payload?.collectedAt || null,
      generatedAt: now.toISOString(),
      confidence: Math.round(confidence * 100) / 100,
      overall: { score, tier: tierLabel(score) },
      headcount,
      techForwardness: {
        value: Math.round(tech.value * 100) / 100,
        tierId: tech.tierId,
        label: tech.label,
        basis: tech.basis,
      },
      economics: economics
        ? {
            adoptionRate: economics.adoptionRate,
            adoptedEngineers: economics.adoptedEngineers,
            perEngineerMonthly: economics.perEngineerMonthly,
            evidenceMultiplier: economics.evidenceMultiplier,
          }
        : null,
      signalStrength: Math.round(signalStrength * 100) / 100,
      vendors,
      totalMonthly,
      totalAnnual: totalMonthly
        ? {
            low: totalMonthly.low * 12,
            mid: totalMonthly.mid * 12,
            high: totalMonthly.high * 12,
            complete: totalMonthly.complete,
          }
        : null,
      caveats,
    };
    report.brief = buildBrief(report);
    return report;
  }

  function formatUsd(value) {
    if (!Number.isFinite(value) || value <= 0) return "$0";
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
    }
    if (value >= 10_000) return `$${Math.round(value / 1000)}k`;
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
    return `$${Math.round(value)}`;
  }

  function buildBrief(report) {
    const companyName = report.company?.name || report.domain || "This company";
    const priced = report.vendors
      .filter((vendor) => (vendor.monthly?.mid || 0) > 0)
      .slice()
      .sort(
        (left, right) =>
          right.monthly.mid - left.monthly.mid ||
          right.adoptionScore - left.adoptionScore
      );
    const withSignals = report.vendors.filter((vendor) => vendor.adoptionScore > 0);
    const primary = priced[0] || withSignals[0] || null;
    const total = report.totalMonthly;
    const annual = report.totalAnnual;
    const priorLed = (report.signalStrength || 0) === 0;
    const mix = priced.map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      pct: total?.mid ? Math.round((vendor.monthly.mid / total.mid) * 100) : 0,
      monthly: vendor.monthly,
      annual: vendor.annual,
    }));

    let headline;
    if (annual?.mid && priorLed) {
      headline = `${companyName} models to a ${formatUsd(annual.mid)}/yr AI coding stack (${formatUsd(total.mid)}/mo) — prior-led, no public markers found.`;
    } else if (annual?.mid && primary) {
      headline = `${companyName} looks like a ${formatUsd(annual.mid)}/yr AI coding stack (${formatUsd(total.mid)}/mo), ${primary.name}-led.`;
    } else if (primary && primary.adoptionScore > 0) {
      headline = `${companyName} is adopting ${primary.name}, but headcount is needed to price spend.`;
    } else {
      headline = `${companyName} needs an engineer headcount before spend can be modeled.`;
    }

    const drivers = [];
    for (const vendor of withSignals.slice(0, 3)) {
      const topSignal = (vendor.evidence || []).find((item) => item.value > 0);
      if (topSignal) {
        drivers.push(
          `${vendor.name} (${vendor.adoptionTierLabel || "signal"}): ${String(topSignal.metric || "").toLowerCase()} (${Number(topSignal.value).toLocaleString("en-US")})`
        );
      }
    }
    if (drivers.length === 0 && report.techForwardness) {
      drivers.push(
        `Firmographics: ${report.techForwardness.label.toLowerCase()} (${report.techForwardness.basis})`
      );
    }

    const thesisParts = [];
    if (report.economics && report.headcount.estimate) {
      thesisParts.push(
        `Modeled at ~$${report.economics.perEngineerMonthly.toLocaleString("en-US")}/engineer/mo across ~${report.economics.adoptedEngineers.toLocaleString("en-US")} adopted engineers (of ${report.headcount.estimate.toLocaleString("en-US")}, ${report.headcount.basis.replace(/-/g, " ")}).`
      );
      thesisParts.push(
        `Tech-forwardness ${(report.techForwardness.value * 100).toFixed(0)}/100 — ${report.techForwardness.label.toLowerCase()}.`
      );
    }
    if (priorLed && annual?.mid) {
      thesisParts.push(
        "No public AI markers surfaced; the estimate is the firmographic prior for a company of this profile, with wide bands."
      );
    } else if (primary && primary.adoptionScore > 0) {
      thesisParts.push(
        `${primary.name} is the strongest public signal (${primary.adoptionScore}/100 → ${primary.adoptionTierLabel}).`
      );
      if (mix[0] && mix[0].pct >= 40) {
        thesisParts.push(`It accounts for about ${mix[0].pct}% of modeled spend.`);
      }
    }
    if (!report.headcount.estimate) {
      thesisParts.push(
        "No engineer count yet — override headcount to unlock a dollar range."
      );
    }
    thesisParts.push(
      "Public GitHub is the tip of the iceberg; private-repo and API spend is modeled, not observed."
    );

    return {
      headline,
      thesis: thesisParts.join(" "),
      primary: primary ? { id: primary.id, name: primary.name } : null,
      mix,
      drivers,
      confidenceLabel:
        report.confidence >= 0.75
          ? "High"
          : report.confidence >= 0.45
            ? "Medium"
            : "Low",
    };
  }

  return {
    MODEL,
    VENDORS,
    COMPANY_TIERS,
    ECONOMICS,
    DIRECTORY_PROFILES,
    DIRECTORY_SCALE,
    aggregateSignals,
    adoptionTierForScore,
    buildBrief,
    estimateHeadcount,
    formatUsd,
    roundSpend,
    saturate,
    scoreCompany,
    snapshotConfidence,
    techForwardness,
  };
});
