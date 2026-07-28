(function startSpendscope() {
  "use strict";

  const config = globalThis.SpendscopeConfig || {};
  const scoring = globalThis.SpendscopeScoring;
  const endpoint = String(config.apiEndpoint || "").trim();

  const POLL_INTERVAL_MS = 6000;
  const MAX_POLLS = 20;
  const LOCAL_CACHE_TTL_MS = 10 * 60 * 1000;
  const SCHEMA_VERSION = 1;

  const form = document.getElementById("lookup-form");
  const domainInput = document.getElementById("domain-input");
  const submitButton = form ? form.querySelector(".search-button") : null;
  const statusBanner = document.getElementById("status-banner");
  const reportBody = document.getElementById("report-body");
  const emptyState = document.getElementById("empty-state");

  const state = {
    domain: null,
    snapshot: null,
    meta: null,
    headcountOverride: null,
    pollTimer: null,
    pollsLeft: 0,
    requestSeq: 0,
  };

  /* ---------- Utilities ---------- */

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined) continue;
      if (key === "text") {
        node.textContent = String(value);
      } else if (key === "class") {
        node.className = String(value);
      } else {
        node.setAttribute(key, String(value));
      }
    }
    for (const child of children || []) {
      if (child) node.appendChild(child);
    }
    return node;
  }

  function svgEl(tag, attrs, children) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      node.setAttribute(key, String(value));
    }
    for (const child of children || []) {
      if (child) node.appendChild(child);
    }
    return node;
  }

  function normalizeDomainInput(value) {
    let raw = String(value || "").trim().toLowerCase();
    if (!raw) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) {
      try {
        raw = new URL(raw).hostname;
      } catch (_error) {
        return null;
      }
    }
    raw = raw.split("/")[0].split("?")[0].split("#")[0].replace(/^www\./, "");
    if (
      raw.length > 253 ||
      !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)
    ) {
      return null;
    }
    return raw;
  }

  function formatUsd(value) {
    if (!Number.isFinite(value)) return "—";
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
    }
    if (value >= 10_000) return `$${Math.round(value / 1000)}k`;
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
    return `$${Math.round(value)}`;
  }

  function formatNumber(value) {
    return Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
  }

  function relativeTime(isoText) {
    const time = Date.parse(isoText || "");
    if (!Number.isFinite(time)) return null;
    const seconds = Math.max(0, (Date.now() - time) / 1000);
    if (seconds < 90) return "just now";
    if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
    if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
    return `${Math.round(seconds / 86400)}d ago`;
  }

  function safeHttpsUrl(value) {
    return typeof value === "string" && value.startsWith("https://")
      ? value
      : null;
  }

  /* ---------- Local cache ---------- */

  function cacheKey(domain) {
    return `aispend:lookup:v1:${domain}`;
  }

  function readLocalCache(domain) {
    try {
      const raw = localStorage.getItem(cacheKey(domain));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        Date.now() - Number(parsed.storedAt) > LOCAL_CACHE_TTL_MS ||
        !parsed.snapshot
      ) {
        return null;
      }
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function writeLocalCache(domain, snapshot, meta) {
    try {
      localStorage.setItem(
        cacheKey(domain),
        JSON.stringify({ snapshot, meta, storedAt: Date.now() })
      );
    } catch (_error) {
      // Storage may be unavailable; caching is best-effort.
    }
  }

  /* ---------- Status banner ---------- */

  function clearStatus() {
    statusBanner.hidden = true;
    statusBanner.replaceChildren();
  }

  function setStatus(kind, message, options) {
    statusBanner.hidden = false;
    statusBanner.dataset.kind = kind;
    statusBanner.replaceChildren();
    if (options && options.spinner) {
      statusBanner.appendChild(el("span", { class: "spinner", "aria-hidden": "true" }));
    }
    statusBanner.appendChild(el("span", { text: message }));
    if (options && options.action) {
      const button = el("button", {
        class: "text-button",
        type: "button",
        text: options.action.label,
      });
      button.addEventListener("click", options.action.onClick);
      statusBanner.appendChild(el("span", { class: "status-actions" }, [button]));
    }
  }

  /* ---------- API ---------- */

  async function apiLookup(domain, refresh) {
    if (!endpoint) {
      const error = new Error(
        "The Spendscope backend endpoint is not configured for this deployment."
      );
      error.code = "NOT_CONFIGURED";
      throw error;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        domain,
        refresh: refresh === true,
      }),
    });
    let body = null;
    try {
      body = await response.json();
    } catch (_error) {
      body = null;
    }
    if (!response.ok) {
      const error = new Error(
        (body && body.error) || `Lookup failed with status ${response.status}.`
      );
      error.code = (body && body.code) || `HTTP_${response.status}`;
      throw error;
    }
    return body;
  }

  /* ---------- Rendering ---------- */

  function scoreDial(score) {
    const radius = 66;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
    const svg = svgEl("svg", { viewBox: "0 0 150 150", role: "img", "aria-label": `AI adoption score ${score} out of 100` }, [
      svgEl("circle", { class: "dial-track", cx: 75, cy: 75, r: radius }),
      svgEl("circle", {
        class: "dial-value",
        cx: 75,
        cy: 75,
        r: radius,
        "stroke-dasharray": circumference.toFixed(2),
        "stroke-dashoffset": offset.toFixed(2),
      }),
    ]);
    return el("div", { class: "score-dial" }, [
      svg,
      el("div", { class: "dial-number" }, [
        el("strong", { text: String(score) }),
        el("span", { text: "ACES score" }),
      ]),
    ]);
  }

  function coverageChips(coverage) {
    const chips = [
      ["GitHub org", coverage.githubOrgResolved ? "true" : "false"],
      ["Code search", coverage.codeSearch ? "true" : "false"],
      ["Commit trails", coverage.commitSearch ? "true" : "false"],
      ["Agent PRs", coverage.prSearch ? "true" : "false"],
      [
        "Web research",
        coverage.webResearch === "ok"
          ? "true"
          : coverage.webResearch === "disabled"
            ? "false"
            : "warn",
      ],
    ];
    return el(
      "div",
      { class: "chip-row" },
      chips.map(([label, on]) => el("span", { class: "chip", "data-on": on, text: label }))
    );
  }

  function moneyBlock(title, monthly, subtitle) {
    const children = [el("h3", { text: title })];
    if (monthly && monthly.mid > 0) {
      children.push(el("p", { class: "big-money", text: `${formatUsd(monthly.mid)}/mo` }));
      children.push(
        el("p", {
          class: "money-range",
          text: `${formatUsd(monthly.low)} – ${formatUsd(monthly.high)} · ${formatUsd(monthly.mid * 12)}/yr mid`,
        })
      );
    } else {
      children.push(el("p", { class: "big-money", text: "$0/mo" }));
      children.push(el("p", { class: "money-range", text: "No spend-relevant public signals yet" }));
    }
    if (subtitle) children.push(el("p", { class: "subtle", text: subtitle }));
    return children;
  }

  function vendorCard(vendor) {
    const zero = vendor.adoptionScore === 0;
    const card = el("article", { class: "panel vendor-card" });
    card.appendChild(
      el("div", { class: "vendor-head" }, [
        el("div", { class: "vendor-name" }, [
          el("strong", { text: vendor.name }),
          el("span", { text: vendor.company }),
        ]),
        el("span", {
          class: "vendor-score",
          "data-zero": zero ? "true" : "false",
          text: zero ? "—" : String(vendor.adoptionScore),
        }),
      ])
    );
    const fill = el("span");
    fill.style.width = `${vendor.adoptionScore}%`;
    card.appendChild(el("div", { class: "adoption-bar", "aria-hidden": "true" }, [fill]));

    if (vendor.monthly) {
      const mid = vendor.monthly.mid;
      card.appendChild(
        el("div", { class: "vendor-money" }, [
          el("span", { class: "mid", text: mid > 0 ? `${formatUsd(mid)}/mo` : "$0/mo" }),
          el("span", {
            class: "range",
            text:
              mid > 0
                ? `${formatUsd(vendor.monthly.low)} – ${formatUsd(vendor.monthly.high)}`
                : "no priced signals",
          }),
        ])
      );
    }
    const sizing =
      vendor.seatModel === "per-agent"
        ? vendor.agents !== null
          ? `${formatNumber(vendor.agents)} est. agents · ${vendor.pricingBasis}`
          : vendor.pricingBasis
        : vendor.seats !== null
          ? `${formatNumber(vendor.seats)} est. seats · ${vendor.pricingBasis}`
          : vendor.pricingBasis;
    card.appendChild(el("p", { class: "vendor-meta", text: sizing }));
    for (const note of vendor.notes || []) {
      card.appendChild(el("p", { class: "vendor-note", text: note }));
    }

    const withValues = (vendor.evidence || []).filter((item) => item.value > 0);
    const zeros = (vendor.evidence || []).filter((item) => !(item.value > 0));
    if (vendor.evidence && vendor.evidence.length > 0) {
      const list = el(
        "ul",
        {},
        [...withValues, ...zeros].slice(0, 8).map((item) => {
          const url = safeHttpsUrl(item.url);
          const label = item.metric || item.detail || item.id;
          const labelNode = url
            ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: label })
            : el("span", { text: label });
          return el("li", { "data-zero": item.value > 0 ? "false" : "true" }, [
            labelNode,
            el("span", { class: "evidence-value", text: formatNumber(item.value) }),
          ]);
        })
      );
      card.appendChild(
        el("details", { class: "evidence" }, [
          el("summary", { text: `Evidence (${withValues.length} active signals)` }),
          list,
        ])
      );
    }
    return card;
  }

  function render() {
    if (!state.snapshot || !scoring) return;
    const report = scoring.scoreCompany(state.snapshot, {
      headcountOverride: state.headcountOverride,
    });

    emptyState.hidden = true;
    reportBody.hidden = false;
    reportBody.replaceChildren();

    const orgs = (report.company && report.company.githubOrgs) || [];
    const orgText =
      orgs.length > 0
        ? `GitHub: ${orgs.map((org) => `@${org.login}`).join(", ")} · ${formatNumber(
            orgs.reduce((sum, org) => sum + (org.publicRepos || 0), 0)
          )} public repos`
        : "No public GitHub organization matched this domain.";

    const companyPanel = el("div", { class: "panel" }, [
      el("h2", { text: "Estimated AI coding spend" }),
      el("div", { class: "company-line" }, [
        el("strong", { text: (report.company && report.company.name) || report.domain }),
        el("span", { class: "domain", text: report.domain }),
      ]),
      ...moneyBlock(
        "",
        report.totalMonthly,
        report.totalMonthly && !report.totalMonthly.complete
          ? "Partial total — some vendors need a headcount to price."
          : null
      ).slice(1),
      el("p", { class: "subtle", text: orgText }),
    ]);

    const headcountInput = el("input", {
      id: "headcount-input",
      type: "number",
      min: "1",
      max: "500000",
      step: "1",
      value: state.headcountOverride || "",
      placeholder: report.headcount.estimate ? String(report.headcount.estimate) : "e.g. 120",
    });
    headcountInput.addEventListener("input", () => {
      const value = Number(headcountInput.value);
      state.headcountOverride = Number.isFinite(value) && value > 0 ? value : null;
      const active = document.activeElement === headcountInput;
      const cursorValue = headcountInput.value;
      render();
      if (active) {
        const nextInput = document.getElementById("headcount-input");
        if (nextInput) {
          nextInput.value = cursorValue;
          nextInput.focus();
        }
      }
    });

    const profilePanel = el("div", { class: "panel" }, [
      el("h2", { text: "Model inputs" }),
      el("p", {
        class: "big-money",
        text: report.headcount.estimate ? `${formatNumber(report.headcount.estimate)} devs` : "? devs",
      }),
      el("p", { class: "subtle", text: report.headcount.description }),
      el("div", { class: "headcount-row" }, [
        el("label", { for: "headcount-input", text: "Override headcount" }),
        headcountInput,
      ]),
      coverageChips(report.coverage || {}),
      el("p", {
        class: "subtle",
        text: `Model confidence ${(report.confidence * 100).toFixed(0)}%`,
      }),
    ]);

    reportBody.appendChild(
      el("div", { class: "summary-grid" }, [
        el("div", { class: "panel score-panel" }, [
          scoreDial(report.overall.score),
          el("span", { class: "score-tier", text: report.overall.tier }),
        ]),
        companyPanel,
        profilePanel,
      ])
    );

    reportBody.appendChild(
      el("div", { class: "vendor-grid" }, report.vendors.map(vendorCard))
    );

    reportBody.appendChild(
      el("div", { class: "caveats" }, [
        el("strong", { text: "Read this like an analyst:" }),
        el("ul", {}, report.caveats.map((caveat) => el("li", { text: caveat }))),
      ])
    );

    const refreshButton = el("button", {
      class: "refresh-button",
      type: "button",
      text: "Refresh readings",
    });
    refreshButton.addEventListener("click", () => lookup(state.domain, { refresh: true }));
    const collectedText = relativeTime(report.collectedAt);
    reportBody.appendChild(
      el("div", { class: "report-footer" }, [
        el("span", {
          text: `Readings collected ${collectedText || "recently"} · ${report.model.id} v${report.model.version}`,
        }),
        refreshButton,
      ])
    );
  }

  /* ---------- Lookup + polling ---------- */

  function stopPolling() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function schedulePoll(domain, seq) {
    stopPolling();
    if (state.pollsLeft <= 0) {
      setStatus(
        "warn",
        "Enrichment is taking longer than expected. Readings may still land shortly.",
        {
          action: {
            label: "Check again",
            onClick: () => lookup(domain, { quiet: false }),
          },
        }
      );
      return;
    }
    state.pollTimer = setTimeout(async () => {
      if (seq !== state.requestSeq) return;
      state.pollsLeft -= 1;
      try {
        const result = await apiLookup(domain, false);
        if (seq !== state.requestSeq) return;
        applyResult(domain, result, seq);
      } catch (_error) {
        schedulePoll(domain, seq);
      }
    }, POLL_INTERVAL_MS);
  }

  function applyResult(domain, result, seq) {
    if (!result || typeof result !== "object") {
      setStatus("error", "The lookup returned an unexpected response.");
      return;
    }
    state.meta = result.meta || null;
    if (result.snapshot) {
      state.snapshot = result.snapshot;
      writeLocalCache(domain, result.snapshot, result.meta);
      render();
    }

    switch (result.status) {
      case "current":
        clearStatus();
        break;
      case "queued":
        setStatus(
          "progress",
          `Collecting public signals for ${domain} — first scan takes about a minute.`,
          { spinner: true }
        );
        schedulePoll(domain, seq);
        break;
      case "refreshing":
        setStatus("progress", "Refreshing readings in the background…", { spinner: true });
        schedulePoll(domain, seq);
        break;
      case "blocked":
        setStatus(
          "warn",
          state.meta && state.meta.budgetExhausted
            ? "Today's enrichment budget is used up. Cached profiles still load; new scans resume tomorrow."
            : "Enrichment for this domain is temporarily blocked. Try again later."
        );
        break;
      case "none":
        setStatus(
          "warn",
          state.meta && state.meta.lastError
            ? `Enrichment has not succeeded yet (${state.meta.lastError}). Try again shortly.`
            : "No readings yet for this domain. Try scanning again.",
          {
            action: { label: "Retry", onClick: () => lookup(domain, {}) },
          }
        );
        break;
      default:
        clearStatus();
    }
  }

  async function lookup(domain, options) {
    if (!domain) return;
    const seq = ++state.requestSeq;
    state.domain = domain;
    state.pollsLeft = MAX_POLLS;
    stopPolling();

    const cached = readLocalCache(domain);
    if (cached && !options.refresh) {
      state.snapshot = cached.snapshot;
      state.meta = cached.meta || null;
      render();
    }

    if (submitButton) submitButton.disabled = true;
    if (!cached || options.refresh) {
      setStatus("progress", options.refresh ? "Requesting a refresh…" : `Looking up ${domain}…`, {
        spinner: true,
      });
    }
    try {
      const result = await apiLookup(domain, options.refresh === true);
      if (seq !== state.requestSeq) return;
      applyResult(domain, result, seq);
    } catch (error) {
      if (seq !== state.requestSeq) return;
      if (error.code === "NOT_CONFIGURED" || error.code === "ENRICHMENT_NOT_CONFIGURED") {
        setStatus(
          "warn",
          "The enrichment backend is not deployed yet, so live scans are unavailable."
        );
      } else if (error.code === "INVALID_DOMAIN") {
        setStatus("error", "That doesn't look like a valid company domain.");
      } else {
        setStatus("error", `Lookup failed: ${error.message}`);
      }
    } finally {
      if (seq === state.requestSeq && submitButton) submitButton.disabled = false;
    }
  }

  /* ---------- Wire up ---------- */

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const domain = normalizeDomainInput(domainInput.value);
      if (!domain) {
        setStatus("error", "Enter a valid company domain, like acme.com.");
        return;
      }
      domainInput.value = domain;
      state.headcountOverride = null;
      const url = new URL(window.location.href);
      url.searchParams.set("domain", domain);
      window.history.replaceState(null, "", url.toString());
      lookup(domain, {});
    });
  }

  const initialDomain = normalizeDomainInput(
    new URLSearchParams(window.location.search).get("domain")
  );
  if (initialDomain && domainInput) {
    domainInput.value = initialDomain;
    lookup(initialDomain, {});
  }
})();
