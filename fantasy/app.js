(function startRosterLab() {
  "use strict";

  const engine = window.TradeEngine;
  const demoData = window.FantasyDemoData;
  const espnClient = window.EspnFantasyClient;
  const sourceClient = window.RosterLabSourceClient;

  if (!engine || !demoData || !espnClient || !sourceClient) {
    document.body.innerHTML =
      '<div class="noscript-message">RosterLab could not load its analysis modules. Refresh the page to try again.</div>';
    return;
  }

  const LEAGUE_STORAGE_KEY = "rosterlab:league:v1";
  const WATCHLIST_STORAGE_KEY = "rosterlab:watchlist:v1";
  const SAVED_TRADES_STORAGE_KEY = "rosterlab:saved-trades:v1";
  const STRATEGY_STORAGE_KEY = "rosterlab:strategies:v1";
  const MAX_TRADE_PLAYERS_PER_SIDE = 8;
  const ROUTES = {
    overview: { title: "Overview", kicker: "Your league" },
    finder: { title: "Trade finder", kicker: "Opportunity board" },
    lab: { title: "Trade lab", kicker: "Scenario builder" },
    market: { title: "Player market", kicker: "League-wide values" },
    sources: { title: "Sources & model", kicker: "Data settings" },
  };

  const elements = {
    sidebar: document.getElementById("sidebar"),
    sidebarScrim: document.getElementById("sidebar-scrim"),
    workspace: document.querySelector(".workspace"),
    menuButton: document.getElementById("menu-button"),
    pageTitle: document.getElementById("page-title"),
    pageKicker: document.getElementById("page-kicker"),
    dataNotice: document.getElementById("data-notice"),
    dataNoticeMessage: document.getElementById("data-notice-message"),
    dataNoticeAction: document.getElementById("data-notice-action"),
    dataStateDot: document.getElementById("data-state-dot"),
    dataStateLabel: document.getElementById("data-state-label"),
    sidebarTeamMark: document.getElementById("sidebar-team-mark"),
    sidebarTeamName: document.getElementById("sidebar-team-name"),
    sidebarLeagueName: document.getElementById("sidebar-league-name"),
    teamSwitcher: document.getElementById("team-switcher"),
    navOpportunityCount: document.getElementById("nav-opportunity-count"),
    heroDate: document.getElementById("hero-date"),
    heroHeading: document.getElementById("hero-heading"),
    heroSummary: document.getElementById("hero-summary"),
    outlookRing: document.getElementById("outlook-ring"),
    outlookScore: document.getElementById("outlook-score"),
    outlookLabel: document.getElementById("outlook-label"),
    outlookDetail: document.getElementById("outlook-detail"),
    summaryMetrics: document.getElementById("summary-metrics"),
    categoryFormat: document.getElementById("category-format"),
    categoryList: document.getElementById("category-list"),
    overviewOpportunities: document.getElementById("overview-opportunities"),
    priorityNeeds: document.getElementById("priority-needs"),
    marketSignals: document.getElementById("market-signals"),
    finderPlayerSearch: document.getElementById("finder-player-search"),
    finderStrategy: document.getElementById("finder-strategy"),
    finderPosition: document.getElementById("finder-position"),
    finderCategory: document.getElementById("finder-category"),
    finderRealistic: document.getElementById("finder-realistic"),
    finderResultsSummary: document.getElementById("finder-results-summary"),
    finderList: document.getElementById("finder-list"),
    labPartnerSelect: document.getElementById("lab-partner-select"),
    sendPlayerSearch: document.getElementById("send-player-search"),
    receivePlayerSearch: document.getElementById("receive-player-search"),
    sendRoster: document.getElementById("send-roster"),
    receiveRoster: document.getElementById("receive-roster"),
    sendCount: document.getElementById("send-count"),
    receiveCount: document.getElementById("receive-count"),
    clearTradeButton: document.getElementById("clear-trade-button"),
    savedTrades: document.getElementById("saved-trades"),
    savedTradesCount: document.getElementById("saved-trades-count"),
    savedTradesList: document.getElementById("saved-trades-list"),
    labResult: document.getElementById("lab-result"),
    marketSearch: document.getElementById("market-search"),
    marketType: document.getElementById("market-type"),
    marketSort: document.getElementById("market-sort"),
    marketTableBody: document.getElementById("market-table-body"),
    marketEmpty: document.getElementById("market-empty"),
    sourceCards: document.getElementById("source-cards"),
    modelVersion: document.getElementById("model-version"),
    modelWeights: document.getElementById("model-weights"),
    refreshSourcesButton: document.getElementById("refresh-sources-button"),
    espnDialog: document.getElementById("espn-dialog"),
    espnForm: document.getElementById("espn-form"),
    leagueVisibilityOptions: document.querySelectorAll(
      'input[name="leagueVisibility"]'
    ),
    privateCredentials: document.getElementById("private-credentials"),
    privateModeCaption: document.getElementById("private-mode-caption"),
    espnLeagueId: document.getElementById("espn-league-id"),
    espnSeason: document.getElementById("espn-season"),
    espnTeamId: document.getElementById("espn-team-id"),
    espnS2: document.getElementById("espn-s2"),
    espnSwid: document.getElementById("espn-swid"),
    espnStatus: document.getElementById("espn-status"),
    espnSubmit: document.getElementById("espn-submit"),
    tradeDialog: document.getElementById("trade-dialog"),
    tradeDialogContent: document.getElementById("trade-dialog-content"),
    toast: document.getElementById("toast"),
  };

  function isLeagueData(value) {
    return Boolean(
      value &&
        value.league &&
        Array.isArray(value.teams) &&
        value.teams.length >= 2 &&
        Array.isArray(value.players) &&
        value.players.length > 0 &&
        Array.isArray(value.categories) &&
        value.categories.length > 0
    );
  }

  function readJsonStorage(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function savedLeague() {
    const value = readJsonStorage(LEAGUE_STORAGE_KEY, null);
    return isLeagueData(value) ? value : null;
  }

  function savedTradeRecords() {
    const value = readJsonStorage(SAVED_TRADES_STORAGE_KEY, []);
    return Array.isArray(value) ? value : [];
  }

  function cleanTeamStrategy(value) {
    const strategy = value && typeof value === "object" ? value : {};
    return {
      puntCategories: Array.isArray(strategy.puntCategories)
        ? [...new Set(strategy.puntCategories.map(String))]
        : [],
      focusCategories: Array.isArray(strategy.focusCategories)
        ? [...new Set(strategy.focusCategories.map(String))]
        : [],
      competeCategories: Array.isArray(strategy.competeCategories)
        ? [...new Set(strategy.competeCategories.map(String))]
        : [],
    };
  }

  function strategiesForLeague(data) {
    const stored = readJsonStorage(STRATEGY_STORAGE_KEY, {});
    const leagueStrategies =
      stored && typeof stored === "object"
        ? stored[String(data.league.id)] || {}
        : {};
    const teamIds = new Set(Object.keys(leagueStrategies));
    return Object.fromEntries(
      [...teamIds].map((teamId) => [
        String(teamId),
        cleanTeamStrategy(leagueStrategies[teamId]),
      ])
    );
  }

  function initialRoute() {
    const route = window.location.hash.replace(/^#/, "");
    return ROUTES[route] ? route : "overview";
  }

  const storedWatchlist = readJsonStorage(WATCHLIST_STORAGE_KEY, []);
  const initialData = savedLeague() || demoData;
  const state = {
    data: initialData,
    teamId: null,
    teamStrategies: strategiesForLeague(initialData),
    context: null,
    route: initialRoute(),
    baseOpportunities: [],
    displayedOpportunities: [],
    lab: {
      partnerTeamId: null,
      sending: new Set(),
      receiving: new Set(),
      sendQuery: "",
      receiveQuery: "",
    },
    finder: {
      query: "",
      strategy: "balanced",
      position: "ALL",
      category: "ALL",
      realisticOnly: true,
    },
    market: {
      query: "",
      type: "ALL",
      sort: "value",
    },
    watchlist: new Set(Array.isArray(storedWatchlist) ? storedWatchlist.map(String) : []),
  };
  state.teamId = String(state.data.activeTeamId || state.data.teams[0].id);

  let toastTimer = null;
  let activeImportController = null;
  let activeSourceController = null;
  let inferredEspnSeason = null;
  let inferredEspnTeam = null;
  let importAttempt = 0;
  let sourceRefreshAttempt = 0;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeColor(value) {
    const color = String(value || "");
    return /^#[0-9a-f]{6}$/i.test(color) ? color : "#5f746a";
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "#";
    } catch (error) {
      return "#";
    }
  }

  function initials(name) {
    return String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  function ordinal(value) {
    const number = Number(value);
    const remainder = number % 100;
    if (remainder >= 11 && remainder <= 13) return `${number}th`;
    if (number % 10 === 1) return `${number}st`;
    if (number % 10 === 2) return `${number}nd`;
    if (number % 10 === 3) return `${number}rd`;
    return `${number}th`;
  }

  function playerById(playerId) {
    return state.data.players.find(
      (player) => String(player.id) === String(playerId)
    );
  }

  function playerMatchesSearch(player, query) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (!normalizedQuery) return true;
    return [player.name, player.mlbTeam, player.positions.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  }

  function teamById(teamId) {
    return state.data.teams.find((team) => String(team.id) === String(teamId));
  }

  function currentTeam() {
    return teamById(state.teamId) || state.data.teams[0];
  }

  function currentTeamStrategy() {
    return cleanTeamStrategy(state.teamStrategies[String(state.teamId)]);
  }

  function categoryPlan(categoryId) {
    const strategy = currentTeamStrategy();
    if (strategy.puntCategories.includes(String(categoryId))) return "punt";
    if (strategy.focusCategories.includes(String(categoryId))) return "focus";
    if (strategy.competeCategories.includes(String(categoryId))) return "compete";
    return "auto";
  }

  function saveStrategies() {
    const stored = readJsonStorage(STRATEGY_STORAGE_KEY, {});
    const records = stored && typeof stored === "object" ? stored : {};
    records[String(state.data.league.id)] = state.teamStrategies;
    window.localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify(records));
  }

  function setCategoryPlan(categoryId, plan) {
    const category = state.data.categories.find(
      (candidate) => String(candidate.id) === String(categoryId)
    );
    if (!category || !["auto", "compete", "focus", "punt"].includes(plan)) return;
    const strategy = currentTeamStrategy();
    strategy.puntCategories = strategy.puntCategories.filter(
      (id) => id !== String(category.id)
    );
    strategy.focusCategories = strategy.focusCategories.filter(
      (id) => id !== String(category.id)
    );
    strategy.competeCategories = strategy.competeCategories.filter(
      (id) => id !== String(category.id)
    );
    if (plan === "punt") strategy.puntCategories.push(String(category.id));
    if (plan === "focus") strategy.focusCategories.push(String(category.id));
    if (plan === "compete") {
      strategy.competeCategories.push(String(category.id));
    }
    state.teamStrategies = {
      ...state.teamStrategies,
      [String(state.teamId)]: strategy,
    };
    try {
      saveStrategies();
    } catch (error) {
      showToast("The strategy changed, but this browser could not save it.");
    }
    renderAll();
    showToast(
      plan === "punt"
        ? `${category.label} is now excluded from trade value for ${currentTeam().name}.`
        : plan === "focus"
          ? `${category.label} now receives extra weight for ${currentTeam().name}.`
          : plan === "compete"
            ? `${category.label} will stay active even when the model detects a punt.`
            : `${category.label} returned to automatic strategy inference.`
    );
  }

  function playerRating(player) {
    return (
      state.context?.playerRatings?.get(String(player.id)) ||
      engine.ratePlayer(player, state.data.categories)
    );
  }

  function playerModelValue(player) {
    return playerRating(player).value;
  }

  function leagueRosterSettings() {
    return state.data.league?.rosterSettings || null;
  }

  function playerFitValue(player, teamId = state.teamId) {
    return engine.ratePlayerForTeam({
      player,
      teamId,
      players: state.data.players,
      teams: state.data.teams,
      categories: state.data.categories,
      teamStrategies: state.teamStrategies,
      rosterSettings: leagueRosterSettings(),
      context: state.context,
    }).contextualValue;
  }

  function formatTrend(value) {
    const number = Number(value) || 0;
    if (Math.abs(number) < 0.05) return "0.0";
    return `${number > 0 ? "+" : ""}${number.toFixed(1)}`;
  }

  function formatUpdatedAt(value) {
    if (!value || value === "Demo data") return "Demo fixture";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function playerAvatar(player) {
    return `<span class="player-avatar ${
      player.type === "pitcher" ? "is-pitcher" : ""
    }">${escapeHtml(initials(player.name))}</span>`;
  }

  function playerMeta(player) {
    return `${escapeHtml(player.mlbTeam)} · ${escapeHtml(
      player.positions.join("/")
    )} · Model ${escapeHtml(playerModelValue(player))}`;
  }

  function renderTradePlayer(player) {
    return `
      <div class="trade-player">
        ${playerAvatar(player)}
        <span class="trade-player-copy">
          <strong>${escapeHtml(player.name)}</strong>
          <small>${playerMeta(player)}</small>
        </span>
      </div>
    `;
  }

  function joinPlayerNames(players) {
    return players.map((player) => player.name).join(" + ");
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 2800);
  }

  function setSidebarOpen(open, options) {
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const nextOpen = mobile && open;
    elements.sidebar.classList.toggle("is-open", nextOpen);
    elements.sidebarScrim.hidden = !nextOpen;
    elements.menuButton.setAttribute("aria-expanded", String(nextOpen));
    elements.workspace.inert = nextOpen;
    if (nextOpen) elements.workspace.setAttribute("aria-hidden", "true");
    else elements.workspace.removeAttribute("aria-hidden");

    if (mobile) {
      elements.sidebar.setAttribute("aria-hidden", String(!nextOpen));
    } else {
      elements.sidebar.removeAttribute("aria-hidden");
    }

    if (nextOpen) {
      window.requestAnimationFrame(() => {
        elements.sidebar.querySelector(".nav-item.is-active")?.focus();
      });
    } else if (mobile && options && options.restoreFocus) {
      elements.menuButton.focus();
    }
  }

  function activateRoute(route, options) {
    const nextRoute = ROUTES[route] ? route : "overview";
    state.route = nextRoute;

    document.querySelectorAll("[data-page]").forEach((page) => {
      const active = page.dataset.page === nextRoute;
      page.hidden = !active;
      page.classList.toggle("is-active", active);
    });
    document.querySelectorAll(".nav-item[data-route]").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.route === nextRoute);
    });

    elements.pageTitle.textContent = ROUTES[nextRoute].title;
    elements.pageKicker.textContent = ROUTES[nextRoute].kicker;
    setSidebarOpen(false);

    if (!options || !options.fromHash) {
      const hash = `#${nextRoute}`;
      if (window.location.hash !== hash) {
        window.history.pushState(null, "", hash);
      }
    }
    if (options && options.focus) {
      document.getElementById("main-content").focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function findOpportunities(filters) {
    return engine.findTradeOpportunities({
      teamId: state.teamId,
      players: state.data.players,
      teams: state.data.teams,
      categories: state.data.categories,
      teamStrategies: state.teamStrategies,
      rosterSettings: leagueRosterSettings(),
      strategy: filters.strategy,
      position: filters.position,
      category: filters.category,
      realisticOnly: filters.realisticOnly,
      limit: 30,
    });
  }

  function summaryIcon(kind) {
    const icons = {
      finish:
        '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 17V5h9l-1.5 3L14 11H5M3 17h4"></path></svg>',
      value:
        '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 15.5 8 11l3 2 5-7M12 6h4v4"></path></svg>',
      need:
        '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"></circle><path d="M10 6v4l2.5 2"></path></svg>',
      trades:
        '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7h12M12 4l3 3-3 3M17 13H5M8 10l-3 3 3 3"></path></svg>',
    };
    return icons[kind] || icons.value;
  }

  function renderCategoryFilter() {
    const categoryIds = new Set(
      state.data.categories.map((category) => category.id)
    );
    if (
      state.finder.category !== "ALL" &&
      !categoryIds.has(state.finder.category)
    ) {
      state.finder.category = "ALL";
    }

    const optionsForGroup = (group) =>
      state.data.categories
        .filter((category) => category.group === group)
        .map(
          (category) =>
            `<option value="${escapeHtml(category.id)}">${escapeHtml(
              category.label
            )} · ${escapeHtml(category.name)}${
              category.direction === "lower" ? " · lower is better" : ""
            }</option>`
        )
        .join("");
    elements.finderCategory.innerHTML = `
      <option value="ALL">Any category</option>
      <optgroup label="Batting">${optionsForGroup("batting")}</optgroup>
      <optgroup label="Pitching">${optionsForGroup("pitching")}</optgroup>
    `;
    elements.finderCategory.value = state.finder.category;
  }

  function renderChrome() {
    const team = currentTeam();
    const isDemo = state.data.mode === "demo";
    const isHeadToHeadCategories =
      state.data.league.scoringType === "H2H_CATEGORY";
    const unmodeledCategories = Array.isArray(state.data.unmodeledCategories)
      ? state.data.unmodeledCategories
      : [];
    elements.sidebarTeamMark.textContent = team.abbreviation || initials(team.name);
    elements.sidebarTeamMark.style.background = safeColor(team.color);
    elements.sidebarTeamName.textContent = team.name;
    elements.sidebarLeagueName.textContent = state.data.league.name;
    elements.teamSwitcher.innerHTML = state.data.teams
      .map(
        (leagueTeam) =>
          `<option value="${escapeHtml(leagueTeam.id)}" ${
            String(leagueTeam.id) === String(state.teamId) ? "selected" : ""
          }>${escapeHtml(leagueTeam.name)}</option>`
      )
      .join("");
    elements.dataNotice.hidden =
      !isDemo &&
      unmodeledCategories.length === 0 &&
      !isHeadToHeadCategories;
    if (isDemo) {
      elements.dataNoticeMessage.textContent =
        "You are viewing an illustrative league. Values and news are demo fixtures, not live fantasy advice.";
      elements.dataNoticeAction.hidden = false;
    } else if (unmodeledCategories.length > 0) {
      const labels = unmodeledCategories
        .map((category) => category.label)
        .join(", ");
      elements.dataNoticeMessage.textContent = `${labels} ${
        unmodeledCategories.length === 1 ? "is" : "are"
      } active in this league but excluded from analysis because ESPN did not provide usable data or the stat ID is unknown.${
        isHeadToHeadCategories
          ? " H2H recommendations use category-strength and standings approximations, not a future weekly matchup simulation."
          : ""
      }`;
      elements.dataNoticeAction.hidden = true;
    } else if (isHeadToHeadCategories) {
      elements.dataNoticeMessage.textContent =
        "H2H recommendations use category-strength and standings approximations, not a future weekly matchup simulation.";
      elements.dataNoticeAction.hidden = true;
    }
    elements.dataStateDot.className = `status-dot ${
      isDemo ? "status-dot-demo" : "status-dot-live"
    }`;
    const latestEvidence =
      state.data.league.insightsUpdatedAt || state.data.league.updatedAt;
    elements.dataStateLabel.textContent = isDemo
      ? "Demo data"
      : `ESPN · ${formatUpdatedAt(latestEvidence)}`;
    elements.refreshSourcesButton.hidden =
      isDemo || !sourceClient.hasSourceEndpoint;
    elements.navOpportunityCount.textContent = String(state.baseOpportunities.length);
    renderCategoryFilter();
  }

  function outlookLabel(score) {
    if (score >= 82) return "Title contender";
    if (score >= 68) return "Contender";
    if (score >= 54) return "In the mix";
    return "Needs work";
  }

  function renderSummaryMetrics(analysis) {
    const primaryNeed = analysis.needs[0] || analysis.categoryRows[0];
    const metrics = [
      {
        icon: "finish",
        label: "Projected finish",
        value: `${ordinal(analysis.projectedFinish)} of ${state.data.teams.length}`,
        detail: currentTeam().record,
      },
      {
        icon: "value",
        label: "Evidence value",
        value: analysis.totalValue,
        detail: `${analysis.roster.length} active assets`,
      },
      {
        icon: "need",
        label: "Top need",
        value: primaryNeed.label,
        detail: `${ordinal(primaryNeed.rank)} in ${primaryNeed.name.toLowerCase()}`,
      },
      {
        icon: "trades",
        label: "Realistic matches",
        value: state.baseOpportunities.length,
        detail: `Across ${state.data.teams.length - 1} opponents`,
      },
    ];

    elements.summaryMetrics.innerHTML = metrics
      .map(
        (metric) => `
          <article class="summary-card">
            <span class="summary-icon">${summaryIcon(metric.icon)}</span>
            <div>
              <span>${escapeHtml(metric.label)}</span>
              <strong>${escapeHtml(metric.value)}</strong>
              <small>${escapeHtml(metric.detail)}</small>
            </div>
          </article>
        `
      )
      .join("");
  }

  function renderCategories(analysis) {
    elements.categoryFormat.textContent = state.data.league.scoring;
    elements.categoryList.innerHTML = analysis.categoryRows
      .map((category) => {
        const inferredPunt = category.strategy === "inferred-punt";
        const punted = inferredPunt || category.strategy === "punt";
        const plan = categoryPlan(category.id);
        const tone =
          punted
            ? "punt"
            : category.rank <= 2
            ? "strong"
            : category.rank >= state.data.teams.length - 1
              ? "weak"
              : "middle";
        const width = Math.max(8, category.percentile);
        return `
          <div class="category-row ${
            punted ? "is-punted" : ""
          }">
            <div class="category-meta">
              <span>${escapeHtml(category.label)} · ${escapeHtml(category.name)}${
                category.direction === "lower" ? " · lower is better" : ""
              }</span>
              <span class="category-rank-plan">
                <strong data-rank="${tone}">#${escapeHtml(category.rank)} of ${escapeHtml(
                  state.data.teams.length
                )}</strong>
                <label>
                  <span class="sr-only">Strategy for ${escapeHtml(category.name)}</span>
                  <select
                    data-action="category-plan"
                    data-category-id="${escapeHtml(category.id)}"
                    aria-label="Strategy for ${escapeHtml(category.name)}"
                  >
                    <option value="auto" ${
                      plan === "auto" ? "selected" : ""
                    }>Auto${inferredPunt ? " · Punt" : ""}</option>
                    <option value="compete" ${
                      plan === "compete" ? "selected" : ""
                    }>Compete</option>
                    <option value="focus" ${
                      plan === "focus" ? "selected" : ""
                    }>Focus</option>
                    <option value="punt" ${
                      plan === "punt" ? "selected" : ""
                    }>Punt</option>
                  </select>
                </label>
              </span>
            </div>
            <div class="category-track" aria-label="${escapeHtml(
              category.name
            )}, rank ${escapeHtml(category.rank)} of ${escapeHtml(
              state.data.teams.length
            )}">
              <span data-tone="${tone}" style="--width: ${width}%"></span>
            </div>
            ${
              inferredPunt
                ? `<p class="category-inference">Auto punt · ${escapeHtml(
                    Math.round(category.inference.confidence * 100)
                  )}% confidence · harder to recover than your other low categories</p>`
                : ""
            }
          </div>
        `;
      })
      .join("");
  }

  function renderOverviewOpportunities() {
    const opportunities = state.baseOpportunities.slice(0, 3);
    if (opportunities.length === 0) {
      elements.overviewOpportunities.innerHTML = `
        <div class="empty-list">
          <h3>No clean matches yet</h3>
          <p>Open the finder and include lower partner-fit offers to widen the board.</p>
        </div>
      `;
      return;
    }

    elements.overviewOpportunities.innerHTML = opportunities
      .map(
        (opportunity) => `
          <button
            class="mini-opportunity"
            type="button"
            data-action="trade-details"
            data-opportunity-id="${escapeHtml(opportunity.id)}"
          >
            <span class="mini-opportunity-main">
              <span class="mini-opportunity-team">
                <span
                  class="mini-team-dot"
                  style="--team-color: ${safeColor(opportunity.partnerTeam.color)}"
                ></span>
                ${escapeHtml(opportunity.partnerTeam.name)}
              </span>
              <span class="mini-opportunity-title">
                Send ${escapeHtml(joinPlayerNames(opportunity.sending))} · Get
                ${escapeHtml(joinPlayerNames(opportunity.receiving))}
              </span>
              <span class="mini-opportunity-reason">${escapeHtml(opportunity.reason)}</span>
            </span>
            <span class="grade-chip" data-tone="${escapeHtml(
              opportunity.result.grade.tone
            )}">${escapeHtml(opportunity.result.grade.letter)}</span>
          </button>
        `
      )
      .join("");
  }

  function renderPriorityNeeds(analysis) {
    elements.priorityNeeds.innerHTML = analysis.needs
      .slice(0, 3)
      .map((need, index) => {
        const availableTargets = state.data.players.filter(
          (player) => {
            const score = (player.modelScores || player.scores)?.[need.id];
            return (
              player.ownerTeamId !== state.teamId &&
              Number.isFinite(score) &&
              score >= 75
            );
          }
        ).length;
        const urgency = need.need >= 80 ? "High need" : need.need >= 55 ? "Medium need" : "Watch";
        return `
          <div class="need-row">
            <span class="need-rank">${escapeHtml(index + 1)}</span>
            <span class="need-copy">
              <strong>${escapeHtml(need.name)}</strong>
              <span>Rank ${escapeHtml(need.rank)} of ${escapeHtml(
                state.data.teams.length
              )} · ${escapeHtml(availableTargets)} possible targets</span>
            </span>
            <span class="need-score">${escapeHtml(urgency)}</span>
          </div>
        `;
      })
      .join("");
  }

  function renderMarketSignals() {
    const newsPlayers = state.data.players.filter((player) => player.news);
    const movers = [...state.data.players]
      .filter((player) => !newsPlayers.some((newsPlayer) => newsPlayer.id === player.id))
      .sort((left, right) => Math.abs(right.trend) - Math.abs(left.trend));
    const signals = [...newsPlayers, ...movers].slice(0, 3);

    elements.marketSignals.innerHTML = signals
      .map((player) => {
        const quantitative = Array.isArray(player.insights?.quantitative)
          ? player.insights.quantitative
              .filter((item) => item.freshness > 0)
              .sort(
                (left, right) =>
                  right.confidence * right.freshness -
                  left.confidence * left.freshness
              )[0]
          : null;
        const sourceRecord = quantitative
          ? state.data.sources.find(
              (source) => source.id === quantitative.sourceId
            )
          : null;
        const source = player.news
          ? player.news.source
          : sourceRecord?.name ||
            (player.statSource
              ? `ESPN ${player.statSource}`
              : "League market");
        const rating = playerRating(player);
        const detail = player.news
          ? player.news.headline
          : `${player.projection} · ${Math.round(
              rating.confidence * 100
            )}% evidence confidence · model ${rating.value}`;
        return `
          <article class="signal-card">
            <div class="signal-card-top">
              <span class="signal-source">${escapeHtml(source)}${
                state.data.mode === "demo" || player.news?.fixture ? " · demo" : ""
              }</span>
              <span class="signal-trend ${player.trend < 0 ? "is-down" : ""}">
                ${escapeHtml(formatTrend(player.trend))}
              </span>
            </div>
            <strong>${escapeHtml(player.name)}</strong>
            <p>${escapeHtml(detail)}</p>
          </article>
        `;
      })
      .join("");
  }

  function renderOverview(analysis) {
    const strength = analysis.strengths[0] || analysis.categoryRows[0];
    const need = analysis.needs[0] || strength;
    const manualPunts = analysis.categoryRows.filter(
      (category) => category.strategy === "punt"
    );
    const inferredPunts = analysis.categoryRows.filter(
      (category) => category.strategy === "inferred-punt"
    );
    const date = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date());
    elements.heroDate.textContent = `${date} · ${state.data.league.name}`;
    elements.heroHeading.textContent = `${strength.name} is your bankable strength. ${need.name} is the opening.`;
    const manualPuntText =
      manualPunts.length > 0
        ? `Punting ${manualPunts
            .map((category) => category.label)
            .join(" and ")}. `
        : "";
    const inferredPuntText =
      inferredPunts.length > 0
        ? `The model infers a punt in ${inferredPunts
            .map((category) => category.label)
            .join(" and ")} from relative standings and recovery cost. `
        : "";
    elements.heroSummary.textContent = `${manualPuntText}${inferredPuntText}You rank ${ordinal(
      strength.rank
    )} in ${strength.name.toLowerCase()} and ${ordinal(
      need.rank
    )} in ${need.name.toLowerCase()}. Shop from the surplus before paying full market value.`;
    elements.outlookRing.style.setProperty("--score", analysis.outlookScore);
    elements.outlookScore.textContent = analysis.outlookScore;
    elements.outlookLabel.textContent = outlookLabel(analysis.outlookScore);
    elements.outlookDetail.textContent = `Projected ${ordinal(
      analysis.projectedFinish
    )} of ${state.data.teams.length}`;

    renderSummaryMetrics(analysis);
    renderCategories(analysis);
    renderOverviewOpportunities();
    renderPriorityNeeds(analysis);
    renderMarketSignals();
  }

  function tradeCard(opportunity) {
    const likelihoodLabel =
      opportunity.result.acceptance >= 78
        ? "High"
        : opportunity.result.acceptance >= 64
          ? "Medium"
          : "Low";

    return `
      <article class="trade-card">
        <div class="trade-card-top">
          <span
            class="partner-name"
            style="--team-color: ${safeColor(opportunity.partnerTeam.color)}"
          >
            <span></span>
            ${escapeHtml(opportunity.partnerTeam.name)}
          </span>
          <span class="likelihood">
            Partner interest
            <b>${escapeHtml(likelihoodLabel)} · ${escapeHtml(
              opportunity.result.acceptance
            )}/100</b>
          </span>
        </div>
        <div class="trade-card-body">
          <div class="trade-sides">
            <div class="trade-side">
              <span>You send</span>
              <div class="trade-player-stack">
                ${opportunity.sending.map(renderTradePlayer).join("")}
              </div>
            </div>
            <span class="trade-arrow" aria-hidden="true">
              <svg viewBox="0 0 20 20"><path d="M4 10h12M11 5l5 5-5 5"></path></svg>
            </span>
            <div class="trade-side">
              <span>You receive</span>
              <div class="trade-player-stack">
                ${opportunity.receiving.map(renderTradePlayer).join("")}
              </div>
            </div>
          </div>
          <p class="trade-reason">${escapeHtml(opportunity.reason)} ${escapeHtml(
            opportunity.partnerReason
          )}</p>
          <div class="trade-card-footer">
            <div class="trade-score">
              <span class="grade-chip" data-tone="${escapeHtml(
                opportunity.result.grade.tone
              )}">${escapeHtml(opportunity.result.grade.letter)}</span>
              <span class="trade-score-copy">
                <strong>${escapeHtml(opportunity.result.grade.label)}</strong>
                <span>${escapeHtml(
                  engine.describeValueDelta(opportunity.result.valueDelta)
                )}</span>
              </span>
            </div>
            <button
              class="details-button"
              type="button"
              data-action="trade-details"
              data-opportunity-id="${escapeHtml(opportunity.id)}"
            >
              Inspect
              <svg viewBox="0 0 18 18" aria-hidden="true">
                <path d="M4 9h10M10 5l4 4-4 4"></path>
              </svg>
            </button>
          </div>
        </div>
      </article>
    `;
  }

  function renderFinder() {
    const opportunities = findOpportunities(state.finder).filter((opportunity) =>
      [...opportunity.sending, ...opportunity.receiving].some((player) =>
        playerMatchesSearch(player, state.finder.query)
      )
    );
    state.displayedOpportunities = opportunities;
    const realisticText = state.finder.realisticOnly ? " realistic" : "";
    const queryText = state.finder.query.trim();
    elements.finderResultsSummary.textContent = `${opportunities.length}${realisticText} ${
      opportunities.length === 1 ? "match" : "matches"
    }${queryText ? ` for "${queryText}"` : ` for ${currentTeam().name}`}`;

    if (opportunities.length === 0) {
      elements.finderList.innerHTML = `
        <div class="empty-list">
          <h3>${queryText ? "No matching players" : "No trades pass these filters"}</h3>
          <p>${
            queryText
              ? `No current trade result includes "${escapeHtml(queryText)}". Try another name or clear the search.`
              : "Try another position or include lower partner-fit offers. The model will still show fairness and roster fit."
          }</p>
          ${
            queryText
              ? '<button class="button button-secondary" type="button" data-action="clear-finder-search">Clear player search</button>'
              : state.finder.realisticOnly
              ? '<button class="button button-secondary" type="button" data-action="show-all-trades">Show every fair match</button>'
              : ""
          }
        </div>
      `;
      return;
    }

    elements.finderList.innerHTML = opportunities.map(tradeCard).join("");
  }

  function renderRosterPlayer(player, side, selected) {
    return `
      <button
        class="roster-player ${selected ? "is-selected" : ""}"
        type="button"
        data-action="toggle-player"
        data-side="${side}"
        data-player-id="${escapeHtml(player.id)}"
        aria-pressed="${selected ? "true" : "false"}"
      >
        ${playerAvatar(player)}
        <span class="trade-player-copy">
          <strong>${escapeHtml(player.name)}</strong>
          <small>${escapeHtml(player.mlbTeam)} · ${escapeHtml(
            player.positions.join("/")
          )}</small>
        </span>
        <span class="player-value">
          <strong>${escapeHtml(playerFitValue(player))}</strong>
          <span>team fit</span>
        </span>
        <span class="selection-box" aria-hidden="true">
          <svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7"></path></svg>
        </span>
      </button>
    `;
  }

  function emptyLabResult() {
    return `
      <div class="empty-result">
        <span class="empty-result-icon" aria-hidden="true">
          <svg viewBox="0 0 28 28">
            <path d="M5 9h16M17 5l4 4-4 4M23 19H7M11 15l-4 4 4 4"></path>
          </svg>
        </span>
        <h3>Build both sides</h3>
        <p>Select at least one player from each roster to grade the trade.</p>
      </div>
    `;
  }

  function renderLabResult() {
    const evaluation = engine.evaluateTrade({
      teamId: state.teamId,
      partnerTeamId: state.lab.partnerTeamId,
      sendingIds: [...state.lab.sending],
      receivingIds: [...state.lab.receiving],
      players: state.data.players,
      teams: state.data.teams,
      categories: state.data.categories,
      teamStrategies: state.teamStrategies,
      rosterSettings: leagueRosterSettings(),
      context: state.context,
    });

    if (!evaluation.valid) {
      elements.labResult.innerHTML = emptyLabResult();
      return;
    }

    const categoryImpacts = [...evaluation.deltas]
      .filter((delta) => Math.abs(delta.raw) >= 2)
      .sort(
        (left, right) =>
          Math.abs(right.teamWeighted) - Math.abs(left.teamWeighted) ||
          Math.abs(right.raw) - Math.abs(left.raw)
      )
      .slice(0, 5);
    const partnerFitText =
      evaluation.partnerDiscardedIncoming.length > 0
        ? `${evaluation.partnerDiscardedIncoming.length} incoming player${
            evaluation.partnerDiscardedIncoming.length === 1 ? "" : "s"
          } would fall below their roster cutoff and add no usable depth.`
        : evaluation.partnerDroppedPlayers.length > 0
          ? `They must cut ${evaluation.partnerDroppedPlayers.length} player${
              evaluation.partnerDroppedPlayers.length === 1 ? "" : "s"
            } before accepting this package.`
          : evaluation.partnerRosterFitPenalty >= 8
        ? `The offer leaves their ${
            evaluation.partnerMissingPositions[0]?.position || "lineup"
          } slot uncovered, so the interest score is capped.`
        : `Their roster changes by ${
            evaluation.partnerDecisionValueDelta >= 0 ? "+" : ""
          }${evaluation.partnerDecisionValueDelta} package-adjusted fit value and ${
            evaluation.partnerRotoPointGain >= 0 ? "+" : ""
          }${evaluation.partnerRotoPointGain} projected standings points.`;
    const availableReplacementNames = evaluation.replacementPlayers
      .filter((player) => player.replacementSource === "available-player")
      .map((player) => player.name);
    const rosterEffects = [
      evaluation.droppedPlayers.length > 0
        ? `${evaluation.droppedPlayers.length} roster cut${
            evaluation.droppedPlayers.length === 1 ? "" : "s"
          } required`
        : null,
      evaluation.discardedIncoming.length > 0
        ? `${evaluation.discardedIncoming.length} incoming player${
            evaluation.discardedIncoming.length === 1 ? "" : "s"
          } below your roster cutoff`
        : null,
      evaluation.replacementPlayers.length > 0
        ? availableReplacementNames.length > 0
          ? `Waiver replacement: ${availableReplacementNames.join(", ")}`
          : `${evaluation.replacementPlayers.length} estimated waiver replacement${
              evaluation.replacementPlayers.length === 1 ? "" : "s"
            }`
        : null,
    ].filter(Boolean);
    elements.labResult.innerHTML = `
      <div class="result-grade-header">
        <div class="result-grade-top">
          <span class="large-grade">${escapeHtml(evaluation.grade.letter)}</span>
          <div class="result-grade-copy">
            <span>Trade grade</span>
            <h3>${escapeHtml(evaluation.grade.label)}</h3>
          </div>
          <div class="result-grade-score">
            <strong>${escapeHtml(evaluation.score)}</strong>
            <span>fit score</span>
          </div>
        </div>
      </div>
      <div class="result-body">
        <div class="result-value-row">
          <div>
            <span>You send · model value</span>
            <strong>${escapeHtml(evaluation.valueOut)}</strong>
          </div>
          <strong>${evaluation.valueDelta >= 0 ? "+" : ""}${escapeHtml(
            evaluation.valueDelta
          )}</strong>
          <div>
            <span>You receive · model value</span>
            <strong>${escapeHtml(evaluation.valueIn)}</strong>
          </div>
        </div>
        <div class="result-section">
          <span>Category effect</span>
          <div class="impact-list">
            ${
              categoryImpacts.length > 0
                ? categoryImpacts
                    .map(
                      (impact) => `
                        <div class="impact-row">
                          <span>${escapeHtml(impact.name)}${
                            impact.direction === "lower"
                              ? " (lower is better)"
                              : ""
                          }${impact.punted ? " (punted)" : ""}</span>
                          <strong class="${
                            impact.punted
                              ? "is-muted"
                              : impact.raw > 0
                                ? "is-positive"
                                : "is-negative"
                          }">
                            ${impact.raw > 0 ? "+" : ""}${escapeHtml(impact.display)}
                          </strong>
                        </div>
                      `
                    )
                    .join("")
                : '<div class="impact-row"><span>Category mix</span><strong>Even</strong></div>'
            }
          </div>
        </div>
        <div class="result-section result-mutual-fit">
          <span>Roster spot effect</span>
          <p>${escapeHtml(
            rosterEffects.length > 0
              ? rosterEffects.join(" · ")
              : "No cuts or waiver replacements are required."
          )}</p>
        </div>
        <div class="result-meter-row">
          <div class="result-meter">
            <span>Value fairness</span>
            <span class="result-meter-track"><i style="--meter: ${evaluation.fairness}%"></i></span>
            <strong>${escapeHtml(evaluation.fairness)}</strong>
          </div>
          <div class="result-meter">
            <span>Partner interest</span>
            <span class="result-meter-track"><i style="--meter: ${evaluation.acceptance}%"></i></span>
            <strong>${escapeHtml(evaluation.acceptance)}</strong>
          </div>
          <div class="result-meter">
            <span>Data confidence</span>
            <span class="result-meter-track"><i style="--meter: ${evaluation.dataConfidence}%"></i></span>
            <strong>${escapeHtml(evaluation.dataConfidence)}</strong>
          </div>
        </div>
        <div class="result-section result-mutual-fit">
          <span>Partner decision factors</span>
          <p>${escapeHtml(partnerFitText)}</p>
        </div>
        <div class="result-actions">
          <button class="button button-primary" type="button" data-action="save-current-trade">
            Save scenario
          </button>
          <button class="button button-secondary" type="button" data-route="sources" aria-label="Inspect data sources">
            Sources
          </button>
        </div>
      </div>
    `;
  }

  function currentSavedTrades() {
    return savedTradeRecords()
      .filter(
        (record) =>
          String(record.leagueId) === String(state.data.league.id) &&
          String(record.teamId || state.teamId) === String(state.teamId)
      )
      .filter(
        (record) =>
          teamById(record.partnerTeamId) &&
          Array.isArray(record.sendingIds) &&
          record.sendingIds.every((playerId) => {
            const player = playerById(playerId);
            return (
              player &&
              String(player.ownerTeamId) === String(state.teamId)
            );
          }) &&
          Array.isArray(record.receivingIds) &&
          record.receivingIds.every((playerId) => {
            const player = playerById(playerId);
            return (
              player &&
              String(player.ownerTeamId) === String(record.partnerTeamId)
            );
          })
      )
      .slice(0, 6);
  }

  function renderSavedTrades() {
    const records = currentSavedTrades();
    elements.savedTrades.hidden = records.length === 0;
    elements.savedTradesCount.textContent = `${records.length} saved`;
    elements.savedTradesList.innerHTML = records
      .map((record) => {
        const sending = record.sendingIds.map(playerById).filter(Boolean);
        const receiving = record.receivingIds.map(playerById).filter(Boolean);
        const partner = teamById(record.partnerTeamId);
        const recordId = String(record.id || record.savedAt);
        const evaluation = engine.evaluateTrade({
          teamId: state.teamId,
          partnerTeamId: record.partnerTeamId,
          sendingIds: record.sendingIds,
          receivingIds: record.receivingIds,
          players: state.data.players,
          teams: state.data.teams,
          categories: state.data.categories,
          teamStrategies: state.teamStrategies,
          rosterSettings: leagueRosterSettings(),
          context: state.context,
        });
        return `
          <article class="saved-trade-card">
            <div class="saved-trade-copy">
              <strong>${escapeHtml(joinPlayerNames(sending))} for ${escapeHtml(
                joinPlayerNames(receiving)
              )}</strong>
              <span>${escapeHtml(partner.name)} · Fit ${escapeHtml(
                evaluation.score
              )}/100</span>
            </div>
            <div class="saved-trade-actions">
              <button
                type="button"
                data-action="load-saved-trade"
                data-saved-id="${escapeHtml(recordId)}"
                aria-label="Load saved trade"
              >
                <svg viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M4 9h10M10 5l4 4-4 4"></path>
                </svg>
              </button>
              <button
                type="button"
                data-action="delete-saved-trade"
                data-saved-id="${escapeHtml(recordId)}"
                aria-label="Delete saved trade"
              >
                <svg viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M4 5h10M7 5V3h4v2M6 7v7h6V7"></path>
                </svg>
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderLab() {
    const partnerTeams = state.data.teams.filter(
      (team) => String(team.id) !== String(state.teamId)
    );
    if (
      !state.lab.partnerTeamId ||
      !partnerTeams.some(
        (team) => String(team.id) === String(state.lab.partnerTeamId)
      )
    ) {
      state.lab.partnerTeamId =
        state.baseOpportunities[0]?.partnerTeam.id || partnerTeams[0]?.id || null;
      state.lab.receiving.clear();
    }

    const ownRoster = engine
      .playersForTeam(state.data.players, state.teamId)
      .sort((left, right) => playerFitValue(right) - playerFitValue(left));
    const partnerRoster = engine
      .playersForTeam(state.data.players, state.lab.partnerTeamId)
      .sort(
        (left, right) =>
          playerFitValue(right, state.lab.partnerTeamId) -
          playerFitValue(left, state.lab.partnerTeamId)
      );
    const visibleOwnRoster = ownRoster.filter((player) =>
      playerMatchesSearch(player, state.lab.sendQuery)
    );
    const visiblePartnerRoster = partnerRoster.filter((player) =>
      playerMatchesSearch(player, state.lab.receiveQuery)
    );
    const ownIds = new Set(ownRoster.map((player) => String(player.id)));
    const partnerIds = new Set(partnerRoster.map((player) => String(player.id)));
    state.lab.sending = new Set(
      [...state.lab.sending].filter((playerId) => ownIds.has(String(playerId)))
    );
    state.lab.receiving = new Set(
      [...state.lab.receiving].filter((playerId) => partnerIds.has(String(playerId)))
    );

    elements.labPartnerSelect.innerHTML = partnerTeams
      .map(
        (team) =>
          `<option value="${escapeHtml(team.id)}" ${
            String(team.id) === String(state.lab.partnerTeamId) ? "selected" : ""
          }>${escapeHtml(team.name)}</option>`
      )
      .join("");
    elements.sendRoster.innerHTML =
      visibleOwnRoster.length > 0
        ? visibleOwnRoster
            .map((player) =>
              renderRosterPlayer(
                player,
                "send",
                state.lab.sending.has(String(player.id))
              )
            )
            .join("")
        : '<div class="roster-empty">No players match this search.</div>';
    elements.receiveRoster.innerHTML =
      visiblePartnerRoster.length > 0
        ? visiblePartnerRoster
            .map((player) =>
              renderRosterPlayer(
                player,
                "receive",
                state.lab.receiving.has(String(player.id))
              )
            )
            .join("")
        : '<div class="roster-empty">No players match this search.</div>';
    elements.sendCount.textContent = `${state.lab.sending.size} selected`;
    elements.receiveCount.textContent = `${state.lab.receiving.size} selected`;
    renderSavedTrades();
    renderLabResult();
  }

  function marketRows() {
    const query = state.market.query.trim().toLowerCase();
    const filtered = state.data.players.filter((player) => {
      const owner = teamById(player.ownerTeamId);
      const searchable = [
        player.name,
        player.mlbTeam,
        player.positions.join(" "),
        owner ? owner.name : "",
      ]
        .join(" ")
        .toLowerCase();
      const queryMatches = !query || searchable.includes(query);
      const typeMatches =
        state.market.type === "ALL" ||
        player.type === state.market.type ||
        (state.market.type === "MY_TEAM" &&
          String(player.ownerTeamId) === String(state.teamId));
      return queryMatches && typeMatches;
    });

    filtered.sort((left, right) => {
      if (state.market.sort === "trend") return right.trend - left.trend;
      if (state.market.sort === "ownership") return right.ownership - left.ownership;
      if (state.market.sort === "name") return left.name.localeCompare(right.name);
      return playerModelValue(right) - playerModelValue(left);
    });
    return filtered;
  }

  function renderMarket() {
    const players = marketRows();
    elements.marketEmpty.hidden = players.length > 0;
    elements.marketTableBody.innerHTML = players
      .map((player) => {
        const owner = teamById(player.ownerTeamId);
        const watched = state.watchlist.has(String(player.id));
        const ownPlayer = String(player.ownerTeamId) === String(state.teamId);
        const rating = playerRating(player);
        const evidenceSources = [
          ...(Array.isArray(player.insights?.quantitative)
            ? player.insights.quantitative.map((item) => item.sourceId)
            : []),
          ...(Array.isArray(player.insights?.qualitative)
            ? player.insights.qualitative.map((item) => item.sourceId)
            : []),
        ];
        const sourceText =
          [...new Set(evidenceSources)].join(", ") ||
          (player.statSource ? `ESPN ${player.statSource}` : "League fixture");
        return `
          <tr>
            <td>
              <div class="market-player">
                ${playerAvatar(player)}
                <span class="market-player-copy">
                  <strong>${escapeHtml(player.name)}</strong>
                  <span>${escapeHtml(player.mlbTeam)} · ${escapeHtml(
                    player.positions.join("/")
                  )}</span>
                </span>
              </div>
            </td>
            <td class="roster-cell">${escapeHtml(
              ownPlayer ? "Your roster" : owner?.name || "Free agent"
            )}</td>
            <td class="projection-cell" title="${escapeHtml(
              `${sourceText} · ${Math.round(rating.confidence * 100)}% confidence`
            )}">
              ${escapeHtml(player.projection)}
            </td>
            <td class="number-cell">${escapeHtml(player.ownership)}%</td>
            <td class="number-cell">
              <span class="trend-value ${player.trend < 0 ? "is-down" : ""}">
                ${escapeHtml(formatTrend(player.trend))}
              </span>
            </td>
            <td>
              <span
                class="market-value-badge"
                title="${escapeHtml(
                  `${Math.round(rating.confidence * 100)}% evidence confidence · ${playerFitValue(
                    player
                  )} value for ${currentTeam().name}`
                )}"
              >${escapeHtml(rating.value)}</span>
            </td>
            <td>
              <button
                class="watch-button ${watched ? "is-watched" : ""}"
                type="button"
                data-action="toggle-watch"
                data-player-id="${escapeHtml(player.id)}"
                aria-label="${watched ? "Remove" : "Add"} ${escapeHtml(
                  player.name
                )} ${watched ? "from" : "to"} watchlist"
                aria-pressed="${watched ? "true" : "false"}"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m10 3 2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2L5.8 16l.8-4.7L3.2 8l4.7-.7L10 3Z"></path>
                </svg>
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function sourceStatusLabel(status) {
    const labels = {
      connected: "Connected",
      demo: "Demo fixture",
      fixture: "Demo fixture",
      disconnected: "Not connected",
      stale: "Stale",
      error: "Unavailable",
    };
    return labels[status] || status;
  }

  function renderSources() {
    elements.sourceCards.innerHTML = state.data.sources
      .map(
        (source) => `
          <article class="source-card">
            <div class="source-card-top">
              <span class="source-logo">${escapeHtml(initials(source.name))}</span>
              <span class="source-status" data-status="${escapeHtml(source.status)}">
                ${escapeHtml(sourceStatusLabel(source.status))}
              </span>
            </div>
            <h3>${escapeHtml(source.name)}</h3>
            <p>${escapeHtml(source.coverage)}</p>
            <div class="source-card-footer">
              <span>${escapeHtml(
                source.updatedAt
                  ? `Updated ${formatUpdatedAt(source.updatedAt)}`
                  : source.cadence
              )}${
                source.access === "licensed"
                  ? " · Licensed"
                  : source.access === "official"
                    ? " · Official"
                    : ""
              }</span>
              <a href="${escapeHtml(
                safeExternalUrl(source.url)
              )}" target="_blank" rel="noopener noreferrer">Source</a>
            </div>
          </article>
        `
      )
      .join("");

    elements.modelVersion.textContent = state.data.model.version;
    const adjustmentText = Array.isArray(state.data.model.adjustments)
      ? `<p class="model-adjustments">Then adjusted for ${escapeHtml(
          state.data.model.adjustments.join(", ")
        )}.</p>`
      : "";
    elements.modelWeights.innerHTML =
      state.data.model.weights
      .map(
        (weight) => `
          <div class="model-weight-row">
            <div class="model-weight-meta">
              <span>${escapeHtml(weight.label)}</span>
              <strong>${escapeHtml(weight.value)}%</strong>
            </div>
            <div class="model-weight-track" aria-label="${escapeHtml(
              weight.label
            )}, ${escapeHtml(weight.value)} percent">
              <span style="--weight: ${Math.max(
                0,
                Math.min(100, Number(weight.value) || 0)
              )}%"></span>
            </div>
          </div>
        `
      )
      .join("") + adjustmentText;
  }

  function renderAll() {
    const validTeam = teamById(state.teamId);
    if (!validTeam) state.teamId = String(state.data.teams[0].id);
    state.context = engine.computeLeagueContext({
      players: state.data.players,
      teams: state.data.teams,
      categories: state.data.categories,
      teamStrategies: state.teamStrategies,
      rosterSettings: leagueRosterSettings(),
    });
    const analysis = engine.getTeamAnalysis({
      teamId: state.teamId,
      players: state.data.players,
      teams: state.data.teams,
      categories: state.data.categories,
      teamStrategies: state.teamStrategies,
      rosterSettings: leagueRosterSettings(),
      context: state.context,
    });
    if (!analysis) throw new Error("The active team could not be analyzed.");

    state.baseOpportunities = findOpportunities({
      strategy: "balanced",
      position: "ALL",
      category: "ALL",
      realisticOnly: true,
    });
    renderChrome();
    renderOverview(analysis);
    renderFinder();
    renderLab();
    renderMarket();
    renderSources();
    activateRoute(state.route, { fromHash: true });
  }

  function allKnownOpportunities() {
    const opportunities = [
      ...state.baseOpportunities,
      ...state.displayedOpportunities,
    ];
    return new Map(opportunities.map((opportunity) => [opportunity.id, opportunity]));
  }

  function openTradeDetails(opportunityId) {
    const opportunity = allKnownOpportunities().get(opportunityId);
    if (!opportunity) return;
    const gainChips = opportunity.result.gains.slice(0, 3);
    const lossChips = opportunity.result.losses.slice(0, 2);
    const rosterNotes = [
      opportunity.result.droppedPlayers.length > 0
        ? `${opportunity.result.droppedPlayers.length} cut${
            opportunity.result.droppedPlayers.length === 1 ? "" : "s"
          } required`
        : null,
      opportunity.result.discardedIncoming.length > 0
        ? `${opportunity.result.discardedIncoming.length} incoming player${
            opportunity.result.discardedIncoming.length === 1 ? "" : "s"
          } below cutoff`
        : null,
      opportunity.result.replacementPlayers.length > 0
        ? opportunity.result.replacementPlayers.some(
            (player) => player.replacementSource === "available-player"
          )
          ? `Waiver replacement: ${opportunity.result.replacementPlayers
              .filter(
                (player) =>
                  player.replacementSource === "available-player"
              )
              .map((player) => player.name)
              .join(", ")}`
          : `${opportunity.result.replacementPlayers.length} estimated waiver replacement${
              opportunity.result.replacementPlayers.length === 1 ? "" : "s"
            }`
        : null,
    ].filter(Boolean);
    elements.tradeDialogContent.innerHTML = `
      <div class="trade-detail-heading">
        <div>
          <p class="section-label">Trade with ${escapeHtml(
            opportunity.partnerTeam.name
          )}</p>
          <h2 id="trade-dialog-title">${escapeHtml(
            joinPlayerNames(opportunity.receiving)
          )} fits the gap</h2>
          <p>${escapeHtml(
            engine.describeValueDelta(opportunity.result.valueDelta)
          )} · ${escapeHtml(opportunity.result.fairness)}/100 fairness · ${escapeHtml(
            opportunity.result.dataConfidence
          )}% data confidence</p>
        </div>
        <button class="icon-button" type="button" data-action="close-trade" aria-label="Close">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"></path></svg>
        </button>
      </div>
      <div class="trade-detail-score">
        <span class="large-grade">${escapeHtml(opportunity.result.grade.letter)}</span>
        <span class="trade-detail-score-copy">
          <strong>${escapeHtml(opportunity.result.grade.label)}</strong>
          <span>${escapeHtml(opportunity.reason)}</span>
        </span>
        <span class="trade-detail-number">${escapeHtml(opportunity.result.score)}</span>
      </div>
      <div class="detail-sides">
        <div class="detail-side">
          <span>You send · ${escapeHtml(opportunity.result.valueOut)} model value</span>
          ${opportunity.sending.map(renderTradePlayer).join("")}
        </div>
        <div class="detail-side">
          <span>You receive · ${escapeHtml(opportunity.result.valueIn)} model value</span>
          ${opportunity.receiving.map(renderTradePlayer).join("")}
        </div>
      </div>
      <div class="detail-analysis">
        <div class="detail-point">
          <span>Your fit</span>
          <p>${escapeHtml(opportunity.reason)}</p>
        </div>
        <div class="detail-point">
          <span>Their fit</span>
          <p>${escapeHtml(opportunity.partnerReason)}</p>
        </div>
        <div class="detail-point">
          <span>Main risk</span>
          <p>${escapeHtml(opportunity.risk)}</p>
        </div>
      </div>
      <div class="detail-category-row">
        <span>Roster spot effect</span>
        <div class="category-chips">
          <span class="category-chip">${escapeHtml(
            rosterNotes.length > 0
              ? rosterNotes.join(" · ")
              : "No cuts or waiver replacements required"
          )}</span>
        </div>
      </div>
      <div class="detail-category-row">
        <span>Projected category effect</span>
        <div class="category-chips">
          ${gainChips
            .map(
              (gain) =>
                `<span class="category-chip is-positive">+ ${escapeHtml(
                  gain.label
                )}${gain.direction === "lower" ? " (lower)" : ""}</span>`
            )
            .join("")}
          ${lossChips
            .map(
              (loss) =>
                `<span class="category-chip is-negative">- ${escapeHtml(
                  loss.label
                )}${loss.direction === "lower" ? " (lower)" : ""}</span>`
            )
            .join("")}
        </div>
      </div>
      <div class="trade-detail-actions">
        <button class="button button-quiet" type="button" data-action="save-opportunity" data-opportunity-id="${escapeHtml(
          opportunity.id
        )}">Save scenario</button>
        <button class="button button-primary" type="button" data-action="use-opportunity" data-opportunity-id="${escapeHtml(
          opportunity.id
        )}">Open in trade lab</button>
      </div>
    `;
    elements.tradeDialog.showModal();
  }

  function useOpportunity(opportunityId) {
    const opportunity = allKnownOpportunities().get(opportunityId);
    if (!opportunity) return;
    state.lab.partnerTeamId = String(opportunity.partnerTeam.id);
    state.lab.sending = new Set(opportunity.sending.map((player) => String(player.id)));
    state.lab.receiving = new Set(
      opportunity.receiving.map((player) => String(player.id))
    );
    elements.tradeDialog.close();
    renderLab();
    activateRoute("lab", { focus: true });
  }

  function saveTradeRecord(record) {
    const list = savedTradeRecords();
    list.unshift({
      ...record,
      id:
        typeof window.crypto?.randomUUID === "function"
          ? window.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      savedAt: new Date().toISOString(),
      leagueId: state.data.league.id,
      teamId: state.teamId,
    });
    try {
      window.localStorage.setItem(
        SAVED_TRADES_STORAGE_KEY,
        JSON.stringify(list.slice(0, 20))
      );
      renderSavedTrades();
      showToast("Scenario saved on this device.");
    } catch (error) {
      showToast("This browser could not save the scenario.");
    }
  }

  function saveOpportunity(opportunityId) {
    const opportunity = allKnownOpportunities().get(opportunityId);
    if (!opportunity) return;
    saveTradeRecord({
      partnerTeamId: opportunity.partnerTeam.id,
      sendingIds: opportunity.sending.map((player) => player.id),
      receivingIds: opportunity.receiving.map((player) => player.id),
      score: opportunity.result.score,
    });
  }

  function saveCurrentTrade() {
    const evaluation = engine.evaluateTrade({
      teamId: state.teamId,
      partnerTeamId: state.lab.partnerTeamId,
      sendingIds: [...state.lab.sending],
      receivingIds: [...state.lab.receiving],
      players: state.data.players,
      teams: state.data.teams,
      categories: state.data.categories,
      teamStrategies: state.teamStrategies,
      rosterSettings: leagueRosterSettings(),
      context: state.context,
    });
    if (!evaluation.valid) return;
    saveTradeRecord({
      partnerTeamId: state.lab.partnerTeamId,
      sendingIds: [...state.lab.sending],
      receivingIds: [...state.lab.receiving],
      score: evaluation.score,
    });
  }

  function loadSavedTrade(savedId) {
    const record = currentSavedTrades().find(
      (candidate) => String(candidate.id || candidate.savedAt) === String(savedId)
    );
    if (
      !record ||
      String(record.leagueId) !== String(state.data.league.id) ||
      !teamById(record.partnerTeamId)
    ) {
      showToast("That saved scenario is no longer available in this league.");
      return;
    }

    state.lab.partnerTeamId = String(record.partnerTeamId);
    state.lab.sending = new Set(record.sendingIds.map(String));
    state.lab.receiving = new Set(record.receivingIds.map(String));
    renderLab();
    activateRoute("lab", { focus: true });
    showToast("Saved scenario loaded.");
  }

  function deleteSavedTrade(savedId) {
    const records = savedTradeRecords().filter(
      (record) => String(record.id || record.savedAt) !== String(savedId)
    );
    try {
      window.localStorage.setItem(
        SAVED_TRADES_STORAGE_KEY,
        JSON.stringify(records)
      );
      renderSavedTrades();
      window.requestAnimationFrame(() => {
        const nextControl = elements.savedTrades.querySelector(
          '[data-action="load-saved-trade"]'
        );
        (nextControl || elements.clearTradeButton).focus();
      });
      showToast("Saved scenario deleted.");
    } catch (error) {
      showToast("This browser could not delete the scenario.");
    }
  }

  function toggleLabPlayer(side, playerId) {
    const collection = side === "send" ? state.lab.sending : state.lab.receiving;
    const key = String(playerId);
    if (collection.has(key)) {
      collection.delete(key);
    } else if (collection.size >= MAX_TRADE_PLAYERS_PER_SIDE) {
      showToast(
        `Trade scenarios support up to ${MAX_TRADE_PLAYERS_PER_SIDE} players per side.`
      );
      return;
    } else {
      collection.add(key);
    }
    renderLab();
    window.requestAnimationFrame(() => {
      const roster = side === "send" ? elements.sendRoster : elements.receiveRoster;
      [...roster.querySelectorAll("[data-player-id]")]
        .find((button) => button.dataset.playerId === key)
        ?.focus();
    });
  }

  function resetPlayerSearches() {
    state.finder.query = "";
    state.lab.sendQuery = "";
    state.lab.receiveQuery = "";
    elements.finderPlayerSearch.value = "";
    elements.sendPlayerSearch.value = "";
    elements.receivePlayerSearch.value = "";
  }

  function applyEspnReferenceDetails() {
    const input = elements.espnLeagueId.value.trim();
    elements.espnLeagueId.setCustomValidity("");
    if (
      inferredEspnSeason &&
      elements.espnSeason.value === inferredEspnSeason
    ) {
      elements.espnSeason.value = String(
        Number(state.data.league.season) || new Date().getFullYear()
      );
    }
    if (inferredEspnTeam && elements.espnTeamId.value === inferredEspnTeam) {
      elements.espnTeamId.value = "";
    }
    inferredEspnSeason = null;
    inferredEspnTeam = null;
    elements.espnStatus.className = "form-status";
    elements.espnStatus.textContent = "";
    if (!input) return;

    try {
      const reference = espnClient.parseLeagueReference(input);
      if (reference.season) {
        elements.espnSeason.value = reference.season;
        inferredEspnSeason = reference.season;
      }
      if (reference.teamId) {
        elements.espnTeamId.value = reference.teamId;
        inferredEspnTeam = reference.teamId;
      }
      if (/espn\.com/i.test(input)) {
        elements.espnStatus.className = "form-status is-success";
        elements.espnStatus.textContent = `Found league ${reference.leagueId}${
          reference.teamId ? `, team ${reference.teamId}` : ""
        }.`;
      }
    } catch (error) {
      return;
    }
  }

  function selectedLeagueVisibility() {
    return (
      [...elements.leagueVisibilityOptions].find((option) => option.checked)
        ?.value || "public"
    );
  }

  function privateVisibilityOption() {
    return [...elements.leagueVisibilityOptions].find(
      (option) => option.value === "private"
    );
  }

  function clearEspnCredentials() {
    elements.espnS2.value = "";
    elements.espnSwid.value = "";
    elements.espnS2.setCustomValidity("");
    elements.espnSwid.setCustomValidity("");
  }

  function setImportBusy(busy) {
    elements.espnForm.setAttribute("aria-busy", String(busy));
    [
      elements.espnLeagueId,
      elements.espnSeason,
      elements.espnTeamId,
      elements.espnS2,
      elements.espnSwid,
      ...elements.leagueVisibilityOptions,
    ].forEach((control) => {
      control.disabled = busy;
    });
    if (!busy && !espnClient.hasImportRelay) {
      privateVisibilityOption().disabled = true;
    }
    elements.espnSubmit.disabled = busy;
  }

  function setLeagueVisibility(visibility, options) {
    const requestedPrivate = visibility === "private";
    const isPrivate = requestedPrivate && espnClient.hasImportRelay;
    elements.leagueVisibilityOptions.forEach((option) => {
      option.checked = option.value === (isPrivate ? "private" : "public");
    });
    elements.privateCredentials.hidden = !isPrivate;
    elements.espnS2.required = isPrivate;
    elements.espnSwid.required = isPrivate;

    if (!isPrivate) {
      clearEspnCredentials();
    }
    if (requestedPrivate && !espnClient.hasImportRelay) {
      elements.espnStatus.className = "form-status is-error";
      elements.espnStatus.textContent =
        "Private import is not configured in this environment yet.";
    }

    if (isPrivate && options?.focus) {
      window.setTimeout(() => elements.espnS2.focus(), 0);
    }
  }

  function openEspnDialog() {
    inferredEspnSeason = null;
    inferredEspnTeam = null;
    elements.espnStatus.textContent = "";
    elements.espnStatus.className = "form-status";
    clearEspnCredentials();
    privateVisibilityOption().disabled = !espnClient.hasImportRelay;
    elements.privateModeCaption.textContent = espnClient.hasImportRelay
      ? "Use your ESPN session for one request"
      : "Unavailable until the secure relay is deployed";
    setImportBusy(false);
    setLeagueVisibility("public");
    elements.espnLeagueId.value =
      state.data.mode === "espn" ? state.data.league.id : "";
    elements.espnSeason.value = String(
      Number(state.data.league.season) || new Date().getFullYear()
    );
    elements.espnTeamId.value =
      state.data.mode === "espn" ? state.teamId : "";
    elements.espnDialog.showModal();
    window.setTimeout(() => elements.espnLeagueId.focus(), 0);
  }

  function closeEspnDialog() {
    importAttempt += 1;
    if (activeImportController) {
      activeImportController.abort();
      activeImportController = null;
    }
    setImportBusy(false);
    clearEspnCredentials();
    if (elements.espnDialog.open) elements.espnDialog.close();
  }

  async function importEspnLeague(event) {
    event.preventDefault();
    const formData = new FormData(elements.espnForm);
    const leagueReference = String(formData.get("leagueId") || "").trim();
    const season = String(formData.get("season") || "").trim();
    const teamId = String(formData.get("teamId") || "").trim();
    const visibility = selectedLeagueVisibility();
    const espnS2 =
      visibility === "private"
        ? String(formData.get("espnS2") || "").trim()
        : "";
    const swid =
      visibility === "private"
        ? String(formData.get("swid") || "").trim()
        : "";

    elements.espnStatus.className = "form-status";
    elements.espnLeagueId.setCustomValidity("");
    if (visibility === "private" && (!espnS2 || !swid)) {
      clearEspnCredentials();
      if (!espnS2) {
        elements.espnS2.setCustomValidity("Paste your espn_s2 value.");
        elements.espnS2.reportValidity();
      } else {
        elements.espnSwid.setCustomValidity("Paste your SWID value.");
        elements.espnSwid.reportValidity();
      }
      elements.espnStatus.className = "form-status is-error";
      elements.espnStatus.textContent =
        "Both ESPN session values are required for a private league.";
      return;
    }

    let leagueId;
    try {
      leagueId = espnClient.parseLeagueReference(leagueReference).leagueId;
    } catch (error) {
      clearEspnCredentials();
      const message =
        error instanceof Error ? error.message : "Enter a valid ESPN league URL.";
      elements.espnLeagueId.setCustomValidity(message);
      elements.espnLeagueId.reportValidity();
      elements.espnStatus.className = "form-status is-error";
      elements.espnStatus.textContent = message;
      return;
    }

    if (visibility === "private" && !espnClient.hasImportRelay) {
      clearEspnCredentials();
      elements.espnStatus.className = "form-status is-error";
      elements.espnStatus.textContent =
        "Private import is not configured in this environment yet.";
      return;
    }

    elements.espnStatus.textContent =
      visibility === "private"
        ? "Connecting to your private league..."
        : "Importing your league...";
    sourceRefreshAttempt += 1;
    if (activeSourceController) {
      activeSourceController.abort();
      activeSourceController = null;
    }
    const attempt = ++importAttempt;
    const controller = new AbortController();
    activeImportController = controller;
    setImportBusy(true);

    try {
      let league = await espnClient.fetchLeague({
        leagueId,
        season,
        teamId,
        espnS2,
        swid,
        signal: controller.signal,
      });
      if (attempt !== importAttempt) return;
      if (!isLeagueData(league)) {
        throw new Error("The imported league has no usable category data.");
      }
      let sourceWarning = "";
      if (sourceClient.hasSourceEndpoint) {
        elements.espnStatus.textContent =
          "ESPN connected. Adding licensed projections and news...";
        try {
          league = await sourceClient.enrichLeague({
            league,
            signal: controller.signal,
          });
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          sourceWarning =
            error instanceof Error
              ? error.message
              : "External evidence could not be refreshed.";
        }
      }
      if (attempt !== importAttempt) return;
      state.data = league;
      state.teamId = String(league.activeTeamId);
      state.teamStrategies = strategiesForLeague(league);
      state.lab.partnerTeamId = null;
      state.lab.sending.clear();
      state.lab.receiving.clear();
      resetPlayerSearches();
      renderAll();
      window.localStorage.setItem(LEAGUE_STORAGE_KEY, JSON.stringify(league));
      elements.espnStatus.className = "form-status is-success";
      elements.espnStatus.textContent = `Imported ${league.teams.length} teams and ${
        league.players.length
      } players.${sourceWarning ? ` ${sourceWarning}` : ""}`;
      window.setTimeout(() => {
        if (attempt !== importAttempt) return;
        if (elements.espnDialog.open) elements.espnDialog.close();
        showToast(
          sourceWarning
            ? `${league.league.name} imported, but licensed evidence was unavailable.`
            : league.teamSelectionRequired
            ? `${league.league.name} imported. Choose your team in the lower-left menu.`
            : `${league.league.name} is now connected.`
        );
      }, 550);
    } catch (error) {
      if (
        attempt !== importAttempt ||
        (error && error.name === "AbortError")
      ) {
        return;
      }
      const message =
        error instanceof Error ? error.message : "The ESPN import failed.";
      if (
        visibility === "public" &&
        error?.code === "PRIVATE_LEAGUE" &&
        espnClient.hasImportRelay
      ) {
        setLeagueVisibility("private", { focus: true });
        elements.espnStatus.className = "form-status is-error";
        elements.espnStatus.textContent =
          "Private league detected. Paste your ESPN session values to continue.";
      } else if (error?.code === "PRIVATE_LEAGUE") {
        elements.espnStatus.className = "form-status is-error";
        elements.espnStatus.textContent =
          "This league is private, but the secure import relay is not deployed here.";
      } else {
        elements.espnStatus.className = "form-status is-error";
        elements.espnStatus.textContent = message;
      }
    } finally {
      clearEspnCredentials();
      if (attempt === importAttempt) {
        activeImportController = null;
        setImportBusy(false);
      }
    }
  }

  async function refreshSources(options = {}) {
    if (
      !sourceClient.hasSourceEndpoint ||
      state.data.mode === "demo" ||
      !isLeagueData(state.data)
    ) {
      if (!options.quiet) {
        showToast("A licensed evidence endpoint is not configured here.");
      }
      return;
    }
    if (activeSourceController) activeSourceController.abort();
    const attempt = ++sourceRefreshAttempt;
    const leagueId = String(state.data.league.id);
    const controller = new AbortController();
    activeSourceController = controller;
    elements.refreshSourcesButton.disabled = true;
    elements.refreshSourcesButton.textContent = "Refreshing...";
    try {
      const enriched = await sourceClient.enrichLeague({
        league: state.data,
        signal: controller.signal,
      });
      if (
        attempt !== sourceRefreshAttempt ||
        String(state.data.league.id) !== leagueId
      ) {
        return;
      }
      state.data = enriched;
      window.localStorage.setItem(LEAGUE_STORAGE_KEY, JSON.stringify(enriched));
      renderAll();
      if (!options.quiet) {
        showToast(
          `Evidence refreshed for ${enriched.sourceSnapshot.matchedPlayers} players.`
        );
      }
    } catch (error) {
      if (
        attempt !== sourceRefreshAttempt ||
        error?.name === "AbortError"
      ) {
        return;
      }
      if (!options.quiet) {
        showToast(
          error instanceof Error
            ? error.message
            : "External evidence could not be refreshed."
        );
      }
    } finally {
      if (attempt === sourceRefreshAttempt) {
        activeSourceController = null;
        elements.refreshSourcesButton.disabled = false;
        elements.refreshSourcesButton.textContent = "Refresh evidence";
      }
    }
  }

  function resetDemo() {
    sourceRefreshAttempt += 1;
    if (activeSourceController) {
      activeSourceController.abort();
      activeSourceController = null;
    }
    window.localStorage.removeItem(LEAGUE_STORAGE_KEY);
    state.data = demoData;
    state.teamId = String(demoData.activeTeamId);
    state.teamStrategies = strategiesForLeague(demoData);
    state.lab.partnerTeamId = null;
    state.lab.sending.clear();
    state.lab.receiving.clear();
    resetPlayerSearches();
    renderAll();
    showToast("Demo league restored.");
  }

  function switchTeam(teamId) {
    const nextTeam = teamById(teamId);
    if (!nextTeam || String(nextTeam.id) === String(state.teamId)) return;

    state.teamId = String(nextTeam.id);
    if (state.data.mode === "espn") {
      state.data = {
        ...state.data,
        activeTeamId: state.teamId,
        teamSelectionRequired: false,
      };
    }
    state.lab.partnerTeamId = null;
    state.lab.sending.clear();
    state.lab.receiving.clear();
    resetPlayerSearches();
    if (state.data.mode === "espn") {
      try {
        window.localStorage.setItem(
          LEAGUE_STORAGE_KEY,
          JSON.stringify(state.data)
        );
      } catch (error) {
        showToast("The team changed, but this browser could not save the choice.");
      }
    }
    renderAll();
    setSidebarOpen(false, { restoreFocus: true });
    showToast(`Now analyzing ${nextTeam.name}.`);
  }

  function toggleWatch(playerId) {
    const key = String(playerId);
    const player = playerById(key);
    if (!player) return;
    if (state.watchlist.has(key)) {
      state.watchlist.delete(key);
      showToast(`${player.name} removed from your watchlist.`);
    } else {
      state.watchlist.add(key);
      showToast(`${player.name} added to your watchlist.`);
    }
    try {
      window.localStorage.setItem(
        WATCHLIST_STORAGE_KEY,
        JSON.stringify([...state.watchlist])
      );
    } catch (error) {
      showToast("The watchlist changed, but this browser could not save it.");
    }
    renderMarket();
    window.requestAnimationFrame(() => {
      [...elements.marketTableBody.querySelectorAll("[data-player-id]")]
        .find((button) => button.dataset.playerId === key)
        ?.focus();
    });
  }

  document.addEventListener("click", (event) => {
    const routeTarget = event.target.closest("[data-route]");
    if (routeTarget) {
      activateRoute(routeTarget.dataset.route, { focus: true });
      return;
    }

    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;

    if (action === "open-espn") openEspnDialog();
    else if (action === "close-espn") closeEspnDialog();
    else if (action === "trade-details") {
      openTradeDetails(actionTarget.dataset.opportunityId);
    } else if (action === "close-trade") {
      elements.tradeDialog.close();
    } else if (action === "use-opportunity") {
      useOpportunity(actionTarget.dataset.opportunityId);
    } else if (action === "save-opportunity") {
      saveOpportunity(actionTarget.dataset.opportunityId);
    } else if (action === "save-current-trade") {
      saveCurrentTrade();
    } else if (action === "load-saved-trade") {
      loadSavedTrade(actionTarget.dataset.savedId);
    } else if (action === "delete-saved-trade") {
      deleteSavedTrade(actionTarget.dataset.savedId);
    } else if (action === "toggle-player") {
      toggleLabPlayer(actionTarget.dataset.side, actionTarget.dataset.playerId);
    } else if (action === "toggle-watch") {
      toggleWatch(actionTarget.dataset.playerId);
    } else if (action === "reset-demo") {
      resetDemo();
    } else if (action === "refresh-sources") {
      refreshSources();
    } else if (action === "show-all-trades") {
      state.finder.realisticOnly = false;
      elements.finderRealistic.checked = false;
      renderFinder();
    } else if (action === "clear-finder-search") {
      state.finder.query = "";
      elements.finderPlayerSearch.value = "";
      renderFinder();
      elements.finderPlayerSearch.focus();
    }
  });

  document.addEventListener("change", (event) => {
    const planControl = event.target.closest(
      '[data-action="category-plan"]'
    );
    if (!planControl) return;
    setCategoryPlan(planControl.dataset.categoryId, planControl.value);
  });

  elements.menuButton.addEventListener("click", () => {
    const opening = !elements.sidebar.classList.contains("is-open");
    setSidebarOpen(opening, { restoreFocus: !opening });
  });
  elements.sidebarScrim.addEventListener("click", () =>
    setSidebarOpen(false, { restoreFocus: true })
  );
  elements.teamSwitcher.addEventListener("change", () => {
    switchTeam(elements.teamSwitcher.value);
  });
  elements.finderPlayerSearch.addEventListener("input", () => {
    state.finder.query = elements.finderPlayerSearch.value;
    renderFinder();
  });
  elements.finderStrategy.addEventListener("change", () => {
    state.finder.strategy = elements.finderStrategy.value;
    renderFinder();
  });
  elements.finderPosition.addEventListener("change", () => {
    state.finder.position = elements.finderPosition.value;
    renderFinder();
  });
  elements.finderCategory.addEventListener("change", () => {
    state.finder.category = elements.finderCategory.value;
    renderFinder();
  });
  elements.finderRealistic.addEventListener("change", () => {
    state.finder.realisticOnly = elements.finderRealistic.checked;
    renderFinder();
  });
  elements.labPartnerSelect.addEventListener("change", () => {
    state.lab.partnerTeamId = elements.labPartnerSelect.value;
    state.lab.receiving.clear();
    state.lab.receiveQuery = "";
    elements.receivePlayerSearch.value = "";
    renderLab();
  });
  elements.sendPlayerSearch.addEventListener("input", () => {
    state.lab.sendQuery = elements.sendPlayerSearch.value;
    renderLab();
  });
  elements.receivePlayerSearch.addEventListener("input", () => {
    state.lab.receiveQuery = elements.receivePlayerSearch.value;
    renderLab();
  });
  elements.clearTradeButton.addEventListener("click", () => {
    state.lab.sending.clear();
    state.lab.receiving.clear();
    renderLab();
  });
  elements.marketSearch.addEventListener("input", () => {
    state.market.query = elements.marketSearch.value;
    renderMarket();
  });
  elements.marketType.addEventListener("change", () => {
    state.market.type = elements.marketType.value;
    renderMarket();
  });
  elements.marketSort.addEventListener("change", () => {
    state.market.sort = elements.marketSort.value;
    renderMarket();
  });
  elements.leagueVisibilityOptions.forEach((option) => {
    option.addEventListener("change", () => {
      if (!option.checked) return;
      elements.espnStatus.className = "form-status";
      elements.espnStatus.textContent = "";
      setLeagueVisibility(option.value);
    });
  });
  elements.espnLeagueId.addEventListener("input", applyEspnReferenceDetails);
  elements.espnS2.addEventListener("input", () => {
    elements.espnS2.setCustomValidity("");
  });
  elements.espnSwid.addEventListener("input", () => {
    elements.espnSwid.setCustomValidity("");
  });
  elements.espnForm.addEventListener("submit", importEspnLeague);

  [elements.espnDialog, elements.tradeDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      if (dialog === elements.espnDialog) closeEspnDialog();
      else dialog.close();
    });
  });
  elements.espnDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeEspnDialog();
  });
  elements.espnDialog.addEventListener("close", () => {
    if (activeImportController) {
      activeImportController.abort();
      activeImportController = null;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (!elements.sidebar.classList.contains("is-open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setSidebarOpen(false, { restoreFocus: true });
      return;
    }
    if (event.key === "Tab") {
      const focusable = [
        ...elements.sidebar.querySelectorAll(
          'a[href], button:not([disabled]), select:not([disabled])'
        ),
      ].filter((item) => item.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  window.addEventListener("resize", () => {
    if (!window.matchMedia("(max-width: 760px)").matches) setSidebarOpen(false);
  });
  window.addEventListener("hashchange", () => {
    activateRoute(initialRoute(), { fromHash: true });
  });

  try {
    renderAll();
    if (sourceClient.hasSourceEndpoint && state.data.mode !== "demo") {
      window.setTimeout(() => refreshSources({ quiet: true }), 0);
    }
  } catch (error) {
    console.error(error);
    document.getElementById("main-content").innerHTML = `
      <div class="empty-list">
        <h3>RosterLab could not analyze this league</h3>
        <p>${escapeHtml(
          error instanceof Error ? error.message : "The league data is not readable."
        )}</p>
        <button class="button button-secondary" type="button" data-action="reset-demo">
          Restore demo league
        </button>
      </div>
    `;
  }
})();
