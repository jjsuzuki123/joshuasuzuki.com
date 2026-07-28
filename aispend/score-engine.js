(function initSpendscopeScoring(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.SpendscopeScoring = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSpendscopeScoring() {
  "use strict";

  /**
   * Spendscope ACES v1 — AI Coding Expenditure Signal
   *
   * A deterministic, inspectable estimate of how much a company spends on
   * AI coding tools (Claude Code, Cursor, OpenAI Codex, GitHub Copilot,
   * Devin), modeled from public enrichment readings:
   *
   *   1. Repository markers (CLAUDE.md, .cursorrules, AGENTS.md, …) show a
   *      tool is part of the engineering workflow.
   *   2. Attribution trails (Co-authored-by trailers, agent-bot pull
   *      requests) show sustained usage volume.
   *   3. Public web mentions (jobs, engineering blogs, press) corroborate
   *      adoption outside of GitHub.
   *
   * Per vendor, each signal contributes a bounded component
   *
   *   c_i = w_i · v / (v + k_i)          (saturating count curve)
   *
   * and components combine with a noisy-OR so corroborating evidence
   * compounds without any single count dominating:
   *
   *   adoption = 100 · (1 − Π(1 − c_i))
   *
   * Spend is then seats × blended list price:
   *
   *   seats  = devs · maxPenetration · adoption / 100
   *   mid    = seats · pricePerSeat            (Devin: agents × $500)
   *   range  = mid × [low(conf), high(conf)]   (uncertainty band)
   *
   * The output is a modeled estimate from public signals — never billing
   * data. Private-repo activity is invisible and usually larger.
   */

  const MODEL = Object.freeze({
    id: "ACES",
    version: "1.0.0",
    name: "AI Coding Expenditure Signal",
  });

  // Public membership is opt-in on GitHub; roughly a third of engineers
  // show up, hence the ×3 expansion. Repo count is a weaker fallback.
  const HEADCOUNT = Object.freeze({
    membersMultiplier: 3,
    reposMultiplier: 1.2,
    minimum: 5,
    maximum: 25000,
  });

  // Uncertainty band multipliers as a function of confidence in [0, 1].
  const BAND = Object.freeze({
    lowBase: 0.35,
    lowGain: 0.3,
    highBase: 2.6,
    highGain: 1.4,
  });

  const VENDORS = [
    {
      id: "claude-code",
      name: "Claude Code",
      company: "Anthropic",
      pricePerSeat: 130,
      pricingBasis:
        "Blend of Claude Max 5x ($100), Team premium seats ($150), and API overage",
      seatModel: "per-developer",
      maxPenetration: 0.7,
      overallWeight: 0.95,
      signals: [
        { key: "claudeMdFiles", weight: 0.9, halfMax: 5, repoMarker: true },
        { key: "claudeSettings", weight: 0.5, halfMax: 4, repoMarker: true },
        { key: "claudeCoauthoredCommits", weight: 0.85, halfMax: 150 },
        { key: "claudeAppPrs", weight: 0.55, halfMax: 30 },
        { key: "webMentions", weight: 0.45, halfMax: 2 },
      ],
    },
    {
      id: "cursor",
      name: "Cursor",
      company: "Anysphere",
      pricePerSeat: 30,
      pricingBasis: "Blend of Cursor Pro ($20) and Business ($40) seats",
      seatModel: "per-developer",
      maxPenetration: 0.8,
      overallWeight: 0.85,
      signals: [
        { key: "cursorRulesFiles", weight: 0.8, halfMax: 5, repoMarker: true },
        { key: "cursorRulesDir", weight: 0.8, halfMax: 8, repoMarker: true },
        { key: "cursorCoauthoredCommits", weight: 0.8, halfMax: 100 },
        { key: "cursorAgentPrs", weight: 0.6, halfMax: 25 },
        { key: "webMentions", weight: 0.45, halfMax: 2 },
      ],
    },
    {
      id: "openai",
      name: "OpenAI Codex",
      company: "OpenAI",
      pricePerSeat: 42,
      pricingBasis: "ChatGPT Business seats ($25–30) plus Codex/API usage",
      seatModel: "per-developer",
      maxPenetration: 0.6,
      overallWeight: 0.7,
      signals: [
        // AGENTS.md is becoming a cross-tool convention, so attribution
        // to OpenAI specifically is weaker than a CLAUDE.md-style marker.
        { key: "agentsMdFiles", weight: 0.6, halfMax: 6, repoMarker: true },
        { key: "codexConnectorPrs", weight: 0.65, halfMax: 25 },
        { key: "webMentions", weight: 0.45, halfMax: 2 },
      ],
    },
    {
      id: "github-copilot",
      name: "GitHub Copilot",
      company: "GitHub",
      pricePerSeat: 24,
      pricingBasis: "Blend of Copilot Business ($19) and Enterprise ($39) seats",
      seatModel: "per-developer",
      maxPenetration: 0.85,
      overallWeight: 0.6,
      signals: [
        { key: "copilotInstructions", weight: 0.75, halfMax: 5, repoMarker: true },
        { key: "copilotAgentPrs", weight: 0.6, halfMax: 25 },
        { key: "webMentions", weight: 0.4, halfMax: 2 },
      ],
    },
    {
      id: "devin",
      name: "Devin",
      company: "Cognition",
      pricePerAgent: 500,
      pricingBasis: "Devin Team plan, $500/month per concurrent agent",
      seatModel: "per-agent",
      // One agent per ~50 lifetime public PRs, capped — a coarse proxy.
      prsPerAgent: 50,
      maxAgents: 40,
      overallWeight: 0.5,
      signals: [
        { key: "devinPrs", weight: 0.9, halfMax: 40 },
        { key: "webMentions", weight: 0.5, halfMax: 2 },
      ],
    },
  ];

  const TIERS = [
    { minimum: 70, label: "Heavy adopter" },
    { minimum: 40, label: "Active adopter" },
    { minimum: 15, label: "Early signals" },
    { minimum: 1, label: "Trace signals" },
    { minimum: 0, label: "No public signals" },
  ];

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
    return Math.round(value / 5000) * 5000;
  }

  function readingSignalKey(reading) {
    const id = String(reading?.id || "");
    if (id.startsWith("web.mention.")) return "webMentions";
    const parts = id.split(".");
    return parts.length >= 3 && parts[0] === "github" ? parts.at(-1) : null;
  }

  // Sums reading values per signal key for one vendor across all orgs.
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
      (sum, org) => sum + (Math.max(0, Number(org?.publicRepos) || 0)),
      0
    );
  }

  function totalPublicMembers(payload) {
    return (payload?.company?.githubOrgs || []).reduce(
      (sum, org) => sum + (Math.max(0, Number(org?.publicMembers) || 0)),
      0
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
    const members = totalPublicMembers(payload);
    if (members > 0) {
      return {
        estimate: Math.round(
          clamp(
            members * HEADCOUNT.membersMultiplier,
            HEADCOUNT.minimum,
            HEADCOUNT.maximum
          )
        ),
        basis: "github-members",
        description: `${members} public GitHub org members × ${HEADCOUNT.membersMultiplier} (public membership is opt-in).`,
      };
    }
    const repos = totalPublicRepos(payload);
    if (repos > 0) {
      return {
        estimate: Math.round(
          clamp(
            repos * HEADCOUNT.reposMultiplier,
            HEADCOUNT.minimum,
            HEADCOUNT.maximum
          )
        ),
        basis: "github-repos",
        description: `${repos} public repositories × ${HEADCOUNT.reposMultiplier} (weak proxy).`,
      };
    }
    return {
      estimate: null,
      basis: "unknown",
      description:
        "No public GitHub organization was resolved; enter a developer headcount to model spend.",
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
    if (!coverage.githubOrgResolved) confidence = Math.min(confidence, 0.4);
    const collected = Date.parse(payload?.collectedAt || "");
    if (Number.isFinite(collected)) {
      const ageDays = Math.max(0, (now.getTime() - collected) / 86400000);
      // Full weight for a month, decaying to 0.7× by six months.
      const recency =
        ageDays <= 30 ? 1 : Math.max(0.7, 1 - ((ageDays - 30) / 150) * 0.3);
      confidence *= recency;
    }
    return clamp(confidence, 0.05, 0.9);
  }

  function vendorAdoption(vendor, totals, repoBase) {
    const components = [];
    let survivor = 1;
    for (const signal of vendor.signals) {
      const value = totals.get(signal.key) || 0;
      let fraction = saturate(value, signal.halfMax);
      if (signal.repoMarker && value > 0 && repoBase > 0) {
        // Small orgs earn full credit when markers cover most active repos.
        const coverage = value / repoBase;
        fraction = Math.max(fraction, saturate(coverage, 0.15));
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

  function scoreVendor(vendor, payload, context) {
    const totals = aggregateSignals(payload?.readings, vendor.id);
    const { adoptionScore, components } = vendorAdoption(
      vendor,
      totals,
      context.repoBase
    );
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
      confidence: context.confidence,
      signals: components,
      evidence,
      seats: null,
      agents: null,
      monthly: null,
      notes: [],
    };

    if (adoptionScore === 0) {
      result.monthly = { low: 0, mid: 0, high: 0 };
      return result;
    }

    if (vendor.seatModel === "per-agent") {
      const prs = totals.get("devinPrs") || 0;
      const agents =
        prs > 0
          ? Math.round(
              clamp(Math.ceil(prs / vendor.prsPerAgent), 1, vendor.maxAgents)
            )
          : 0;
      result.agents = agents;
      if (agents === 0) {
        result.monthly = { low: 0, mid: 0, high: 0 };
        result.notes.push(
          "Web mentions only — no public Devin pull requests to size agent count."
        );
        return result;
      }
      result.monthly = spendBand(agents * vendor.pricePerAgent, context.confidence);
      return result;
    }

    if (!context.devHeadcount) {
      result.notes.push(
        "Adoption signals found, but no developer headcount — enter one to model spend."
      );
      return result;
    }
    const seats = Math.round(
      context.devHeadcount * vendor.maxPenetration * (adoptionScore / 100)
    );
    result.seats = seats;
    result.monthly = spendBand(seats * vendor.pricePerSeat, context.confidence);
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
    for (const tier of TIERS) {
      if (score >= tier.minimum) return tier.label;
    }
    return TIERS.at(-1).label;
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
      "Modeled estimate from public signals — not billing or contract data.",
      "Public GitHub only: private-repo usage is invisible and usually larger.",
      "Prices are blended list prices; negotiated contracts differ.",
    ];
    if (headcount.basis !== "manual" && headcount.estimate) {
      caveats.push(`Headcount is inferred: ${headcount.description}`);
    }

    return {
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
  }

  return {
    MODEL,
    VENDORS,
    aggregateSignals,
    estimateHeadcount,
    roundSpend,
    saturate,
    scoreCompany,
    snapshotConfidence,
  };
});
