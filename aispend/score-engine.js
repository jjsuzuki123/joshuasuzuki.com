(function initSpendscopeScoring(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.SpendscopeScoring = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSpendscopeScoring() {
  "use strict";

  /**
   * Spendscope ACES v2 — AI Coding Expenditure Signal
   *
   * Public GitHub/web hits are an iceberg tip, not a seat census. v1
   * treated saturating file/commit counts as penetration and priced SMB
   * list seats — that produced "$8k/mo at Stripe" while a single Cursor
   * enterprise contract can be ~$2.5M/yr.
   *
   * v2:
   *   1. Size the engineering org (directory scale, web, then aggressive
   *      GitHub expansion — public membership is ~5–10% at bigcos).
   *   2. Map public signals to an adoption *tier* (trace → company-wide).
   *      Any real marker/job trail at scale means private usage is assumed.
   *   3. Price as org × tier penetration × enterprise $/seat, with annual
   *      ACV floors for large orgs on standardized tools (Cursor calibrated
   *      to a $2.5M Stripe-scale contract).
   */

  const MODEL = Object.freeze({
    id: "ACES",
    version: "2.0.0",
    name: "AI Coding Expenditure Signal",
  });

  const HEADCOUNT = Object.freeze({
    membersMultiplier: 12,
    reposMultiplier: 8,
    followerEngineerRatio: 0.35,
    minimum: 8,
    maximum: 80000,
    techEmployeeEngineerShare: 0.4,
  });

  const BAND = Object.freeze({
    lowBase: 0.4,
    lowGain: 0.25,
    highBase: 2.8,
    highGain: 1.2,
  });

  const ADOPTION_TIERS = [
    { id: "none", minimum: 0, label: "No public signals", penetration: 0 },
    { id: "trace", minimum: 1, label: "Trace signals", penetration: 0.08 },
    { id: "emerging", minimum: 12, label: "Emerging rollout", penetration: 0.22 },
    { id: "rolling-out", minimum: 28, label: "Rolling out", penetration: 0.42 },
    { id: "standard", minimum: 50, label: "Org standard", penetration: 0.7 },
    { id: "company-wide", minimum: 75, label: "Company-wide", penetration: 0.9 },
  ];

  // Client-side fallback so stale cached snapshots still size correctly.
  const DIRECTORY_SCALE = Object.freeze({
    "stripe.com": { employees: 8500, engineers: 3200 },
    "vercel.com": { employees: 700, engineers: 380 },
    "linear.app": { employees: 100, engineers: 60 },
    "notion.so": { employees: 800, engineers: 280 },
    "figma.com": { employees: 1600, engineers: 600 },
    "github.com": { employees: 4000, engineers: 1800 },
    "gitlab.com": { employees: 2200, engineers: 900 },
    "datadoghq.com": { employees: 6500, engineers: 2400 },
    "snowflake.com": { employees: 7500, engineers: 2800 },
    "databricks.com": { employees: 6000, engineers: 2600 },
    "cloudflare.com": { employees: 4000, engineers: 1600 },
    "twilio.com": { employees: 5500, engineers: 1800 },
    "shopify.com": { employees: 11000, engineers: 3500 },
    "coinbase.com": { employees: 4000, engineers: 1500 },
    "openai.com": { employees: 3500, engineers: 1600 },
    "anthropic.com": { employees: 2000, engineers: 900 },
    "cursor.com": { employees: 200, engineers: 140 },
    "anysphere.com": { employees: 200, engineers: 140 },
    "google.com": { employees: 180000, engineers: 50000 },
    "abc.xyz": { employees: 180000, engineers: 50000 },
    "microsoft.com": { employees: 220000, engineers: 60000 },
    "amazon.com": { employees: 1500000, engineers: 80000 },
    "apple.com": { employees: 160000, engineers: 40000 },
    "meta.com": { employees: 70000, engineers: 28000 },
    "netflix.com": { employees: 13000, engineers: 3500 },
    "uber.com": { employees: 30000, engineers: 8000 },
    "airbnb.com": { employees: 7000, engineers: 2200 },
    "spotify.com": { employees: 10000, engineers: 2800 },
    "salesforce.com": { employees: 70000, engineers: 15000 },
    "adobe.com": { employees: 30000, engineers: 8000 },
    "nvidia.com": { employees: 30000, engineers: 12000 },
    "tesla.com": { employees: 140000, engineers: 15000 },
    "palantir.com": { employees: 4000, engineers: 1800 },
    "intuit.com": { employees: 18000, engineers: 4500 },
    "block.xyz": { employees: 10000, engineers: 2800 },
    "squareup.com": { employees: 10000, engineers: 2800 },
    "plaid.com": { employees: 1500, engineers: 600 },
    "brex.com": { employees: 1200, engineers: 450 },
    "ramp.com": { employees: 1000, engineers: 400 },
    "rippling.com": { employees: 2500, engineers: 800 },
    "hubspot.com": { employees: 8000, engineers: 2200 },
    "atlassian.com": { employees: 12000, engineers: 4000 },
    "okta.com": { employees: 5500, engineers: 1800 },
    "crowdstrike.com": { employees: 8000, engineers: 2500 },
    "servicenow.com": { employees: 22000, engineers: 5000 },
    "oracle.com": { employees: 160000, engineers: 25000 },
    "ibm.com": { employees: 280000, engineers: 40000 },
    "cisco.com": { employees: 85000, engineers: 18000 },
    "intel.com": { employees: 120000, engineers: 30000 },
    "amd.com": { employees: 26000, engineers: 9000 },
    "discord.com": { employees: 800, engineers: 400 },
    "slack.com": { employees: 2500, engineers: 900 },
    "zoom.us": { employees: 8000, engineers: 2200 },
    "dropbox.com": { employees: 2500, engineers: 900 },
    "reddit.com": { employees: 2500, engineers: 900 },
    "pinterest.com": { employees: 4000, engineers: 1400 },
    "snap.com": { employees: 5000, engineers: 1800 },
    "roblox.com": { employees: 2500, engineers: 1200 },
    "unity.com": { employees: 5000, engineers: 2000 },
    "canva.com": { employees: 4000, engineers: 1400 },
    "grammarly.com": { employees: 1000, engineers: 400 },
    "duolingo.com": { employees: 800, engineers: 350 },
    "fastly.com": { employees: 1200, engineers: 450 },
    "hashicorp.com": { employees: 2000, engineers: 800 },
    "elastic.co": { employees: 3000, engineers: 1100 },
    "mongodb.com": { employees: 5000, engineers: 1800 },
    "sentry.io": { employees: 300, engineers: 160 },
    "launchdarkly.com": { employees: 700, engineers: 280 },
    "statsig.com": { employees: 150, engineers: 80 },
    "retool.com": { employees: 400, engineers: 180 },
    "supabase.com": { employees: 120, engineers: 70 },
    "planetscale.com": { employees: 100, engineers: 55 },
    "neon.tech": { employees: 80, engineers: 45 },
    "temporal.io": { employees: 150, engineers: 80 },
    "pulumi.com": { employees: 200, engineers: 90 },
    "sourcegraph.com": { employees: 300, engineers: 140 },
    "cognition.ai": { employees: 150, engineers: 90 },
    "perplexity.ai": { employees: 300, engineers: 140 },
    "scale.com": { employees: 1000, engineers: 350 },
    "cohere.com": { employees: 400, engineers: 180 },
    "huggingface.co": { employees: 250, engineers: 140 },
    "doordash.com": { employees: 19000, engineers: 4500 },
    "instacart.com": { employees: 3000, engineers: 900 },
    "lyft.com": { employees: 4500, engineers: 1400 },
    "capitalone.com": { employees: 50000, engineers: 12000 },
    "jpmorganchase.com": { employees: 300000, engineers: 50000 },
    "goldmansachs.com": { employees: 45000, engineers: 12000 },
    "morganstanley.com": { employees: 80000, engineers: 15000 },
    "americanexpress.com": { employees: 75000, engineers: 10000 },
    "visa.com": { employees: 30000, engineers: 5000 },
    "mastercard.com": { employees: 33000, engineers: 5500 },
    "paypal.com": { employees: 27000, engineers: 6000 },
    "walmart.com": { employees: 2100000, engineers: 25000 },
    "target.com": { employees: 400000, engineers: 8000 },
    "nike.com": { employees: 80000, engineers: 5000 },
    "starbucks.com": { employees: 380000, engineers: 4000 },
    "disney.com": { employees: 220000, engineers: 8000 },
    "nytimes.com": { employees: 5000, engineers: 700 },
    "bloomberg.com": { employees: 20000, engineers: 5000 },
  });

  const VENDORS = [
    {
      id: "claude-code",
      name: "Claude Code",
      company: "Anthropic",
      pricePerSeat: 110,
      pricingBasis:
        "Enterprise blend: Claude Max/Team seats plus API/overage (~$110/dev/mo effective)",
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
      pricePerSeat: 65,
      pricingBasis:
        "Cursor Business/Enterprise effective (~$40 seat + usage/Bugbot; large-co ACV often $2M+/yr)",
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
      pricePerSeat: 75,
      pricingBasis: "ChatGPT Enterprise/Business plus Codex/API usage",
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
      pricePerSeat: 39,
      pricingBasis: "Copilot Enterprise ($39/seat); often a default add-on at large orgs",
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
      pricePerAgent: 500,
      pricingBasis: "Devin Team/Enterprise, $500/mo per concurrent agent",
      seatModel: "per-agent",
      agentsPerEngineer: 0.018,
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
    { minimum: 70, label: "Heavy adopter" },
    { minimum: 40, label: "Active adopter" },
    { minimum: 15, label: "Early signals" },
    { minimum: 1, label: "Trace signals" },
    { minimum: 0, label: "No public signals" },
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

  function directoryScale(payload) {
    const attached = payload?.company?.scale;
    if (attached && (attached.engineers || attached.employees)) {
      const engineers = Number(attached.engineers);
      const employees = Number(attached.employees);
      if (Number.isFinite(engineers) && engineers > 0) {
        return {
          estimate: Math.round(clamp(engineers, HEADCOUNT.minimum, HEADCOUNT.maximum)),
          employees: Number.isFinite(employees) ? employees : null,
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
          source: attached.source || "directory",
        };
      }
    }
    const domain = String(payload?.domain || payload?.company?.domain || "").toLowerCase();
    const known = DIRECTORY_SCALE[domain];
    if (!known) return null;
    return {
      estimate: Math.round(
        clamp(known.engineers || known.employees * HEADCOUNT.techEmployeeEngineerShare,
          HEADCOUNT.minimum,
          HEADCOUNT.maximum)
      ),
      employees: known.employees || null,
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
    const known = directoryScale(payload);
    if (known) {
      return {
        estimate: known.estimate,
        basis: "directory-scale",
        description: known.employees
          ? `Curated scale: ~${known.estimate.toLocaleString("en-US")} engineers (${known.employees.toLocaleString("en-US")} employees).`
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
        "No org scale yet — enter engineer headcount to model enterprise spend.",
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
    if (directoryScale(payload)) confidence += 0.08;
    if (!coverage.githubOrgResolved && !directoryScale(payload)) {
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

  function spendBand(mid, confidence) {
    const low = roundSpend(mid * (BAND.lowBase + BAND.lowGain * confidence));
    const high = roundSpend(
      mid * (BAND.highBase - BAND.highGain * confidence)
    );
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

  function scoreVendor(vendor, payload, context) {
    const totals = aggregateSignals(payload?.readings, vendor.id);
    const { adoptionScore, components } = vendorAdoption(
      vendor,
      totals,
      context.repoBase
    );
    const tier = adoptionTierForScore(adoptionScore);
    const evidence = (payload?.readings || [])
      .filter((reading) => reading?.vendor === vendor.id)
      .slice()
      .sort((left, right) => (right.value || 0) - (left.value || 0));

    const result = {
      id: vendor.id,
      name: vendor.name,
      company: vendor.company,
      seatModel: vendor.seatModel,
      pricingBasis: vendor.pricingBasis,
      adoptionScore,
      adoptionTier: tier.id,
      adoptionTierLabel: tier.label,
      penetration: tier.penetration,
      confidence: context.confidence,
      signals: components,
      evidence,
      seats: null,
      agents: null,
      monthly: null,
      annual: null,
      notes: [],
    };

    if (adoptionScore === 0) {
      result.monthly = { low: 0, mid: 0, high: 0 };
      result.annual = { low: 0, mid: 0, high: 0 };
      return result;
    }

    if (vendor.seatModel === "per-agent") {
      const prs = totals.get("devinPrs") || 0;
      const fromPrs = prs > 0 ? Math.ceil(prs / 6) : 0;
      const fromOrg = context.devHeadcount
        ? Math.ceil(context.devHeadcount * tier.penetration * vendor.agentsPerEngineer)
        : 0;
      const agents = Math.round(
        clamp(Math.max(fromPrs, fromOrg, prs > 0 || fromOrg > 0 ? 2 : 0), 0, vendor.maxAgents)
      );
      result.agents = agents;
      if (agents === 0) {
        result.monthly = { low: 0, mid: 0, high: 0 };
        result.annual = { low: 0, mid: 0, high: 0 };
        result.notes.push(
          "Mentions only — not enough signal to size concurrent Devin agents."
        );
        return result;
      }
      const monthly = spendBand(agents * vendor.pricePerAgent, context.confidence);
      result.monthly = monthly;
      result.annual = {
        low: monthly.low * 12,
        mid: monthly.mid * 12,
        high: monthly.high * 12,
      };
      return result;
    }

    if (!context.devHeadcount) {
      result.notes.push(
        "Adoption signals found, but no engineer headcount — enter one to model spend."
      );
      return result;
    }

    const seats = Math.max(
      1,
      Math.round(context.devHeadcount * tier.penetration)
    );
    result.seats = seats;
    const seatSpend = seats * vendor.pricePerSeat;
    const floor = contractFloorMonthly(vendor, tier.id, context.devHeadcount);
    const mid = Math.max(seatSpend, floor);
    if (floor > seatSpend) {
      result.notes.push(
        `Enterprise ACV floor applied (${formatUsd(floor * 12)}/yr) — list seats understate large-co contracts.`
      );
    }
    result.notes.push(
      "Public markers size adoption intensity, not billable seats. Private-repo usage is assumed."
    );
    const monthly = spendBand(mid, context.confidence);
    result.monthly = monthly;
    result.annual = {
      low: monthly.low * 12,
      mid: monthly.mid * 12,
      high: monthly.high * 12,
    };
    return result;
  }

  function overallScore(vendorResults) {
    let survivor = 1;
    for (const vendor of vendorResults) {
      const config = VENDORS.find((entry) => entry.id === vendor.id);
      survivor *= 1 - (vendor.adoptionScore / 100) * (config?.overallWeight || 0.5);
    }
    return Math.round(100 * (1 - survivor));
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
    const context = {
      devHeadcount: headcount.estimate,
      confidence,
      repoBase,
    };

    const vendors = VENDORS.map((vendor) =>
      scoreVendor(vendor, payload, context)
    );
    const score = overallScore(vendors);

    const estimable = vendors.filter(
      (vendor) => vendor.monthly && vendor.monthly.mid > 0
    );
    const unpriced = vendors.filter(
      (vendor) => vendor.adoptionScore > 0 && !vendor.monthly
    );
    const totalMonthly =
      estimable.length > 0
        ? {
            low: estimable.reduce((sum, vendor) => sum + vendor.monthly.low, 0),
            mid: estimable.reduce((sum, vendor) => sum + vendor.monthly.mid, 0),
            high: estimable.reduce(
              (sum, vendor) => sum + vendor.monthly.high,
              0
            ),
            complete: unpriced.length === 0,
          }
        : null;

    const caveats = [
      "Modeled estimate — not invoices. Public signals set adoption tier; dollars scale with org size and enterprise ACV.",
      "Private repos are invisible. Treat public markers as proof of rollout, not a seat count.",
      "Large-co Cursor/Claude contracts often run seven figures annually; SMB list prices are a floor, not the check size.",
    ];
    if (headcount.basis !== "manual" && headcount.estimate) {
      caveats.push(`Headcount is inferred: ${headcount.description}`);
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
    const active = report.vendors
      .filter((vendor) => vendor.adoptionScore > 0)
      .slice()
      .sort((left, right) => {
        const leftSpend = left.monthly?.mid || 0;
        const rightSpend = right.monthly?.mid || 0;
        return rightSpend - leftSpend || right.adoptionScore - left.adoptionScore;
      });
    const priced = active.filter((vendor) => (vendor.monthly?.mid || 0) > 0);
    const primary = active[0] || null;
    const total = report.totalMonthly;
    const annual = report.totalAnnual;
    const mix = priced.map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      pct: total?.mid
        ? Math.round((vendor.monthly.mid / total.mid) * 100)
        : 0,
      monthly: vendor.monthly,
      annual: vendor.annual,
    }));
    let headline;
    if (!primary) {
      headline = `${companyName} shows no public AI coding-tool footprint yet.`;
    } else if (annual?.mid) {
      headline = `${companyName} looks like a ${formatUsd(annual.mid)}/yr AI coding stack (${formatUsd(total.mid)}/mo), ${primary.name}-led.`;
    } else {
      headline = `${companyName} is adopting ${primary.name}, but headcount is needed to price spend.`;
    }
    const drivers = [];
    for (const vendor of active.slice(0, 3)) {
      const topSignal = (vendor.evidence || []).find((item) => item.value > 0);
      if (topSignal) {
        drivers.push(
          `${vendor.name} (${vendor.adoptionTierLabel || "signal"}): ${String(topSignal.metric || "").toLowerCase()} (${Number(topSignal.value).toLocaleString("en-US")})`
        );
      }
    }
    const thesis = primary
      ? [
          `${primary.name} is the strongest public signal (${primary.adoptionScore}/100 → ${primary.adoptionTierLabel}).`,
          mix[0] && mix[0].pct >= 40
            ? `It accounts for about ${mix[0].pct}% of modeled spend.`
            : null,
          report.headcount.estimate
            ? `Sized against ~${report.headcount.estimate.toLocaleString("en-US")} engineers (${report.headcount.basis.replace(/-/g, " ")}).`
            : "No engineer count yet — override headcount to lock a dollar range.",
          primary.annual?.mid
            ? `${primary.name} alone models around ${formatUsd(primary.annual.mid)}/yr.`
            : null,
          "Public GitHub is the tip of the iceberg; private-repo + API spend is assumed once a tool is an org standard.",
        ]
          .filter(Boolean)
          .join(" ")
      : "Run a refresh after wiring GitHub access, or try a company with a public engineering GitHub org.";
    return {
      headline,
      thesis,
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
  };
});
