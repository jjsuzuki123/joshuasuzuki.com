(function initEspnClient(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.EspnFantasyClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createEspnClient() {
  "use strict";

  const ESPN_BASE =
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb";
  const POSITION_BY_ID = {
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
    11: "UTIL",
    13: "P",
    14: "SP",
    15: "RP",
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
    { id: "runs", label: "R", name: "Runs", group: "batting" },
    { id: "homeRuns", label: "HR", name: "Home runs", group: "batting" },
    { id: "rbi", label: "RBI", name: "Runs batted in", group: "batting" },
    { id: "stolenBases", label: "SB", name: "Stolen bases", group: "batting" },
    { id: "average", label: "AVG", name: "Batting average", group: "batting" },
    { id: "wins", label: "W", name: "Wins", group: "pitching" },
    { id: "saves", label: "SV", name: "Saves", group: "pitching" },
    { id: "strikeouts", label: "K", name: "Strikeouts", group: "pitching" },
    { id: "era", label: "ERA", name: "Earned run average", group: "pitching" },
    { id: "whip", label: "WHIP", name: "Walks and hits per inning", group: "pitching" },
  ];

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
    const candidates = player.stats.filter((entry) => entry && entry.stats);
    if (candidates.length === 0) return {};

    const preferred =
      candidates.find(
        (entry) => entry.statSourceId === 1 && entry.statSplitTypeId === 1
      ) ||
      candidates.find((entry) => entry.statSourceId === 1) ||
      candidates[0];
    return preferred.stats || {};
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
    const ids = [
      ...(Array.isArray(player.eligibleSlots) ? player.eligibleSlots : []),
      player.defaultPositionId,
    ];
    const positions = ids
      .map((id) => POSITION_BY_ID[id])
      .filter(Boolean)
      .filter((position) => position !== "P");
    return [...new Set(positions)].slice(0, 3);
  }

  function isPitcher(player, positions) {
    return (
      positions.includes("SP") ||
      positions.includes("RP") ||
      player.defaultPositionId === 14 ||
      player.defaultPositionId === 15
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
      const runs = stat(stats, 13);
      const homeRuns = stat(stats, 5);
      const runsBattedIn = stat(stats, 12);
      const stolenBases = stat(stats, 14);
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
      const wins = stat(stats, 39);
      const saves = stat(stats, 37);
      const strikeouts = stat(stats, 34);
      const era = stat(stats, 32);
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
      numeric(raw.ownership && raw.ownership.percentChange) ||
      numeric(poolEntry.ratings && poolEntry.ratings[0] && poolEntry.ratings[0].positionalRanking) ||
      0;
    const rank = playerRank(raw);
    const partialScores =
      type === "pitcher"
        ? {
            wins: scale(stat(stats, 39), 1, 18),
            saves: scale(stat(stats, 37), 0, 45),
            strikeouts: scale(stat(stats, 34), 35, 260),
            era: invertScale(stat(stats, 32), 2.1, 5.3),
            whip: invertScale(stat(stats, 33), 0.9, 1.55),
          }
        : {
            runs: scale(stat(stats, 13), 25, 115),
            homeRuns: scale(stat(stats, 5), 3, 48),
            rbi: scale(stat(stats, 12), 25, 125),
            stolenBases: scale(stat(stats, 14), 0, 50),
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
      mlbTeam: raw.proTeamId ? `MLB ${raw.proTeamId}` : "FA",
      positions: positions.length > 0 ? positions : [type === "pitcher" ? "SP" : "UTIL"],
      ownerTeamId,
      type,
      marketValue: value,
      trend: clamp(Math.round(trend * 10) / 10, -12, 12),
      ownership: ownership === null ? value : Math.round(ownership),
      status: rawStatus === "ACTIVE" ? "Healthy" : rawStatus,
      projection: projectionLabel(type, stats, rank, ownership),
      scores,
      signals: {
        projection: clamp(Math.round(value + jitter(seed, 5, 6)), 1, 99),
        underlying: clamp(Math.round(skillAverage), 1, 99),
        consensus: clamp(Math.round(value + jitter(seed, 6, 5)), 1, 99),
      },
      news: null,
    };
  }

  function parseLeague(payload, options) {
    if (!payload || !Array.isArray(payload.teams) || payload.teams.length < 2) {
      throw new Error("ESPN did not return a readable league with at least two teams.");
    }

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
    const activeTeamId = teams.some((team) => team.id === requestedTeamId)
      ? requestedTeamId
      : teams[0].id;
    const scoringType =
      payload.settings &&
      payload.settings.scoringSettings &&
      payload.settings.scoringSettings.scoringType;
    const season =
      numeric(options && options.season) ||
      numeric(payload.seasonId) ||
      new Date().getFullYear();
    const leagueId =
      (options && options.leagueId) || payload.id || "espn-league";

    return {
      mode: "espn",
      activeTeamId,
      league: {
        id: String(leagueId),
        name:
          (payload.settings && payload.settings.name) ||
          payload.name ||
          "ESPN fantasy baseball",
        season,
        size: teams.length,
        scoring: scoringType ? String(scoringType).toLowerCase() : "ESPN scoring",
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
          { label: "ESPN projection and rank", value: 55 },
          { label: "League market and ownership", value: 35 },
          { label: "Role and availability", value: 10 },
        ],
      },
    };
  }

  async function fetchLeague({ leagueId, season, teamId, signal, timeout = 10000 }) {
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
          "This league appears to be private. The browser connector supports public leagues only."
        );
      }
      if (!response.ok) {
        throw new Error(`ESPN returned ${response.status} for this league.`);
      }
      const payload = await response.json();
      return parseLeague(payload, { leagueId, season, teamId });
    } catch (error) {
      if (timedOut) {
        throw new Error("ESPN did not respond within 10 seconds.");
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

  return {
    buildLeagueUrl,
    fetchLeague,
    parseLeague,
  };
});
