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

  class LeagueImportError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "LeagueImportError";
      this.code = code;
    }
  }
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
  const STAT_DEFINITION_DATA = {
    0: ["atBats", "AB", "At bats", "batting", "count", 200, 700, "higher"],
    1: ["hits", "H", "Hits", "batting", "count", 40, 220, "higher"],
    2: ["average", "AVG", "Batting average", "batting", "rate", 0.21, 0.325, "higher"],
    3: ["doubles", "2B", "Doubles", "batting", "count", 5, 50, "higher"],
    4: ["triples", "3B", "Triples", "batting", "count", 0, 15, "higher"],
    5: ["homeRuns", "HR", "Home runs", "batting", "count", 3, 48, "higher"],
    6: ["extraBaseHits", "XBH", "Extra-base hits", "batting", "count", 10, 100, "higher"],
    7: ["singles", "1B", "Singles", "batting", "count", 20, 160, "higher"],
    8: ["totalBases", "TB", "Total bases", "batting", "count", 80, 400, "higher"],
    9: ["slugging", "SLG", "Slugging percentage", "batting", "rate", 0.3, 0.65, "higher"],
    10: ["walks", "BB", "Walks", "batting", "count", 10, 130, "higher"],
    11: ["intentionalWalks", "IBB", "Intentional walks", "batting", "count", 0, 25, "higher"],
    12: ["hitByPitch", "HBP", "Hit by pitch", "batting", "count", 0, 30, "higher"],
    13: ["sacrificeFlies", "SF", "Sacrifice flies", "batting", "count", 0, 15, "higher"],
    14: ["sacrificeHits", "SH", "Sacrifice hits", "batting", "count", 0, 20, "higher"],
    15: ["sacrifices", "SAC", "Sacrifices", "batting", "count", 0, 25, "higher"],
    16: ["plateAppearances", "PA", "Plate appearances", "batting", "count", 250, 750, "higher"],
    17: ["onBasePercentage", "OBP", "On-base percentage", "batting", "rate", 0.25, 0.45, "higher"],
    18: ["ops", "OPS", "On-base plus slugging", "batting", "rate", 0.6, 1.1, "higher"],
    19: ["runsCreated", "RC", "Runs created", "batting", "count", 20, 140, "higher"],
    20: ["runs", "R", "Runs", "batting", "count", 25, 115, "higher"],
    21: ["rbi", "RBI", "Runs batted in", "batting", "count", 25, 125, "higher"],
    23: ["stolenBases", "SB", "Stolen bases", "batting", "count", 0, 50, "higher"],
    24: ["caughtStealing", "CS", "Caught stealing", "batting", "count", 0, 20, "lower"],
    25: ["netStolenBases", "SB-CS", "Net stolen bases", "batting", "count", -10, 50, "higher"],
    26: ["groundedIntoDoublePlays", "GDP", "Grounded into double plays", "batting", "count", 0, 25, "lower"],
    27: ["batterStrikeouts", "SO", "Batter strikeouts", "batting", "count", 40, 220, "lower"],
    28: ["pitchesSeen", "PS", "Pitches seen", "batting", "count", 500, 3000, "higher"],
    29: ["pitchesPerPlateAppearance", "PPA", "Pitches per plate appearance", "batting", "rate", 3.2, 4.5, "higher"],
    31: ["cycles", "CYC", "Cycles", "batting", "count", 0, 2, "higher"],
    32: ["pitchingAppearances", "G", "Pitching appearances", "pitching", "count", 10, 80, "higher"],
    33: ["gamesStarted", "GS", "Games started", "pitching", "count", 0, 35, "higher"],
    34: ["inningsPitched", "IP", "Innings pitched", "pitching", "count", 100, 700, "higher"],
    35: ["battersFaced", "TBF", "Batters faced", "pitching", "count", 100, 900, "higher"],
    36: ["pitchesThrown", "P", "Pitches thrown", "pitching", "count", 500, 3500, "higher"],
    37: ["hitsAllowed", "H", "Hits allowed", "pitching", "count", 20, 250, "lower"],
    38: ["opponentAverage", "OBA", "Opponent batting average", "pitching", "rate", 0.18, 0.33, "lower"],
    39: ["walksAllowed", "BB", "Walks allowed", "pitching", "count", 5, 100, "lower"],
    40: ["intentionalWalksAllowed", "IBB", "Intentional walks allowed", "pitching", "count", 0, 15, "lower"],
    41: ["whip", "WHIP", "Walks and hits per inning", "pitching", "rate", 0.9, 1.55, "lower"],
    42: ["hitBatters", "HBP", "Hit batters", "pitching", "count", 0, 25, "lower"],
    43: ["opponentOnBasePercentage", "OOBP", "Opponent on-base percentage", "pitching", "rate", 0.23, 0.4, "lower"],
    44: ["runsAllowed", "R", "Runs allowed", "pitching", "count", 10, 120, "lower"],
    45: ["earnedRuns", "ER", "Earned runs", "pitching", "count", 10, 110, "lower"],
    46: ["homeRunsAllowed", "HR", "Home runs allowed", "pitching", "count", 2, 40, "lower"],
    47: ["era", "ERA", "Earned run average", "pitching", "rate", 2.1, 5.3, "lower"],
    48: ["strikeouts", "K", "Strikeouts", "pitching", "count", 35, 260, "higher"],
    49: ["strikeoutsPerNine", "K/9", "Strikeouts per nine", "pitching", "rate", 5, 14, "higher"],
    50: ["wildPitches", "WP", "Wild pitches", "pitching", "count", 0, 20, "lower"],
    51: ["balks", "BLK", "Balks", "pitching", "count", 0, 5, "lower"],
    52: ["pickoffs", "PK", "Pickoffs", "pitching", "count", 0, 10, "higher"],
    53: ["wins", "W", "Wins", "pitching", "count", 1, 18, "higher"],
    54: ["losses", "L", "Losses", "pitching", "count", 0, 18, "lower"],
    55: ["winningPercentage", "W%", "Winning percentage", "pitching", "rate", 0, 0.85, "higher"],
    56: ["saveOpportunities", "SVO", "Save opportunities", "pitching", "count", 0, 50, "higher"],
    57: ["saves", "SV", "Saves", "pitching", "count", 0, 45, "higher"],
    58: ["blownSaves", "BS", "Blown saves", "pitching", "count", 0, 15, "lower"],
    59: ["savePercentage", "SV%", "Save percentage", "pitching", "rate", 0.4, 1, "higher"],
    60: ["holds", "HLD", "Holds", "pitching", "count", 0, 40, "higher"],
    62: ["completeGames", "CG", "Complete games", "pitching", "count", 0, 8, "higher"],
    63: ["qualityStarts", "QS", "Quality starts", "pitching", "count", 0, 30, "higher"],
    65: ["noHitters", "NH", "No-hitters", "pitching", "count", 0, 2, "higher"],
    66: ["perfectGames", "PG", "Perfect games", "pitching", "count", 0, 1, "higher"],
    67: ["totalChances", "TC", "Total chances", "batting", "count", 50, 700, "higher"],
    68: ["putouts", "PO", "Putouts", "batting", "count", 20, 600, "higher"],
    69: ["assists", "A", "Assists", "batting", "count", 10, 500, "higher"],
    70: ["outfieldAssists", "OFA", "Outfield assists", "batting", "count", 0, 20, "higher"],
    71: ["fieldingPercentage", "FPCT", "Fielding percentage", "batting", "rate", 0.85, 1, "higher"],
    72: ["errors", "E", "Errors", "batting", "count", 0, 30, "lower"],
    73: ["doublePlays", "DP", "Double plays", "batting", "count", 0, 150, "higher"],
    81: ["gamesPlayed", "G", "Games played", "batting", "count", 20, 162, "higher"],
    82: ["strikeoutWalkRatio", "K/BB", "Strikeout-to-walk ratio", "pitching", "rate", 1, 8, "higher"],
    83: ["savesPlusHolds", "SV+HLD", "Saves plus holds", "pitching", "count", 0, 60, "higher"],
  };
  const DEFAULT_CATEGORY_STAT_IDS = [20, 5, 21, 23, 2, 53, 57, 48, 47, 41];

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function numeric(value) {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : null;
  }

  function categoryForStat(statId, scoringItem) {
    const definition = STAT_DEFINITION_DATA[statId];
    const fallbackGroup =
      statId >= 32 &&
      ![67, 68, 69, 70, 71, 72, 73, 74, 75, 81].includes(statId)
        ? "pitching"
        : "batting";
    const values =
      definition ||
      [
        `espnStat${statId}`,
        `S${statId}`,
        `ESPN stat ${statId}`,
        fallbackGroup,
        "count",
        0,
        100,
        "higher",
      ];
    const [
      id,
      label,
      name,
      group,
      aggregation,
      rangeMinimum,
      rangeMaximum,
      defaultDirection,
    ] = values;
    const direction =
      typeof scoringItem?.isReverseItem === "boolean"
        ? scoringItem.isReverseItem
          ? "lower"
          : "higher"
        : defaultDirection;

    return {
      id,
      label,
      name,
      group,
      aggregation,
      direction,
      statId,
      rangeMinimum,
      rangeMaximum,
      known: Boolean(definition),
    };
  }

  function categoriesForScoring(scoringSettings) {
    const scoringType = String(scoringSettings.scoringType || "").toUpperCase();
    if (!["ROTO", "H2H_CATEGORY"].includes(scoringType)) {
      throw new Error(
        "RosterLab supports rotisserie and head-to-head category leagues, not ESPN points leagues."
      );
    }

    const scoringItems = Array.isArray(scoringSettings.scoringItems)
      ? scoringSettings.scoringItems
      : [];
    const seen = new Set();
    const categories = [];
    const unsupportedCategories = [];
    scoringItems.forEach((item) => {
      const statId = numeric(item?.statId);
      if (!Number.isInteger(statId) || statId < 0 || seen.has(statId)) return;
      seen.add(statId);
      const category = categoryForStat(statId, item);
      if (category.known) categories.push(category);
      else unsupportedCategories.push(category);
    });

    if (scoringItems.length === 0) {
      return {
        scoringType,
        categories: DEFAULT_CATEGORY_STAT_IDS.map((statId) =>
          categoryForStat(statId, null)
        ),
        unsupportedCategories: [],
      };
    }

    return { scoringType, categories, unsupportedCategories };
  }

  function scoringLabel(scoringType, categories) {
    const battingCount = categories.filter(
      (category) => category.group === "batting"
    ).length;
    const pitchingCount = categories.filter(
      (category) => category.group === "pitching"
    ).length;
    const format =
      battingCount > 0 && battingCount === pitchingCount
        ? `${battingCount}x${pitchingCount}`
        : `${categories.length}-category`;
    return `${format} ${
      scoringType === "ROTO" ? "rotisserie" : "head-to-head categories"
    }`;
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
      if (!/^\d{1,20}$/.test(input)) {
        throw new Error("League ID must contain 1 to 20 digits.");
      }
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
    const allowedPath =
      (url.hostname === "www.espn.com" &&
        /^\/fantasy\/baseball(?:\/|$)/.test(url.pathname)) ||
      (url.hostname === "fantasy.espn.com" &&
        /^\/baseball(?:\/|$)/.test(url.pathname));
    if (url.protocol !== "https:" || !allowedPath) {
      throw new Error("Use an HTTPS link from ESPN fantasy baseball.");
    }

    const hashParameters = url.hash.includes("?")
      ? new URLSearchParams(url.hash.slice(url.hash.indexOf("?") + 1))
      : new URLSearchParams();
    const parameter = (name) =>
      url.searchParams.get(name) || hashParameters.get(name);
    const pathLeagueId =
      url.pathname.match(/\/leagues?\/(\d{1,20})(?:\/|$)/i)?.[1] || null;
    const pathSeason =
      url.pathname.match(/\/seasons\/(20\d{2})(?:\/|$)/i)?.[1] || null;
    const leagueId = parameter("leagueId") || pathLeagueId;
    const season = parameter("seasonId") || parameter("season") || pathSeason;
    const teamId = parameter("teamId");

    if (!leagueId || !/^\d{1,20}$/.test(leagueId)) {
      throw new Error("This URL does not contain a readable ESPN league ID.");
    }

    return {
      leagueId,
      season: season && /^20\d{2}$/.test(season) ? season : null,
      teamId: teamId && /^\d{1,20}$/.test(teamId) ? teamId : null,
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

  function seasonStatMaps(player) {
    if (!Array.isArray(player.stats)) {
      return { projection: {}, season: {} };
    }
    const candidates = player.stats.filter(
      (entry) => entry && (entry.stats || entry.appliedStats)
    );
    const projection = candidates.find(
      (entry) => entry.statSourceId === 1 && entry.statSplitTypeId === 0
    );
    const actual = candidates.find(
      (entry) => entry.statSourceId === 0 && entry.statSplitTypeId === 0
    );
    return {
      projection: projection
        ? projection.stats || projection.appliedStats || {}
        : {},
      season: actual ? actual.stats || actual.appliedStats || {} : {},
    };
  }

  function stat(stats, id) {
    return numeric(stats[id]) ?? numeric(stats[String(id)]);
  }

  function categoryScore(value, category) {
    if (!Number.isFinite(value)) return null;
    const range = category.rangeMaximum - category.rangeMinimum;
    if (!Number.isFinite(range) || range <= 0) return 50;
    const amount = clamp(
      (value - category.rangeMinimum) / range,
      0,
      1
    );
    const favorable = category.direction === "lower" ? 1 - amount : amount;
    return clamp(Math.round(favorable * 100), 1, 100);
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
    if ([1, 11].includes(player.defaultPositionId)) return true;
    if (
      Number.isInteger(player.defaultPositionId) &&
      player.defaultPositionId >= 2 &&
      player.defaultPositionId <= 10
    ) {
      return false;
    }
    return (
      positions.includes("SP") ||
      positions.includes("RP")
    );
  }

  function chooseCategorySources(entries, categories) {
    const sources = {};
    categories.forEach((category) => {
      let projectionCoverage = 0;
      let seasonCoverage = 0;
      entries.forEach((entry) => {
        const raw = entry?.playerPoolEntry?.player;
        if (!raw) return;
        const positions = positionsFor(raw);
        const type = isPitcher(raw, positions) ? "pitcher" : "hitter";
        const group = type === "pitcher" ? "pitching" : "batting";
        if (category.group !== group) return;
        const maps = seasonStatMaps(raw);
        const hasUsableValue = (stats) => {
          if (!Number.isFinite(stat(stats, category.statId))) return false;
          if (category.aggregation !== "rate") return true;
          return Number.isFinite(rateCategoryWeight(stats, category));
        };
        if (hasUsableValue(maps.projection)) {
          projectionCoverage += 1;
        }
        if (hasUsableValue(maps.season)) {
          seasonCoverage += 1;
        }
      });

      if (projectionCoverage === 0 && seasonCoverage === 0) {
        sources[category.id] = null;
      } else {
        sources[category.id] =
          projectionCoverage >= seasonCoverage ? "projection" : "season";
      }
    });
    return sources;
  }

  function rateCategoryWeight(stats, category) {
    const atBats = stat(stats, 0);
    const plateAppearances = stat(stats, 16);
    const outs = stat(stats, 34);
    const battersFaced = stat(stats, 35);
    const weightsByStatId = {
      2: atBats,
      9: atBats,
      17:
        plateAppearances ||
        [stat(stats, 0), stat(stats, 10), stat(stats, 12), stat(stats, 13)]
          .filter(Number.isFinite)
          .reduce((total, value) => total + value, 0),
      18: plateAppearances,
      29: plateAppearances,
      38: battersFaced,
      41: outs,
      43: battersFaced,
      47: outs,
      49: outs,
      55: [stat(stats, 53), stat(stats, 54)]
        .filter(Number.isFinite)
        .reduce((total, value) => total + value, 0),
      59: stat(stats, 56),
      71: stat(stats, 67),
      82: stat(stats, 39),
    };
    const weight = weightsByStatId[category.statId];
    return Number.isFinite(weight) && weight > 0 ? weight : null;
  }

  function categoryDataForPlayer({
    categories,
    statMaps,
    categorySources,
    type,
  }) {
    const group = type === "pitcher" ? "pitching" : "batting";
    const scores = {};
    const values = {};
    const weights = {};
    const sources = new Set();
    categories
      .filter((category) => category.group === group)
      .forEach((category) => {
        const source = categorySources[category.id];
        if (!source) return;
        const stats = statMaps[source];
        const value = stat(stats, category.statId);
        if (!Number.isFinite(value)) return;
        if (category.aggregation === "rate") {
          const weight = rateCategoryWeight(stats, category);
          if (!Number.isFinite(weight) || weight <= 0) return;
          weights[category.id] = weight;
        }
        values[category.id] = value;
        scores[category.id] = categoryScore(value, category);
        sources.add(source);
      });
    return { scores, values, weights, sources: [...sources] };
  }

  function projectionLabel(type, values, rank, ownership, categories) {
    const group = type === "pitcher" ? "pitching" : "batting";
    const categoryValues = categories
      .filter((category) => category.group === group)
      .map((category) => {
        const value = values[category.id];
        if (!Number.isFinite(value)) return null;
        if (category.statId === 34) {
          return `${(value / 3).toFixed(1)} ${category.label}`;
        }
        if (category.aggregation === "rate") {
          const digits = Math.abs(value) < 2 ? 3 : 1;
          return `${value.toFixed(digits)} ${category.label}`;
        }
        return `${Math.round(value)} ${category.label}`;
      })
      .filter(Boolean)
      .slice(0, 4);
    if (categoryValues.length > 0) return categoryValues.join(" · ");

    return [
      Number.isFinite(rank) ? `ESPN rank #${Math.round(rank)}` : null,
      Number.isFinite(ownership) ? `${Math.round(ownership)}% rostered` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Imported from ESPN";
  }

  function parsePlayer(entry, ownerTeamId, categories, categorySources) {
    const poolEntry = entry.playerPoolEntry || {};
    const raw = poolEntry.player || {};
    const positions = positionsFor(raw);
    const type = isPitcher(raw, positions) ? "pitcher" : "hitter";
    const value = marketValue(raw);
    const statMaps = seasonStatMaps(raw);
    const seed = hashNumber(raw.id || raw.fullName);
    const ownership = numeric(raw.ownership && raw.ownership.percentOwned);
    const trend =
      numeric(raw.ownership && raw.ownership.percentChange) ?? 0;
    const rank = playerRank(raw);
    const categoryData = categoryDataForPlayer({
      categories,
      statMaps,
      categorySources,
      type,
    });
    const scores = categoryData.scores;
    const scoreValues = Object.values(scores);
    const skillAverage =
      scoreValues.length > 0
        ? scoreValues.reduce((total, score) => total + score, 0) /
          scoreValues.length
        : value;
    const rawStatus = String(raw.injuryStatus || "ACTIVE").replaceAll("_", " ");
    const preferredStats =
      Object.keys(statMaps.projection).length > 0
        ? statMaps.projection
        : statMaps.season;
    const rateWeight =
      type === "pitcher"
        ? stat(preferredStats, 34) ||
          clamp(Math.round(230 + value * 3.2), 260, 560)
        : stat(preferredStats, 0) ||
          clamp(Math.round(430 + value * 1.8), 450, 620);
    const statSource =
      categoryData.sources.length === 1
        ? categoryData.sources[0]
        : categoryData.sources.length > 1
          ? "mixed"
          : "estimate";

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
      projection: projectionLabel(
        type,
        categoryData.values,
        rank,
        ownership,
        categories
      ),
      statSource,
      scores,
      categoryValues: categoryData.values,
      categoryWeights: categoryData.weights,
      rateWeight,
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

    const scoringSettings =
      (payload.settings && payload.settings.scoringSettings) || {};
    const { scoringType, categories, unsupportedCategories } =
      categoriesForScoring(scoringSettings);
    if (categories.length === 0) {
      const labels = unsupportedCategories
        .map((category) => category.label)
        .join(", ");
      throw new Error(
        `RosterLab cannot model this league because all active categories have unknown ESPN stat IDs${
          labels ? `: ${labels}` : "."
        }`
      );
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
    const rosterEntries = [];
    payload.teams.forEach((team) => {
      const entries =
        team.roster && Array.isArray(team.roster.entries)
          ? team.roster.entries
          : [];
      entries.forEach((entry) => {
        if (entry && entry.playerPoolEntry && entry.playerPoolEntry.player) {
          rosterEntries.push({ entry, ownerTeamId: String(team.id) });
        }
      });
    });
    const categorySources = chooseCategorySources(
      rosterEntries.map(({ entry }) => entry),
      categories
    );
    const players = rosterEntries.map(({ entry, ownerTeamId }) =>
      parsePlayer(entry, ownerTeamId, categories, categorySources)
    );

    if (players.length === 0) {
      throw new Error("ESPN returned the league, but no roster entries were available.");
    }
    const modeledCategories = categories.filter((category) =>
      players.some((player) =>
        Number.isFinite(player.categoryValues?.[category.id])
      )
    );
    const missingDataCategories = categories
      .filter(
        (category) =>
          !modeledCategories.some(
            (modeledCategory) => modeledCategory.id === category.id
          )
      )
      .map((category) => ({
        ...category,
        reason: "ESPN returned no season or projection data for this category.",
      }));
    const unmodeledCategories = [
      ...unsupportedCategories.map((category) => ({
        ...category,
        reason: "RosterLab does not recognize this ESPN stat ID yet.",
      })),
      ...missingDataCategories,
    ];
    if (modeledCategories.length === 0) {
      throw new Error(
        "ESPN did not return usable data for this league's scoring categories."
      );
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
        scoring: scoringLabel(scoringType, [
          ...categories,
          ...unsupportedCategories,
        ]),
        sourceLabel: "ESPN league",
        updatedAt: new Date().toISOString(),
      },
      categories: modeledCategories,
      unmodeledCategories,
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
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new LeagueImportError(
          typeof body.message === "string"
            ? body.message
            : `League import returned ${response.status}.`,
          typeof body.code === "string" ? body.code : "IMPORT_FAILED"
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
        throw new LeagueImportError(
          "This league appears to be private. Use Connect with ESPN to sync it.",
          "PRIVATE_LEAGUE"
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
    signal,
    timeout = 12000,
  }) {
    if (IMPORT_ENDPOINT) {
      return fetchLeagueThroughRelay({
        leagueId,
        season,
        teamId,
        signal,
        timeout,
      });
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
    LeagueImportError,
    parseLeagueReference,
    parseLeague,
  };
});
