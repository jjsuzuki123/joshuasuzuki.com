(function initEspnClient(root, factory) {
  const api = factory(root.RosterLabConfig || {});

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.EspnFantasyClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createEspnClient(config) {
  "use strict";

  const ESPN_BASE =
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb";
  const IMPORT_ENDPOINT =
    typeof config.importEndpoint === "string"
      ? config.importEndpoint.trim()
      : "";
  const LINEUP_POSITION_BY_ID = {
    0: "C",
    1: "1B",
    2: "2B",
    3: "3B",
    4: "SS",
    5: "OF",
    6: "MI",
    7: "CI",
    8: "LF",
    9: "CF",
    10: "RF",
    11: "DH",
    12: "UTIL",
    13: "P",
    14: "SP",
    15: "RP",
    16: "BE",
    17: "IL",
    19: "IF",
  };
  const DEFAULT_POSITION_BY_ID = {
    1: "SP",
    2: "C",
    3: "1B",
    4: "2B",
    5: "3B",
    6: "SS",
    7: "LF",
    8: "CF",
    9: "RF",
    10: "DH",
    11: "RP",
  };
  const PRO_TEAM_BY_ID = {
    0: "FA",
    1: "BAL",
    2: "BOS",
    3: "LAA",
    4: "CWS",
    5: "CLE",
    6: "DET",
    7: "KC",
    8: "MIL",
    9: "MIN",
    10: "NYY",
    11: "ATH",
    12: "SEA",
    13: "TEX",
    14: "TOR",
    15: "ATL",
    16: "CHC",
    17: "CIN",
    18: "HOU",
    19: "LAD",
    20: "WSH",
    21: "NYM",
    22: "PHI",
    23: "PIT",
    24: "STL",
    25: "SD",
    26: "SF",
    27: "COL",
    28: "MIA",
    29: "ARI",
    30: "TB",
  };
  const TEAM_COLORS = [
    "#1f6f5f",
    "#c96e32",
    "#5266a7",
    "#9b4f62",
    "#735996",
    "#357099",
    "#886e2f",
    "#397b73",
    "#795548",
    "#59636f",
  ];
  const CATEGORIES = [
    { id: "runs", label: "R", name: "Runs", group: "batting", aggregation: "count" },
    { id: "homeRuns", label: "HR", name: "Home runs", group: "batting", aggregation: "count" },
    { id: "rbi", label: "RBI", name: "Runs batted in", group: "batting", aggregation: "count" },
    { id: "stolenBases", label: "SB", name: "Stolen bases", group: "batting", aggregation: "count" },
    { id: "average", label: "AVG", name: "Batting average", group: "batting", aggregation: "rate" },
    { id: "wins", label: "W", name: "Wins", group: "pitching", aggregation: "count" },
    { id: "saves", label: "SV", name: "Saves", group: "pitching", aggregation: "count" },
    { id: "strikeouts", label: "K", name: "Strikeouts", group: "pitching", aggregation: "count" },
    { id: "era", label: "ERA", name: "Earned run average", group: "pitching", aggregation: "rate" },
    { id: "whip", label: "WHIP", name: "Walks and hits per inning", group: "pitching", aggregation: "rate" },
  ];
  const SUPPORTED_STAT_IDS = new Set([2, 5, 20, 21, 23, 41, 47, 48, 53, 57]);

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function numeric(value) {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : null;
  }

  function buildLeagueUrl({ leagueId, season }) {
    if (!/^\d+$/.test(String(leagueId || ""))) {
      throw new Error("League ID must contain numbers only.");
    }
    if (!/^\d{4}$/.test(String(season || ""))) {
      throw new Error("Season must be a four-digit year.");
    }

    const url = new URL(
      `${ESPN_BASE}/seasons/${season}/segments/0/leagues/${leagueId}`
    );
    ["mTeam", "mRoster", "mSettings", "mStandings"].forEach((view) => {
      url.searchParams.append("view", view);
    });
    return url;
  }

  function parseLeagueReference(reference) {
    const input = String(reference || "").trim().replaceAll("&amp;", "&");
    if (/^\d+$/.test(input)) {
      return { leagueId: input, season: null, teamId: null };
    }

    const candidate = /^(?:(?:fantasy|www)\.)?espn\.com\//i.test(input)
      ? `https://${input}`
      : input;
    let url;
    try {
      url = new URL(candidate);
    } catch (error) {
      throw new Error("Paste an ESPN league URL or enter its numeric league ID.");
    }

    const hashParameters = url.hash.includes("?")
      ? new URLSearchParams(url.hash.slice(url.hash.indexOf("?") + 1))
      : new URLSearchParams();
    const parameter = (name) =>
      url.searchParams.get(name) || hashParameters.get(name);
    const pathLeagueId =
      url.pathname.match(/\/leagues?\/(\d+)(?:\/|$)/i)?.[1] || null;
    const pathSeason =
      url.pathname.match(/\/seasons\/(\d{4})(?:\/|$)/i)?.[1] || null;
    const leagueId = parameter("leagueId") || pathLeagueId;
    const season = parameter("seasonId") || parameter("season") || pathSeason;
    const teamId = parameter("teamId");

    if (!leagueId || !/^\d+$/.test(leagueId)) {
      throw new Error("This URL does not contain a readable ESPN league ID.");
    }

    return {
      leagueId,
      season: season && /^\d{4}$/.test(season) ? season : null,
      teamId: teamId && /^\d+$/.test(teamId) ? teamId : null,
    };
  }

  function initials(name) {
    return String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  function teamName(team) {
    if (team.name) return team.name;
    const combined = [team.location, team.nickname].filter(Boolean).join(" ");
    return combined || `Team ${team.id}`;
  }

  function teamRecord(team) {
    const overall = team.record && team.record.overall;
    if (!overall) return "Imported";
    const wins = numeric(overall.wins) || 0;
    const losses = numeric(overall.losses) || 0;
    const ties = numeric(overall.ties) || 0;
    return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  }

  function projectionStats(player) {
    if (!Array.isArray(player.stats)) return {};
    const candidates = player.stats.filter(
      (entry) => entry && (entry.stats || entry.appliedStats)
    );
    if (candidates.length === 0) return {};

    const preferred = candidates.find(
      (entry) => entry.statSourceId === 1 && entry.statSplitTypeId === 0
    );
    return preferred
      ? preferred.stats || preferred.appliedStats || {}
      : {};
  }

  function stat(stats, id) {
    return numeric(stats[id]) ?? numeric(stats[String(id)]);
  }

  function scale(value, low, high) {
    if (!Number.isFinite(value)) return null;
    return clamp(Math.round(((value - low) / (high - low)) * 100), 1, 100);
  }

  function invertScale(value, best, worst) {
    if (!Number.isFinite(value)) return null;
    return clamp(Math.round(((worst - value) / (worst - best)) * 100), 1, 100);
  }

  function hashNumber(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash);
  }

  function jitter(seed, index, range) {
    const shifted = (seed >>> ((index % 4) * 7)) & 255;
    return Math.round((shifted / 255 - 0.5) * range * 2);
  }

  function playerRank(player) {
    const rankGroups = player.draftRanksByRankType
      ? Object.values(player.draftRanksByRankType)
      : [];
    const ranks = rankGroups
      .map((group) => numeric(group && (group.overallRank || group.rank)))
      .filter(Number.isFinite);
    return ranks.length > 0 ? Math.min(...ranks) : null;
  }

  function marketValue(player) {
    const rank = playerRank(player);
    const owned = numeric(player.ownership && player.ownership.percentOwned);
    const rankValue =
      rank === null ? null : clamp(Math.round(101 - Math.log2(rank + 1) * 12), 12, 99);

    if (rankValue !== null && owned !== null) {
      return clamp(Math.round(rankValue * 0.68 + owned * 0.32), 8, 99);
    }
    if (rankValue !== null) return rankValue;
    if (owned !== null) return clamp(Math.round(owned), 8, 99);
    return 40;
  }

  function positionsFor(player) {
    const positions = (Array.isArray(player.eligibleSlots)
      ? player.eligibleSlots
      : []
    )
      .map((id) => LINEUP_POSITION_BY_ID[id])
      .filter(Boolean)
      .filter(
        (position) =>
          position !== "P" &&
          position !== "BE" &&
          position !== "IL" &&
          position !== "UTIL" &&
          position !== "IF"
      );
    const naturalPosition = DEFAULT_POSITION_BY_ID[player.defaultPositionId];
    if (positions.length === 0 && naturalPosition) positions.push(naturalPosition);
    return [...new Set(positions)].slice(0, 3);
  }

  function isPitcher(player, positions) {
    return (
      positions.includes("SP") ||
      positions.includes("RP") ||
      player.defaultPositionId === 1 ||
      player.defaultPositionId === 11
    );
  }

  function fillScores(partialScores, baseValue, seed, type, positions) {
    const result = {};
    const categoryIds =
      type === "pitcher"
        ? ["wins", "saves", "strikeouts", "era", "whip"]
        : ["runs", "homeRuns", "rbi", "stolenBases", "average"];

    categoryIds.forEach((categoryId, index) => {
      const provided = partialScores[categoryId];
      let fallback = clamp(baseValue + jitter(seed, index, 22), 10, 98);
      if (type === "pitcher" && categoryId === "saves") {
        fallback = positions.includes("RP")
          ? clamp(baseValue + jitter(seed, index, 18), 18, 98)
          : clamp(8 + jitter(seed, index, 7), 1, 20);
      }
      if (
        type === "pitcher" &&
        categoryId === "wins" &&
        positions.includes("RP")
      ) {
        fallback = clamp(18 + jitter(seed, index, 10), 4, 35);
      }
      result[categoryId] = Number.isFinite(provided) ? provided : fallback;
    });
    return result;
  }

  function projectionLabel(type, stats, rank, ownership) {
    if (type === "hitter") {
      const runs = stat(stats, 20);
      const homeRuns = stat(stats, 5);
      const runsBattedIn = stat(stats, 21);
      const stolenBases = stat(stats, 23);
      if ([runs, homeRuns, runsBattedIn, stolenBases].some(Number.isFinite)) {
        return [
          Number.isFinite(runs) ? `${Math.round(runs)} R` : null,
          Number.isFinite(homeRuns) ? `${Math.round(homeRuns)} HR` : null,
          Number.isFinite(runsBattedIn) ? `${Math.round(runsBattedIn)} RBI` : null,
          Number.isFinite(stolenBases) ? `${Math.round(stolenBases)} SB` : null,
        ]
          .filter(Boolean)
          .join(" · ");
      }
    } else {
      const wins = stat(stats, 53);
      const saves = stat(stats, 57);
      const strikeouts = stat(stats, 48);
      const era = stat(stats, 47);
      if ([wins, saves, strikeouts, era].some(Number.isFinite)) {
        return [
          Number.isFinite(wins) ? `${Math.round(wins)} W` : null,
          Number.isFinite(saves) && saves > 0 ? `${Math.round(saves)} SV` : null,
          Number.isFinite(strikeouts) ? `${Math.round(strikeouts)} K` : null,
          Number.isFinite(era) ? `${era.toFixed(2)} ERA` : null,
        ]
          .filter(Boolean)
          .join(" · ");
      }
    }

    return [
      Number.isFinite(rank) ? `ESPN rank #${Math.round(rank)}` : null,
      Number.isFinite(ownership) ? `${Math.round(ownership)}% rostered` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Imported from ESPN";
  }

  function parsePlayer(entry, ownerTeamId) {
    const poolEntry = entry.playerPoolEntry || {};
    const raw = poolEntry.player || {};
    const positions = positionsFor(raw);
    const type = isPitcher(raw, positions) ? "pitcher" : "hitter";
    const value = marketValue(raw);
    const stats = projectionStats(raw);
    const seed = hashNumber(raw.id || raw.fullName);
    const ownership = numeric(raw.ownership && raw.ownership.percentOwned);
    const trend =
      numeric(raw.ownership && raw.ownership.percentChange) ?? 0;
    const rank = playerRank(raw);
    const partialScores =
      type === "pitcher"
        ? {
            wins: scale(stat(stats, 53), 1, 18),
            saves: scale(stat(stats, 57), 0, 45),
            strikeouts: scale(stat(stats, 48), 35, 260),
            era: invertScale(stat(stats, 47), 2.1, 5.3),
            whip: invertScale(stat(stats, 41), 0.9, 1.55),
          }
        : {
            runs: scale(stat(stats, 20), 25, 115),
            homeRuns: scale(stat(stats, 5), 3, 48),
            rbi: scale(stat(stats, 21), 25, 125),
            stolenBases: scale(stat(stats, 23), 0, 50),
            average: scale(stat(stats, 2), 0.21, 0.325),
          };
    const scores = fillScores(partialScores, value, seed, type, positions);
    const skillAverage =
      Object.values(scores).reduce((total, score) => total + score, 0) /
      Object.values(scores).length;
    const rawStatus = String(raw.injuryStatus || "ACTIVE").replaceAll("_", " ");

    return {
      id: String(raw.id || `${ownerTeamId}-${seed}`),
      name: raw.fullName || raw.displayName || "Unknown player",
      mlbTeam: PRO_TEAM_BY_ID[raw.proTeamId] || "FA",
      positions: positions.length > 0 ? positions : [type === "pitcher" ? "SP" : "UTIL"],
      ownerTeamId,
      type,
      marketValue: value,
      trend: clamp(Math.round(trend * 10) / 10, -12, 12),
      ownership: ownership === null ? value : Math.round(ownership),
      status: rawStatus === "ACTIVE" ? "Healthy" : rawStatus,
      projection: projectionLabel(type, stats, rank, ownership),
      scores,
      rateWeight:
        type === "pitcher"
          ? stat(stats, 34) || clamp(Math.round(230 + value * 3.2), 260, 560)
          : stat(stats, 0) || clamp(Math.round(430 + value * 1.8), 450, 620),
      signals: {
        projection: clamp(Math.round(value + jitter(seed, 5, 6)), 1, 99),
        underlying: clamp(Math.round(skillAverage), 1, 99),
        consensus: clamp(Math.round(value + jitter(seed, 6, 5)), 1, 99),
      },
      news: null,
    };
  }

  function validateScoringSettings(scoringSettings) {
    const scoringType = String(scoringSettings.scoringType || "").toUpperCase();
    if (!["ROTO", "H2H_CATEGORY"].includes(scoringType)) {
      throw new Error(
        "RosterLab currently supports standard 5x5 category leagues, not ESPN points leagues."
      );
    }

    const scoringItems = Array.isArray(scoringSettings.scoringItems)
      ? scoringSettings.scoringItems
      : [];
    if (scoringItems.length === 0) return scoringType;

    const configuredIds = new Set(
      scoringItems
        .map((item) => numeric(item && item.statId))
        .filter(Number.isFinite)
    );
    const hasEverySupportedCategory = [...SUPPORTED_STAT_IDS].every((statId) =>
      configuredIds.has(statId)
    );
    const hasUnsupportedCategory = [...configuredIds].some(
      (statId) => !SUPPORTED_STAT_IDS.has(statId)
    );
    if (!hasEverySupportedCategory || hasUnsupportedCategory) {
      throw new Error(
        "This league uses custom categories. RosterLab currently supports standard 5x5 scoring only."
      );
    }

    return scoringType;
  }

  function parseLeague(payload, options) {
    if (!payload || !Array.isArray(payload.teams) || payload.teams.length < 2) {
      throw new Error("ESPN did not return a readable league with at least two teams.");
    }

    const scoringSettings =
      (payload.settings && payload.settings.scoringSettings) || {};
    const scoringType = validateScoringSettings(scoringSettings);
    const sortedRawTeams = [...payload.teams].sort((left, right) => {
      const leftSeed = numeric(left.playoffSeed) || 999;
      const rightSeed = numeric(right.playoffSeed) || 999;
      return leftSeed - rightSeed;
    });
    const teams = sortedRawTeams.map((team, index) => ({
      id: String(team.id),
      name: teamName(team),
      abbreviation: team.abbrev || initials(teamName(team)) || `T${team.id}`,
      manager: Array.isArray(team.owners) && team.owners.length > 0 ? "ESPN manager" : "Manager",
      standing: numeric(team.playoffSeed) || index + 1,
      record: teamRecord(team),
      color: TEAM_COLORS[index % TEAM_COLORS.length],
    }));
    const players = [];
    payload.teams.forEach((team) => {
      const entries =
        team.roster && Array.isArray(team.roster.entries)
          ? team.roster.entries
          : [];
      entries.forEach((entry) => {
        if (entry && entry.playerPoolEntry && entry.playerPoolEntry.player) {
          players.push(parsePlayer(entry, String(team.id)));
        }
      });
    });

    if (players.length === 0) {
      throw new Error("ESPN returned the league, but no roster entries were available.");
    }

    const requestedTeamId = String((options && options.teamId) || "");
    const hasRequestedTeam = teams.some((team) => team.id === requestedTeamId);
    const activeTeamId = hasRequestedTeam
      ? requestedTeamId
      : teams[0].id;
    const season =
      numeric(options && options.season) ||
      numeric(payload.seasonId) ||
      new Date().getFullYear();
    const leagueId =
      (options && options.leagueId) || payload.id || "espn-league";

    return {
      mode: "espn",
      activeTeamId,
      teamSelectionRequired: !hasRequestedTeam,
      league: {
        id: String(leagueId),
        name:
          (payload.settings && payload.settings.name) ||
          payload.name ||
          "ESPN fantasy baseball",
        season,
        size: teams.length,
        scoring: scoringType === "ROTO" ? "5x5 rotisserie" : "5x5 categories",
        sourceLabel: "ESPN league",
        updatedAt: new Date().toISOString(),
      },
      categories: CATEGORIES,
      teams,
      players,
      sources: [
        {
          id: "espn",
          name: "ESPN Fantasy",
          url: "https://www.espn.com/fantasy/baseball/",
          coverage: "League settings, rosters, standings, ownership",
          status: "connected",
          cadence: "Just synced",
        },
        {
          id: "fangraphs",
          name: "FanGraphs",
          url: "https://www.fangraphs.com/projections",
          coverage: "Rest-of-season projection signal",
          status: "disconnected",
          cadence: "Server adapter needed",
        },
        {
          id: "savant",
          name: "Baseball Savant",
          url: "https://baseballsavant.mlb.com/",
          coverage: "Expected outcomes and quality of contact",
          status: "disconnected",
          cadence: "Server adapter needed",
        },
        {
          id: "rotowire",
          name: "RotoWire",
          url: "https://www.rotowire.com/baseball/",
          coverage: "Injury, lineup, and role news",
          status: "disconnected",
          cadence: "Licensed feed needed",
        },
      ],
      model: {
        version: "0.1 ESPN import",
        weights: [
          { label: "ESPN projection or draft rank", value: 55 },
          { label: "League market and ownership", value: 35 },
          { label: "Role and availability", value: 10 },
        ],
      },
    };
  }

  async function fetchLeagueThroughRelay({
    leagueId,
    season,
    teamId,
    espnS2,
    swid,
    signal,
    timeout,
  }) {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = () => controller.abort(signal.reason);
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);

    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", abortFromParent, { once: true });
    }

    try {
      const response = await fetch(IMPORT_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leagueId,
          season,
          teamId: teamId || undefined,
          espnS2: espnS2 || undefined,
          swid: swid || undefined,
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.message === "string"
            ? body.message
            : `League import returned ${response.status}.`
        );
      }
      if (!body.payload) {
        throw new Error("The league import returned no ESPN data.");
      }
      return parseLeague(body.payload, { leagueId, season, teamId });
    } catch (error) {
      if (timedOut) {
        throw new Error("The league import timed out. Try again.");
      }
      if (error && error.name === "AbortError") throw error;
      if (error instanceof TypeError) {
        throw new Error("The secure league import service is unavailable.");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", abortFromParent);
    }
  }

  async function fetchLeagueDirect({
    leagueId,
    season,
    teamId,
    signal,
    timeout,
  }) {
    const url = buildLeagueUrl({ leagueId, season });
    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = () => controller.abort(signal.reason);
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);

    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", abortFromParent, { once: true });
    }

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "This league appears to be private. Choose Private league to connect it."
        );
      }
      if (!response.ok) {
        throw new Error(`ESPN returned ${response.status} for this league.`);
      }
      const payload = await response.json();
      return parseLeague(payload, { leagueId, season, teamId });
    } catch (error) {
      if (timedOut) {
        throw new Error("ESPN did not respond in time.");
      }
      if (error && error.name === "AbortError") throw error;
      if (error instanceof TypeError) {
        throw new Error(
          "ESPN blocked the browser request. A server-side connector is required for this league."
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", abortFromParent);
    }
  }

  async function fetchLeague({
    leagueId,
    season,
    teamId,
    espnS2,
    swid,
    signal,
    timeout = 12000,
  }) {
    if (IMPORT_ENDPOINT) {
      return fetchLeagueThroughRelay({
        leagueId,
        season,
        teamId,
        espnS2,
        swid,
        signal,
        timeout,
      });
    }
    if (espnS2 || swid) {
      throw new Error(
        "Private league import is not configured in this environment."
      );
    }
    return fetchLeagueDirect({
      leagueId,
      season,
      teamId,
      signal,
      timeout,
    });
  }

  return {
    buildLeagueUrl,
    fetchLeague,
    hasImportRelay: Boolean(IMPORT_ENDPOINT),
    parseLeagueReference,
    parseLeague,
  };
});
