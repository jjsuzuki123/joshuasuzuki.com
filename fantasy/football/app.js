(function initFootballApp() {
  "use strict";

  const data = window.FootballData;
  const valueApi = window.FootballValue;
  const tradeApi = window.FootballTrade;

  if (!data || !valueApi || !tradeApi) {
    console.error("Football modules failed to load");
    return;
  }

  const state = {
    settings: Object.assign({}, data.defaultSettings),
    sideA: [],
    sideB: [],
    rated: null,
    filter: "",
  };

  const els = {
    leagueSize: document.getElementById("setting-league-size"),
    ppr: document.getElementById("setting-ppr"),
    superflex: document.getElementById("setting-superflex"),
    tep: document.getElementById("setting-tep"),
    searchA: document.getElementById("search-a"),
    searchB: document.getElementById("search-b"),
    suggestionsA: document.getElementById("suggestions-a"),
    suggestionsB: document.getElementById("suggestions-b"),
    listA: document.getElementById("side-a-list"),
    listB: document.getElementById("side-b-list"),
    noteA: document.getElementById("side-a-note"),
    noteB: document.getElementById("side-b-note"),
    adjA: document.getElementById("side-a-adjusted"),
    adjB: document.getElementById("side-b-adjusted"),
    rawA: document.getElementById("side-a-raw"),
    rawB: document.getElementById("side-b-raw"),
    summary: document.getElementById("trade-summary"),
    fairness: document.getElementById("fairness-score"),
    fairnessFill: document.getElementById("fairness-fill"),
    tradeNotes: document.getElementById("trade-notes"),
    rankingsBody: document.getElementById("rankings-body"),
    rankFilter: document.getElementById("rank-filter"),
    sourcesList: document.getElementById("sources-list"),
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function readSettings() {
    state.settings = {
      leagueSize: Number(els.leagueSize.value) || 12,
      ppr: Number(els.ppr.value),
      superflex: els.superflex.checked,
      tep: els.tep.checked,
    };
  }

  function recompute() {
    readSettings();
    state.rated = valueApi.ratePlayers(data.players, state.settings);
    renderRankings();
    renderTrade();
  }

  function valueById() {
    return valueApi.valueMap(state.rated);
  }

  function usedIds() {
    return new Set(
      state.sideA.concat(state.sideB).map(function (player) {
        return player.id;
      })
    );
  }

  function searchPlayers(queryText, limit) {
    const query = String(queryText || "").trim().toLowerCase();
    const taken = usedIds();
    const pool = (state.rated && state.rated.players) || [];
    return pool
      .filter(function (entry) {
        if (taken.has(entry.id)) return false;
        if (!query) return true;
        const haystack = (
          entry.player.name +
          " " +
          entry.player.proTeam +
          " " +
          entry.player.position
        ).toLowerCase();
        return haystack.indexOf(query) !== -1;
      })
      .slice(0, limit || 8);
  }

  function showSuggestions(side, queryText) {
    const list = side === "a" ? els.suggestionsA : els.suggestionsB;
    const matches = searchPlayers(queryText, 8);
    if (!String(queryText || "").trim() || !matches.length) {
      list.hidden = true;
      list.innerHTML = "";
      return;
    }
    list.hidden = false;
    list.innerHTML = matches
      .map(function (entry) {
        return (
          '<li><button type="button" data-id="' +
          escapeHtml(entry.id) +
          '">' +
          escapeHtml(entry.player.name) +
          ' <span class="meta">' +
          escapeHtml(entry.player.position) +
          " · " +
          escapeHtml(entry.player.proTeam) +
          " · " +
          entry.value +
          "</span></button></li>"
        );
      })
      .join("");
  }

  function addPlayer(side, playerId) {
    const rating = valueApi.getPlayerRating(state.rated, playerId);
    if (!rating) return;
    if (usedIds().has(playerId)) return;
    if (side === "a") {
      state.sideA.push(rating.player);
      els.searchA.value = "";
      els.suggestionsA.hidden = true;
    } else {
      state.sideB.push(rating.player);
      els.searchB.value = "";
      els.suggestionsB.hidden = true;
    }
    renderTrade();
  }

  function removePlayer(side, playerId) {
    if (side === "a") {
      state.sideA = state.sideA.filter(function (player) {
        return player.id !== playerId;
      });
    } else {
      state.sideB = state.sideB.filter(function (player) {
        return player.id !== playerId;
      });
    }
    renderTrade();
  }

  function renderSideList(side) {
    const players = side === "a" ? state.sideA : state.sideB;
    const list = side === "a" ? els.listA : els.listB;
    const map = valueById();
    if (!players.length) {
      list.innerHTML =
        '<li class="slot-note" style="list-style:none;border:0;padding:0.25rem 0">No players yet</li>';
      return;
    }
    list.innerHTML = players
      .map(function (player) {
        return (
          '<li class="player-chip">' +
          "<div><strong>" +
          escapeHtml(player.name) +
          '</strong><div class="meta">' +
          escapeHtml(player.position) +
          " · " +
          escapeHtml(player.proTeam) +
          " · " +
          (map[player.id] || "—") +
          '</div></div><button type="button" data-remove="' +
          escapeHtml(player.id) +
          '" aria-label="Remove ' +
          escapeHtml(player.name) +
          '">×</button></li>'
        );
      })
      .join("");
  }

  function renderTrade() {
    renderSideList("a");
    renderSideList("b");

    if (!state.sideA.length && !state.sideB.length) {
      els.adjA.textContent = "0";
      els.adjB.textContent = "0";
      els.rawA.textContent = "0";
      els.rawB.textContent = "0";
      els.summary.textContent = "Add players to both sides to evaluate a trade.";
      els.summary.className = "verdict";
      els.fairness.textContent = "—";
      els.fairnessFill.style.width = "0%";
      els.noteA.textContent = "";
      els.noteB.textContent = "";
      els.tradeNotes.innerHTML = "";
      return;
    }

    const evaluation = tradeApi.evaluateTrade({
      sideA: state.sideA,
      sideB: state.sideB,
      valueById: valueById(),
      slotCost: valueApi.marginalSlotCost(state.rated),
    });

    els.adjA.textContent = String(evaluation.sideA.adjusted);
    els.adjB.textContent = String(evaluation.sideB.adjusted);
    els.rawA.textContent = String(evaluation.sideA.raw);
    els.rawB.textContent = String(evaluation.sideB.raw);
    els.noteA.textContent =
      evaluation.sideA.slotLabel === "even"
        ? ""
        : evaluation.sideA.slotLabel +
          " (" +
          (evaluation.sideA.slotAdjustment > 0 ? "+" : "") +
          evaluation.sideA.slotAdjustment +
          ")";
    els.noteB.textContent =
      evaluation.sideB.slotLabel === "even"
        ? ""
        : evaluation.sideB.slotLabel +
          " (" +
          (evaluation.sideB.slotAdjustment > 0 ? "+" : "") +
          evaluation.sideB.slotAdjustment +
          ")";
    els.summary.textContent = evaluation.summary;
    els.summary.className =
      "verdict " +
      (evaluation.winner === "a"
        ? "is-a"
        : evaluation.winner === "b"
          ? "is-b"
          : "is-even");
    els.fairness.textContent = evaluation.fairness + "%";
    els.fairnessFill.style.width = evaluation.fairness + "%";
    els.tradeNotes.innerHTML = evaluation.notes
      .map(function (note) {
        return "<li>" + escapeHtml(note) + "</li>";
      })
      .join("");
  }

  function renderRankings() {
    const query = String(state.filter || "").trim().toLowerCase();
    const rows = ((state.rated && state.rated.players) || []).filter(function (entry) {
      if (!query) return true;
      const haystack = (
        entry.player.name +
        " " +
        entry.player.proTeam +
        " " +
        entry.player.position
      ).toLowerCase();
      return haystack.indexOf(query) !== -1;
    });

    els.rankingsBody.innerHTML = rows
      .map(function (entry, index) {
        return (
          "<tr><td>" +
          (index + 1) +
          "</td><td>" +
          escapeHtml(entry.player.name) +
          "</td><td>" +
          escapeHtml(entry.player.position) +
          "</td><td>" +
          escapeHtml(entry.player.proTeam) +
          "</td><td><strong>" +
          entry.value +
          "</strong></td><td>" +
          entry.projectedPoints +
          "</td></tr>"
        );
      })
      .join("");
  }

  function renderSources() {
    els.sourcesList.innerHTML = (data.sources || [])
      .map(function (source) {
        return (
          "<li><strong>" +
          escapeHtml(source.name) +
          "</strong> — " +
          escapeHtml(source.note || source.kind) +
          "</li>"
        );
      })
      .join("");
  }

  function bind() {
    els.leagueSize.addEventListener("change", recompute);
    els.ppr.addEventListener("change", recompute);
    els.superflex.addEventListener("change", recompute);
    els.tep.addEventListener("change", recompute);

    els.searchA.addEventListener("input", function () {
      showSuggestions("a", els.searchA.value);
    });
    els.searchB.addEventListener("input", function () {
      showSuggestions("b", els.searchB.value);
    });

    els.suggestionsA.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-id]");
      if (!button) return;
      addPlayer("a", button.getAttribute("data-id"));
    });
    els.suggestionsB.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-id]");
      if (!button) return;
      addPlayer("b", button.getAttribute("data-id"));
    });

    els.listA.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-remove]");
      if (!button) return;
      removePlayer("a", button.getAttribute("data-remove"));
    });
    els.listB.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-remove]");
      if (!button) return;
      removePlayer("b", button.getAttribute("data-remove"));
    });

    els.rankFilter.addEventListener("input", function () {
      state.filter = els.rankFilter.value;
      renderRankings();
    });

    document.addEventListener("click", function (event) {
      if (!event.target.closest(".player-search")) {
        els.suggestionsA.hidden = true;
        els.suggestionsB.hidden = true;
      }
    });
  }

  bind();
  renderSources();
  recompute();
})();
