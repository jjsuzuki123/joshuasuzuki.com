(function startSpendscope() {
  "use strict";

  const config = globalThis.SpendscopeConfig || {};
  const scoring = globalThis.SpendscopeScoring;
  const endpoint = String(config.apiEndpoint || "").trim();
  const suggestEndpoint =
    String(config.suggestEndpoint || "").trim() ||
    endpoint.replace(/\/company\/?$/, "/suggest");

  const POLL_INTERVAL_MS = 5500;
  const MAX_POLLS = 22;
  const LOCAL_CACHE_TTL_MS = 10 * 60 * 1000;
  const SCHEMA_VERSION = 1;
  const ACCESS_KEY = "aispend:access";
  const RECENTS_KEY = "aispend:recents";
  const VENDOR_COLORS = {
    "claude-code": "#e8b86d",
    cursor: "#34d399",
    openai: "#7dd3fc",
    "github-copilot": "#a78bfa",
    devin: "#f472b6",
  };

  const root = document.getElementById("app");
  const state = {
    view: "home",
    query: "",
    accessCode: readAccessCode(),
    gateError: "",
    suggestions: [],
    suggestOpen: false,
    activeSuggest: -1,
    recents: readRecents(),
    domain: null,
    companyName: null,
    snapshot: null,
    meta: null,
    report: null,
    headcountOverride: null,
    status: null,
    pollTimer: null,
    pollsLeft: 0,
    requestSeq: 0,
    scanStep: 0,
    scanLabel: "",
  };

  /* ---------- DOM helpers ---------- */

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "text") node.textContent = String(value);
      else if (key === "class") node.className = String(value);
      else if (key === "html") node.innerHTML = String(value);
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) node.setAttribute(key, "");
      else node.setAttribute(key, String(value));
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

  function formatUsd(value) {
    if (scoring && typeof scoring.formatUsd === "function") {
      return scoring.formatUsd(value);
    }
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

  function looksLikeDomain(value) {
    const raw = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
      raw
    );
  }

  /* ---------- persistence ---------- */

  function readAccessCode() {
    try {
      return sessionStorage.getItem(ACCESS_KEY) || "";
    } catch (_error) {
      return "";
    }
  }

  function writeAccessCode(value) {
    try {
      if (value) sessionStorage.setItem(ACCESS_KEY, value);
      else sessionStorage.removeItem(ACCESS_KEY);
    } catch (_error) {
      // sessionStorage may be unavailable.
    }
  }

  function readRecents() {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
    } catch (_error) {
      return [];
    }
  }

  function writeRecents(list) {
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 8)));
    } catch (_error) {
      // best-effort
    }
  }

  function rememberRecent(entry, report) {
    const next = [
      {
        name: entry.name || entry.domain,
        domain: entry.domain,
        mid: report?.totalMonthly?.mid || null,
        annualMid: report?.totalAnnual?.mid || null,
        score: report?.overall?.score ?? null,
        at: Date.now(),
      },
      ...state.recents.filter((item) => item.domain !== entry.domain),
    ].slice(0, 8);
    state.recents = next;
    writeRecents(next);
  }

  function cacheKey(domain) {
    return `aispend:lookup:v2:${domain}`;
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
      // best-effort
    }
  }

  /* ---------- API ---------- */

  function authHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (state.accessCode) headers["X-Spendscope-Key"] = state.accessCode;
    return headers;
  }

  async function api(url, body) {
    if (!url) {
      const error = new Error(
        "The Spendscope backend endpoint is not configured for this deployment."
      );
      error.code = "NOT_CONFIGURED";
      throw error;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    let parsed = null;
    try {
      parsed = await response.json();
    } catch (_error) {
      parsed = null;
    }
    if (response.status === 401 || (parsed && parsed.code === "ACCESS_REQUIRED")) {
      const error = new Error("A valid access code is required.");
      error.code = "ACCESS_REQUIRED";
      throw error;
    }
    if (!response.ok) {
      const error = new Error(
        (parsed && parsed.error) || `Request failed with status ${response.status}.`
      );
      error.code = (parsed && parsed.code) || `HTTP_${response.status}`;
      throw error;
    }
    return parsed;
  }

  async function apiLookup(query, options) {
    return api(endpoint, {
      schemaVersion: SCHEMA_VERSION,
      query,
      companyName: options.companyName || undefined,
      refresh: options.refresh === true,
    });
  }

  async function apiSuggest(query) {
    if (!suggestEndpoint) return { suggestions: [] };
    return api(suggestEndpoint, { query });
  }

  /* ---------- routing ---------- */

  function syncUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("domain");
    url.searchParams.delete("q");
    url.searchParams.delete("company");
    if (state.view === "method") {
      url.searchParams.set("view", "method");
    } else {
      url.searchParams.delete("view");
      if (state.domain) url.searchParams.set("q", state.domain);
      else if (state.query) url.searchParams.set("q", state.query);
    }
    window.history.replaceState(null, "", url.toString());
  }

  function needsGate() {
    return config.gated === true && !state.accessCode;
  }

  /* ---------- render shell ---------- */

  function brandMark() {
    return svgEl(
      "svg",
      { class: "brand-mark", viewBox: "0 0 24 24", "aria-hidden": "true" },
      [
        svgEl("path", { d: "M4 16V8l8-4 8 4v8l-8 4-8-4z" }),
        svgEl("path", { d: "M12 8v8M8 10.5l8 3M16 10.5l-8 3" }),
      ]
    );
  }

  function renderTopbar() {
    return el("header", { class: "topbar" }, [
      el(
        "a",
        {
          class: "brand",
          href: "#",
          onClick: (event) => {
            event.preventDefault();
            state.view = needsGate() ? "gate" : "home";
            state.status = null;
            stopPolling();
            syncUrl();
            render();
          },
        },
        [
          brandMark(),
          el("span", {}, [
            el("span", { text: "Spendscope" }),
            el("small", { text: "Unlisted · AI spend intelligence" }),
          ]),
        ]
      ),
      el("nav", {}, [
        el("span", { class: "unlisted", text: "noindex" }),
        el("button", {
          class: "ghost",
          type: "button",
          text: "Method",
          onClick: () => {
            state.view = "method";
            syncUrl();
            render();
          },
        }),
        state.accessCode
          ? el("button", {
              class: "ghost",
              type: "button",
              text: "Lock",
              onClick: () => {
                state.accessCode = "";
                writeAccessCode("");
                state.view = config.gated === true ? "gate" : "home";
                stopPolling();
                render();
              },
            })
          : null,
      ]),
    ]);
  }

  function statusNode() {
    if (!state.status) return null;
    const node = el("div", { class: `status ${state.status.kind || ""}` }, [
      state.status.spinner
        ? el("span", { class: "spinner", "aria-hidden": "true" })
        : null,
      el("span", { text: state.status.message }),
    ]);
    if (state.status.action) {
      node.appendChild(
        el("button", {
          class: "ghost",
          type: "button",
          text: state.status.action.label,
          onClick: state.status.action.onClick,
        })
      );
    }
    return node;
  }

  /* ---------- views ---------- */

  function renderGate() {
    return el("section", { class: "gate" }, [
      el("p", { class: "kicker", text: "Unlisted" }),
      el("h1", {}, [
        document.createTextNode("Spendscope "),
        el("em", { text: "access" }),
      ]),
      el("p", {
        class: "lede",
        text: "This product is not linked from the public site. Enter the shared access code to run company AI-spend reads.",
      }),
      el(
        "form",
        {
          class: "panel search-wrap",
          onSubmit: async (event) => {
            event.preventDefault();
            const input = event.target.querySelector("input");
            const code = String(input.value || "").trim();
            if (!code) {
              state.gateError = "Enter the access code.";
              render();
              return;
            }
            state.accessCode = code;
            writeAccessCode(code);
            state.gateError = "";
            try {
              await apiSuggest("stripe");
              state.view = "home";
              render();
            } catch (error) {
              if (error.code === "ACCESS_REQUIRED") {
                state.accessCode = "";
                writeAccessCode("");
                state.gateError = "That code was not accepted.";
              } else if (error.code === "NOT_CONFIGURED") {
                state.view = "home";
              } else {
                state.view = "home";
              }
              render();
            }
          },
        },
        [
          el("input", {
            type: "password",
            name: "access",
            autocomplete: "current-password",
            placeholder: "Access code",
            "aria-label": "Access code",
          }),
          el("button", { class: "primary", type: "submit", text: "Unlock" }),
          state.gateError
            ? el("p", { class: "hint", text: state.gateError })
            : el("p", {
                class: "hint",
                text: "Ask Josh for the code. Nothing here is indexed.",
              }),
        ]
      ),
    ]);
  }

  function renderHome() {
    return el("section", { class: "home" }, [
      el("p", { class: "kicker", text: "AI coding spend" }),
      el("h1", {}, [
        document.createTextNode("How much does "),
        el("em", { text: "this company" }),
        document.createTextNode(" spend on Claude, Cursor, and the rest?"),
      ]),
      el("p", {
        class: "lede",
        text: "Type a company name. Spendscope resolves the domain, enriches public GitHub and web signals if needed, and returns a modeled Intricately-style read — stored so the next lookup is instant.",
      }),
      statusNode(),
      el("div", { class: "panel search-wrap" }, [
        el(
          "form",
          {
            class: "search-row",
            autocomplete: "off",
            onSubmit: (event) => {
              event.preventDefault();
              const value = String(
                event.target.querySelector("input").value || ""
              ).trim();
              startLookup(value);
            },
          },
          [
            el("input", {
              id: "company-input",
              type: "search",
              name: "company",
              placeholder: "Stripe, Vercel, Notion… or stripe.com",
              value: state.query,
              "aria-autocomplete": "list",
              "aria-controls": "suggest-list",
              onInput: (event) => onQueryInput(event.target.value),
              onKeydown: onQueryKeydown,
            }),
            el("button", { class: "primary", type: "submit", text: "Scan" }),
          ]
        ),
        state.suggestOpen && state.suggestions.length
          ? el(
              "ul",
              { class: "suggest", id: "suggest-list", role: "listbox" },
              state.suggestions.map((item, index) =>
                el("li", { role: "presentation" }, [
                  el(
                    "button",
                    {
                      type: "button",
                      role: "option",
                      "aria-selected": index === state.activeSuggest,
                      onClick: () => startLookup(item.domain, item),
                    },
                    [
                      el("span", { text: item.name }),
                      el("span", { class: "dom", text: item.domain }),
                    ]
                  ),
                ])
              )
            )
          : null,
        el("p", {
          class: "hint",
          text: "Public signals only. Private-repo usage is invisible and usually larger.",
        }),
        el("div", { class: "examples" }, [
          ...["Stripe", "Vercel", "Linear", "Datadog", "Notion"].map((name) =>
            el("button", {
              class: "chip-btn",
              type: "button",
              text: name,
              onClick: () => startLookup(name),
            })
          ),
        ]),
      ]),
      state.recents.length
        ? el("div", { class: "recents" }, [
            el("h2", { text: "Recent reads" }),
            el(
              "div",
              { class: "recent-list" },
              state.recents.map((item) =>
                el(
                  "button",
                  {
                    type: "button",
                    onClick: () => startLookup(item.domain, item),
                  },
                  [
                    el("span", { text: item.name || item.domain }),
                    el("span", {
                      class: "meta",
                      text: item.annualMid
                        ? `${formatUsd(item.annualMid)}/yr · ${item.domain}`
                        : item.mid
                          ? `${formatUsd(item.mid)}/mo · ${item.domain}`
                          : item.domain,
                    }),
                  ]
                )
              )
            ),
          ])
        : null,
    ]);
  }

  function renderScan() {
    const steps = [
      "Resolve company + domain",
      "Match public GitHub org",
      "Mine repo markers & agent trails",
      "Search jobs + engineering web",
      "Score ACES + write the brief",
    ];
    return el("section", { class: "scan" }, [
      el("p", { class: "kicker", text: state.companyName || state.domain || "Scanning" }),
      el("h1", {}, [
        document.createTextNode("Collecting public signals for "),
        el("em", { text: state.companyName || state.domain || "this company" }),
      ]),
      el("p", {
        class: "lede",
        text: state.scanLabel || "First scan takes about a minute. Repeat lookups hit the cache.",
      }),
      el(
        "ol",
        {},
        steps.map((label, index) =>
          el("li", {
            "data-state":
              index < state.scanStep ? "done" : index === state.scanStep ? "active" : "todo",
            text: label,
          })
        )
      ),
      statusNode(),
    ]);
  }

  function scoreDial(score) {
    const radius = 58;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
    return el("div", { class: "dial-wrap" }, [
      el("div", { class: "dial" }, [
        svgEl("svg", { viewBox: "0 0 140 140", "aria-hidden": "true" }, [
          svgEl("circle", { class: "track", cx: "70", cy: "70", r: String(radius) }),
          svgEl("circle", {
            class: "value",
            cx: "70",
            cy: "70",
            r: String(radius),
            "stroke-dasharray": circumference.toFixed(2),
            "stroke-dashoffset": offset.toFixed(2),
          }),
        ]),
        el("div", { class: "num" }, [
          el("strong", { text: String(score) }),
          el("span", { text: "ACES" }),
        ]),
      ]),
      el("div", { class: "tier", text: state.report.overall.tier }),
    ]);
  }

  function mixBar(report) {
    const mix = report.brief?.mix || [];
    if (!mix.length || !report.totalMonthly?.mid) return null;
    return el("div", {}, [
      el(
        "div",
        { class: "mix", "aria-hidden": "true" },
        mix.map((item) => {
          const span = el("span");
          span.style.width = `${Math.max(item.pct, 2)}%`;
          span.style.background = VENDOR_COLORS[item.id] || "#64748b";
          return span;
        })
      ),
      el(
        "div",
        { class: "mix-legend" },
        mix.map((item) =>
          el("span", {}, [
            el("i", {
              style: `background:${VENDOR_COLORS[item.id] || "#64748b"}`,
            }),
            document.createTextNode(
              `${item.name} ${item.pct}% · ${formatUsd(item.annual?.mid || item.monthly.mid * 12)}/yr`
            ),
          ])
        )
      ),
    ]);
  }

  function vendorCard(vendor) {
    const zero = vendor.adoptionScore === 0;
    const card = el("article", { class: "panel vendor" });
    card.appendChild(
      el("div", { class: "vendor-head" }, [
        el("div", {}, [
          el("strong", { text: vendor.name }),
          el("small", {
            text: vendor.adoptionTierLabel
              ? `${vendor.company} · ${vendor.adoptionTierLabel}`
              : vendor.company,
          }),
        ]),
        el("span", {
          class: `vscore${zero ? " zero" : ""}`,
          text: zero ? "—" : String(vendor.adoptionScore),
        }),
      ])
    );
    const fill = el("span");
    fill.style.width = `${vendor.adoptionScore}%`;
    card.appendChild(el("div", { class: "bar", "aria-hidden": "true" }, [fill]));
    if (vendor.monthly) {
      card.appendChild(
        el("div", { class: "vmoney" }, [
          el("span", {
            class: "mid",
            text:
              vendor.annual?.mid > 0
                ? `${formatUsd(vendor.annual.mid)}/yr`
                : vendor.monthly.mid > 0
                  ? `${formatUsd(vendor.monthly.mid)}/mo`
                  : "$0/yr",
          }),
          el("span", {
            class: "lohi",
            text:
              vendor.annual?.mid > 0
                ? `${formatUsd(vendor.monthly.mid)}/mo · ${formatUsd(vendor.annual.low)} – ${formatUsd(vendor.annual.high)}/yr`
                : vendor.monthly.mid > 0
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
    card.appendChild(el("p", { class: "vmeta", text: sizing }));
    for (const note of vendor.notes || []) {
      card.appendChild(el("p", { class: "vnote", text: note }));
    }
    const withValues = (vendor.evidence || []).filter((item) => item.value > 0);
    if (vendor.evidence && vendor.evidence.length) {
      card.appendChild(
        el("details", { class: "ev" }, [
          el("summary", { text: `Evidence (${withValues.length} active)` }),
          el(
            "ul",
            {},
            vendor.evidence.slice(0, 8).map((item) => {
              const url = safeHttpsUrl(item.url);
              const label = item.metric || item.detail || item.id;
              return el("li", {}, [
                url
                  ? el("a", {
                      href: url,
                      target: "_blank",
                      rel: "noopener noreferrer",
                      text: label,
                    })
                  : el("span", { text: label }),
                el("span", { class: "val", text: formatNumber(item.value) }),
              ]);
            })
          ),
        ])
      );
    }
    return card;
  }

  function renderReport() {
    const report = state.report;
    if (!report) return el("section", { class: "stage" });
    const orgs = (report.company && report.company.githubOrgs) || [];
    const orgText =
      orgs.length > 0
        ? `GitHub: ${orgs.map((org) => `@${org.login}`).join(", ")} · ${formatNumber(
            orgs.reduce((sum, org) => sum + (org.publicRepos || 0), 0)
          )} public repos`
        : "No public GitHub organization matched this company.";
    const headcountInput = el("input", {
      id: "headcount-input",
      type: "number",
      min: "1",
      max: "500000",
      step: "1",
      value: state.headcountOverride || "",
      placeholder: report.headcount.estimate
        ? String(report.headcount.estimate)
        : "e.g. 120",
    });
    headcountInput.addEventListener("input", () => {
      const value = Number(headcountInput.value);
      state.headcountOverride =
        Number.isFinite(value) && value > 0 ? value : null;
      const cursor = headcountInput.value;
      recompute();
      render();
      const next = document.getElementById("headcount-input");
      if (next) {
        next.value = cursor;
        next.focus();
      }
    });
    return el("section", {}, [
      statusNode(),
      el("div", { class: "summary" }, [
        el("div", { class: "panel" }, [scoreDial(report.overall.score)]),
        el("div", { class: "panel" }, [
          el("p", { class: "section-title", text: "Modeled annual ACV" }),
          el("div", { class: "company-line" }, [
            el("strong", { text: (report.company && report.company.name) || report.domain }),
            el("span", { class: "dom", text: report.domain }),
          ]),
          el("div", {
            class: "money",
            text: report.totalAnnual
              ? `${formatUsd(report.totalAnnual.mid)}/yr`
              : "$0/yr",
          }),
          el("p", {
            class: "range",
            text: report.totalAnnual
              ? `${formatUsd(report.totalAnnual.low)} – ${formatUsd(
                  report.totalAnnual.high
                )}/yr · ${formatUsd(report.totalMonthly.mid)}/mo mid`
              : "No spend-relevant public signals yet",
          }),
          mixBar(report),
          el("p", { class: "thesis", text: report.brief?.headline || "" }),
          el("p", { class: "thesis", text: report.brief?.thesis || "" }),
        ]),
        el("div", { class: "panel" }, [
          el("p", { class: "section-title", text: "Model inputs" }),
          el("div", {
            class: "money",
            text: report.headcount.estimate
              ? `${formatNumber(report.headcount.estimate)}`
              : "?",
          }),
          el("p", { class: "range", text: "engineers" }),
          el("p", { class: "thesis", text: report.headcount.description }),
          el("div", { class: "headcount" }, [
            el("label", { for: "headcount-input", text: "Override" }),
            headcountInput,
          ]),
          el("div", { class: "chips" }, coverageChips(report.coverage || {})),
          el("p", {
            class: "hint",
            text: `Confidence ${report.brief?.confidenceLabel || "—"} · ${(
              report.confidence * 100
            ).toFixed(0)}%`,
          }),
          el("p", { class: "hint", text: orgText }),
        ]),
      ]),
      report.brief?.drivers?.length
        ? el("div", { class: "panel", style: "margin-bottom:14px" }, [
            el("p", { class: "section-title", text: "What drives the read" }),
            el(
              "ul",
              { class: "caveats", style: "margin:0" },
              report.brief.drivers.map((line) => el("li", { text: line }))
            ),
          ])
        : null,
      el("div", { class: "vendors" }, report.vendors.map(vendorCard)),
      el("div", { class: "caveats" }, [
        el("strong", { text: "Read this like an analyst" }),
        el(
          "ul",
          {},
          report.caveats.map((caveat) => el("li", { text: caveat }))
        ),
      ]),
      el("div", { class: "foot" }, [
        el("span", {
          text: `Readings ${relativeTime(report.collectedAt) || "recently"} · ${
            report.model.id
          } v${report.model.version}`,
        }),
        el("button", {
          class: "ghost",
          type: "button",
          text: "Refresh readings",
          onClick: () =>
            startLookup(state.domain, {
              name: state.companyName,
              domain: state.domain,
              refresh: true,
            }),
        }),
      ]),
    ]);
  }

  function coverageChips(coverage) {
    const chips = [
      ["GitHub org", coverage.githubOrgResolved],
      ["Code search", coverage.codeSearch],
      ["Commit trails", coverage.commitSearch],
      ["Agent PRs", coverage.prSearch],
      ["Web research", coverage.webResearch === "ok"],
    ];
    return chips.map(([label, on]) =>
      el("span", { class: `chip${on ? " on" : ""}`, text: label })
    );
  }

  function renderMethod() {
    return el("section", { class: "method", style: "margin-top:0" }, [
      el("article", {}, [
        el("h3", { text: "1. Resolve" }),
        el("p", {
          text: "Company names hit a curated directory, then a domain. Unknown names can still scan if you paste the website.",
        }),
      ]),
      el("article", {}, [
        el("h3", { text: "2. Enrich once" }),
        el("p", {
          text: "Public GitHub markers, commit trailers, agent PRs, plus Firecrawl search for jobs/blogs. Stored in DynamoDB.",
        }),
      ]),
      el("article", {}, [
        el("h3", { text: "3. Score locally" }),
        el("p", {
          text: "ACES v2 maps public signals to an adoption tier, sizes the eng org, then prices enterprise ACV — not SMB seats from file counts.",
        }),
      ]),
      el("article", {}, [
        el("h3", { text: "Honest floor" }),
        el("p", {
          text: "Public signals only. Private repos, negotiated contracts, and API overage are invisible — treat this as directional.",
        }),
      ]),
    ]);
  }

  function render() {
    if (!root) return;
    root.replaceChildren();
    root.appendChild(renderTopbar());
    const stage = el("main", { class: "stage", id: "app-main" });
    if (state.view === "gate") stage.appendChild(renderGate());
    else if (state.view === "scan") stage.appendChild(renderScan());
    else if (state.view === "report") stage.appendChild(renderReport());
    else if (state.view === "method") stage.appendChild(renderMethod());
    else stage.appendChild(renderHome());
    root.appendChild(stage);
  }

  /* ---------- lookup flow ---------- */

  let suggestTimer = null;
  async function onQueryInput(value) {
    state.query = value;
    state.activeSuggest = -1;
    clearTimeout(suggestTimer);
    if (!value.trim()) {
      state.suggestions = [];
      state.suggestOpen = false;
      render();
      return;
    }
    suggestTimer = setTimeout(async () => {
      try {
        const result = await apiSuggest(value.trim());
        state.suggestions = result.suggestions || [];
        state.suggestOpen = state.suggestions.length > 0;
      } catch (error) {
        if (error.code === "ACCESS_REQUIRED") {
          state.view = "gate";
          state.gateError = "Access code required.";
        }
        state.suggestions = [];
        state.suggestOpen = false;
      }
      if (state.view === "home") {
        render();
        const input = document.getElementById("company-input");
        if (input) {
          input.focus();
          input.value = state.query;
          const end = input.value.length;
          input.setSelectionRange(end, end);
        }
      }
    }, 180);
  }

  function onQueryKeydown(event) {
    if (!state.suggestOpen || !state.suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.activeSuggest = Math.min(
        state.suggestions.length - 1,
        state.activeSuggest + 1
      );
      render();
      const input = document.getElementById("company-input");
      if (input) {
        input.focus();
        input.value = state.query;
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      state.activeSuggest = Math.max(-1, state.activeSuggest - 1);
      render();
      const input = document.getElementById("company-input");
      if (input) {
        input.focus();
        input.value = state.query;
      }
    } else if (event.key === "Enter" && state.activeSuggest >= 0) {
      event.preventDefault();
      const item = state.suggestions[state.activeSuggest];
      startLookup(item.domain, item);
    } else if (event.key === "Escape") {
      state.suggestOpen = false;
      render();
    }
  }

  function recompute() {
    if (!state.snapshot || !scoring) return;
    state.report = scoring.scoreCompany(state.snapshot, {
      headcountOverride: state.headcountOverride,
    });
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function advanceScanTheater() {
    if (state.view !== "scan") return;
    if (state.scanStep < 4) {
      state.scanStep += 1;
      render();
      setTimeout(advanceScanTheater, 900);
    }
  }

  function setStatus(kind, message, options) {
    state.status = {
      kind,
      message,
      spinner: options?.spinner === true,
      action: options?.action || null,
    };
  }

  function schedulePoll(query, seq) {
    stopPolling();
    if (state.pollsLeft <= 0) {
      setStatus(
        "warn",
        "Enrichment is taking longer than expected. Readings may still land shortly.",
        {
          action: {
            label: "Check again",
            onClick: () => startLookup(query, { quiet: true }),
          },
        }
      );
      if (state.view === "scan") state.view = state.snapshot ? "report" : "home";
      render();
      return;
    }
    state.pollTimer = setTimeout(async () => {
      if (seq !== state.requestSeq) return;
      state.pollsLeft -= 1;
      try {
        const result = await apiLookup(query, {
          companyName: state.companyName,
        });
        if (seq !== state.requestSeq) return;
        applyResult(query, result, seq);
      } catch (_error) {
        schedulePoll(query, seq);
      }
    }, POLL_INTERVAL_MS);
  }

  function applyResult(query, result, seq) {
    if (!result || typeof result !== "object") {
      setStatus("error", "The lookup returned an unexpected response.");
      state.view = "home";
      render();
      return;
    }
    if (result.status === "unresolved") {
      state.suggestions = result.suggestions || [];
      state.suggestOpen = state.suggestions.length > 0;
      state.view = "home";
      setStatus(
        "warn",
        `Could not resolve “${result.query || query}” to a company domain. Pick a match or paste the website.`
      );
      render();
      return;
    }

    state.meta = result.meta || null;
    state.domain = result.domain || state.domain;
    state.companyName = result.companyName || state.companyName;
    if (result.snapshot) {
      state.snapshot = result.snapshot;
      writeLocalCache(state.domain, result.snapshot, result.meta);
      recompute();
      if (state.report) {
        rememberRecent(
          { name: state.companyName, domain: state.domain },
          state.report
        );
      }
    }

    switch (result.status) {
      case "current":
        state.status = null;
        state.view = "report";
        state.scanStep = 5;
        break;
      case "queued":
        state.view = "scan";
        state.scanLabel = `Collecting public signals for ${state.domain} — first scan takes about a minute.`;
        setStatus("progress", state.scanLabel, { spinner: true });
        schedulePoll(state.domain || query, seq);
        break;
      case "refreshing":
        state.view = state.snapshot ? "report" : "scan";
        setStatus("progress", "Refreshing readings in the background…", {
          spinner: true,
        });
        schedulePoll(state.domain || query, seq);
        break;
      case "blocked":
        state.view = state.snapshot ? "report" : "home";
        setStatus(
          "warn",
          state.meta && state.meta.budgetExhausted
            ? "Today's enrichment budget is used up. Cached profiles still load; new scans resume tomorrow."
            : "Enrichment for this company is temporarily blocked. Try again later."
        );
        break;
      case "none":
        state.view = "home";
        setStatus(
          "warn",
          state.meta && state.meta.lastError
            ? `Enrichment has not succeeded yet (${state.meta.lastError}). Try again shortly.`
            : "No readings yet. Try scanning again.",
          {
            action: {
              label: "Retry",
              onClick: () => startLookup(state.domain || query, {}),
            },
          }
        );
        break;
      default:
        state.view = state.snapshot ? "report" : "home";
        state.status = null;
    }
    syncUrl();
    render();
  }

  async function startLookup(rawQuery, option) {
    const query = String(rawQuery || option?.domain || "").trim();
    if (!query) return;
    if (needsGate()) {
      state.view = "gate";
      render();
      return;
    }
    const seq = ++state.requestSeq;
    state.query = option?.name || query;
    state.companyName = option?.name || (looksLikeDomain(query) ? null : query);
    state.domain = option?.domain || (looksLikeDomain(query) ? query : null);
    state.headcountOverride = null;
    state.suggestOpen = false;
    state.pollsLeft = MAX_POLLS;
    stopPolling();

    const cachedDomain = state.domain;
    if (cachedDomain && !option?.refresh) {
      const cached = readLocalCache(cachedDomain);
      if (cached) {
        state.snapshot = cached.snapshot;
        state.meta = cached.meta || null;
        recompute();
      }
    }

    state.view = state.snapshot && !option?.refresh ? "report" : "scan";
    state.scanStep = 0;
    state.scanLabel = option?.refresh
      ? "Requesting a refresh…"
      : `Looking up ${state.query}…`;
    setStatus("progress", state.scanLabel, { spinner: true });
    syncUrl();
    render();
    setTimeout(advanceScanTheater, 400);

    try {
      const result = await apiLookup(query, {
        companyName: state.companyName,
        refresh: option?.refresh === true,
      });
      if (seq !== state.requestSeq) return;
      applyResult(query, result, seq);
    } catch (error) {
      if (seq !== state.requestSeq) return;
      if (error.code === "ACCESS_REQUIRED") {
        state.accessCode = "";
        writeAccessCode("");
        state.view = "gate";
        state.gateError = "A valid access code is required.";
      } else if (
        error.code === "NOT_CONFIGURED" ||
        error.code === "ENRICHMENT_NOT_CONFIGURED"
      ) {
        state.view = "home";
        setStatus(
          "warn",
          "The enrichment backend is not deployed yet, so live scans are unavailable."
        );
      } else if (error.code === "INVALID_QUERY" || error.code === "INVALID_DOMAIN") {
        state.view = "home";
        setStatus("error", "Enter a company name or domain, like Stripe or stripe.com.");
      } else {
        state.view = "home";
        setStatus("error", `Lookup failed: ${error.message}`);
      }
      render();
    }
  }

  /* ---------- boot ---------- */

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-wrap")) {
      if (state.suggestOpen) {
        state.suggestOpen = false;
        if (state.view === "home") render();
      }
    }
  });

  const params = new URLSearchParams(window.location.search);
  const initial =
    params.get("q") || params.get("company") || params.get("domain") || "";
  if (params.get("view") === "method") {
    state.view = "method";
    render();
  } else if (needsGate()) {
    state.view = "gate";
    render();
  } else if (initial) {
    render();
    startLookup(initial);
  } else {
    render();
  }
})();
