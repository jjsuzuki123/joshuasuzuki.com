(function initFantasyDemoData(root, factory) {
  const data = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = data;
  }

  root.FantasyDemoData = data;
})(typeof globalThis !== "undefined" ? globalThis : this, function createDemoData() {
  "use strict";

  const categories = [
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

  const teams = [
    {
      id: "fog-city",
      name: "Fog City Fastballs",
      abbreviation: "FOG",
      manager: "Josh",
      standing: 4,
      record: "63-57-10",
      color: "#1f6f5f",
    },
    {
      id: "run-it-up",
      name: "Run It Up",
      abbreviation: "RUN",
      manager: "Maya",
      standing: 5,
      record: "60-61-9",
      color: "#c96e32",
    },
    {
      id: "ninth-inning",
      name: "Ninth Inning",
      abbreviation: "NIN",
      manager: "Theo",
      standing: 3,
      record: "66-54-10",
      color: "#5266a7",
    },
    {
      id: "launch-angle",
      name: "Launch Angle",
      abbreviation: "LCH",
      manager: "Nina",
      standing: 1,
      record: "74-46-10",
      color: "#9b4f62",
    },
    {
      id: "prospect-park",
      name: "Prospect Park",
      abbreviation: "PRK",
      manager: "Eli",
      standing: 2,
      record: "69-51-10",
      color: "#735996",
    },
    {
      id: "northside",
      name: "Northside Numbers",
      abbreviation: "NSN",
      manager: "Sam",
      standing: 6,
      record: "52-68-10",
      color: "#357099",
    },
  ];

  const clamp = (value, minimum, maximum) =>
    Math.min(maximum, Math.max(minimum, value));

  function signalSet(value, scores, trend, adjustment) {
    const measuredScores = Object.values(scores).filter(Number.isFinite);
    const skillAverage =
      measuredScores.reduce((total, score) => total + score, 0) /
      Math.max(1, measuredScores.length);

    return {
      projection: clamp(Math.round(value + adjustment), 1, 99),
      underlying: clamp(Math.round(skillAverage), 1, 99),
      consensus: clamp(Math.round(value + trend * 0.45), 1, 99),
    };
  }

  function hitter(
    id,
    name,
    mlbTeam,
    positions,
    ownerTeamId,
    value,
    trend,
    ratings,
    projection,
    options
  ) {
    const settings = options || {};
    const scores = {
      runs: ratings[0],
      homeRuns: ratings[1],
      rbi: ratings[2],
      stolenBases: ratings[3],
      average: ratings[4],
    };

    return {
      id,
      name,
      mlbTeam,
      positions,
      ownerTeamId,
      type: "hitter",
      marketValue: value,
      trend,
      ownership: settings.ownership || clamp(value + 3, 18, 100),
      status: settings.status || "Healthy",
      projection,
      scores,
      rateWeight:
        settings.rateWeight || clamp(Math.round(430 + value * 1.8), 450, 620),
      signals: signalSet(value, scores, trend, settings.projectionAdjustment || 0),
      news: settings.news || null,
    };
  }

  function pitcher(
    id,
    name,
    mlbTeam,
    positions,
    ownerTeamId,
    value,
    trend,
    ratings,
    projection,
    options
  ) {
    const settings = options || {};
    const scores = {
      wins: ratings[0],
      saves: ratings[1],
      strikeouts: ratings[2],
      era: ratings[3],
      whip: ratings[4],
    };

    return {
      id,
      name,
      mlbTeam,
      positions,
      ownerTeamId,
      type: "pitcher",
      marketValue: value,
      trend,
      ownership: settings.ownership || clamp(value + 4, 18, 100),
      status: settings.status || "Healthy",
      projection,
      scores,
      rateWeight:
        settings.rateWeight || clamp(Math.round(230 + value * 3.2), 260, 560),
      signals: signalSet(value, scores, trend, settings.projectionAdjustment || 0),
      news: settings.news || null,
    };
  }

  const players = [
    hitter("will-smith", "Will Smith", "LAD", ["C"], "fog-city", 71, 1.2, [72, 79, 82, 18, 75], "44 R · 18 HR · 52 RBI · .272"),
    hitter("matt-olson", "Matt Olson", "ATL", ["1B"], "fog-city", 81, -1.8, [82, 95, 94, 8, 57], "51 R · 27 HR · 73 RBI · .243"),
    hitter("marcus-semien", "Marcus Semien", "TEX", ["2B"], "fog-city", 74, -0.6, [88, 76, 78, 34, 62], "59 R · 17 HR · 54 RBI · 8 SB"),
    hitter("corey-seager", "Corey Seager", "TEX", ["SS"], "fog-city", 88, 2.4, [86, 93, 89, 10, 88], "56 R · 25 HR · 67 RBI · .292", {
      projectionAdjustment: 2,
      news: {
        source: "RotoWire",
        headline: "Back in the heart of the order",
        impact: "positive",
        updated: "Demo note",
        fixture: true,
      },
    }),
    hitter("aaron-judge", "Aaron Judge", "NYY", ["OF"], "fog-city", 99, 3.1, [100, 100, 100, 14, 84], "69 R · 34 HR · 81 RBI · .291", {
      ownership: 100,
      projectionAdjustment: 3,
    }),
    hitter("teoscar-hernandez", "Teoscar Hernández", "LAD", ["OF"], "fog-city", 72, -2.1, [70, 89, 87, 24, 55], "43 R · 23 HR · 64 RBI · .247"),
    pitcher("zack-wheeler", "Zack Wheeler", "PHI", ["SP"], "fog-city", 91, 1.8, [87, 3, 95, 94, 92], "10 W · 146 K · 2.91 ERA · 1.02 WHIP"),
    pitcher("george-kirby", "George Kirby", "SEA", ["SP"], "fog-city", 83, 0.4, [78, 2, 83, 89, 98], "8 W · 128 K · 3.31 ERA · 1.01 WHIP"),
    pitcher("logan-gilbert", "Logan Gilbert", "SEA", ["SP"], "fog-city", 85, 2.2, [80, 2, 91, 90, 91], "9 W · 141 K · 3.24 ERA · 1.07 WHIP"),
    pitcher("tanner-scott", "Tanner Scott", "LAD", ["RP"], "fog-city", 64, -2.7, [20, 72, 67, 74, 73], "3 W · 19 SV · 52 K · 3.41 ERA", {
      news: {
        source: "RotoWire",
        headline: "Save chances remain volatile",
        impact: "negative",
        updated: "Demo note",
        fixture: true,
      },
    }),

    hitter("cal-raleigh", "Cal Raleigh", "SEA", ["C"], "run-it-up", 79, 3.8, [76, 96, 94, 18, 52], "49 R · 29 HR · 71 RBI · .236"),
    hitter("ketel-marte", "Ketel Marte", "ARI", ["2B"], "run-it-up", 83, 1.1, [88, 86, 82, 28, 86], "58 R · 21 HR · 57 RBI · .291"),
    hitter("elly-de-la-cruz", "Elly De La Cruz", "CIN", ["SS", "3B"], "run-it-up", 94, 4.5, [98, 83, 76, 100, 68], "66 R · 19 HR · 49 RBI · 34 SB"),
    hitter("corbin-carroll", "Corbin Carroll", "ARI", ["OF"], "run-it-up", 84, 5.2, [96, 68, 57, 95, 72], "65 R · 14 HR · 42 RBI · 29 SB", {
      projectionAdjustment: 3,
    }),
    hitter("pete-crow-armstrong", "Pete Crow-Armstrong", "CHC", ["OF"], "run-it-up", 80, 6.1, [84, 75, 69, 94, 63], "54 R · 17 HR · 47 RBI · 28 SB"),
    hitter("luis-arraez", "Luis Arraez", "SD", ["1B", "2B"], "run-it-up", 68, -0.2, [78, 25, 49, 18, 100], "52 R · 5 HR · 38 RBI · .318"),
    pitcher("framber-valdez", "Framber Valdez", "HOU", ["SP"], "run-it-up", 81, 0.7, [86, 2, 78, 91, 83], "10 W · 118 K · 3.17 ERA · 1.15 WHIP"),
    pitcher("shota-imanaga", "Shota Imanaga", "CHC", ["SP"], "run-it-up", 79, -1.1, [75, 1, 84, 87, 89], "8 W · 126 K · 3.38 ERA · 1.08 WHIP"),
    pitcher("mason-miller", "Mason Miller", "ATH", ["RP"], "run-it-up", 83, 2.6, [17, 91, 79, 89, 86], "2 W · 28 SV · 66 K · 2.84 ERA"),
    pitcher("hunter-greene", "Hunter Greene", "CIN", ["SP"], "run-it-up", 80, 2.9, [74, 1, 96, 84, 82], "7 W · 151 K · 3.51 ERA · 1.13 WHIP"),

    hitter("salvador-perez", "Salvador Perez", "KC", ["C", "1B"], "ninth-inning", 68, -1.5, [64, 84, 88, 6, 65], "39 R · 21 HR · 65 RBI · .261"),
    hitter("vladimir-guerrero", "Vladimir Guerrero Jr.", "TOR", ["1B"], "ninth-inning", 91, 2.7, [91, 90, 96, 18, 93], "62 R · 24 HR · 72 RBI · .309"),
    hitter("ozzie-albies", "Ozzie Albies", "ATL", ["2B"], "ninth-inning", 76, 1.6, [84, 73, 74, 67, 74], "54 R · 15 HR · 49 RBI · 18 SB"),
    hitter("manny-machado", "Manny Machado", "SD", ["3B"], "ninth-inning", 84, 1.9, [82, 88, 90, 38, 78], "55 R · 23 HR · 66 RBI · .278"),
    hitter("yordan-alvarez", "Yordan Alvarez", "HOU", ["OF", "UTIL"], "ninth-inning", 93, -0.8, [91, 97, 98, 8, 91], "61 R · 29 HR · 78 RBI · .302"),
    hitter("kyle-schwarber", "Kyle Schwarber", "PHI", ["OF", "UTIL"], "ninth-inning", 79, 1.4, [94, 96, 91, 15, 43], "67 R · 30 HR · 69 RBI · .227"),
    pitcher("tarik-skubal", "Tarik Skubal", "DET", ["SP"], "ninth-inning", 97, 3.4, [96, 1, 100, 100, 98], "12 W · 165 K · 2.31 ERA · .94 WHIP"),
    pitcher("garrett-crochet", "Garrett Crochet", "BOS", ["SP"], "ninth-inning", 92, 2.5, [89, 1, 99, 94, 93], "10 W · 171 K · 2.89 ERA · 1.01 WHIP"),
    pitcher("emmanuel-clase", "Emmanuel Clase", "CLE", ["RP"], "ninth-inning", 87, 1.3, [18, 100, 66, 98, 97], "2 W · 34 SV · 49 K · 1.91 ERA"),
    pitcher("josh-hader", "Josh Hader", "HOU", ["RP"], "ninth-inning", 81, -1.4, [16, 94, 83, 85, 82], "2 W · 30 SV · 72 K · 3.02 ERA"),

    hitter("william-contreras", "William Contreras", "MIL", ["C"], "launch-angle", 76, 0.9, [81, 74, 77, 26, 84], "55 R · 16 HR · 53 RBI · .286"),
    hitter("freddie-freeman", "Freddie Freeman", "LAD", ["1B"], "launch-angle", 90, 1.7, [94, 84, 89, 36, 96], "64 R · 20 HR · 68 RBI · .317"),
    hitter("jose-altuve", "Jose Altuve", "HOU", ["2B"], "launch-angle", 81, -0.3, [89, 76, 69, 62, 89], "60 R · 17 HR · 46 RBI · 16 SB"),
    hitter("jose-ramirez", "José Ramírez", "CLE", ["3B"], "launch-angle", 97, 3.7, [99, 94, 99, 88, 87], "68 R · 28 HR · 80 RBI · 25 SB"),
    hitter("juan-soto", "Juan Soto", "NYM", ["OF"], "launch-angle", 98, 2.1, [100, 98, 96, 30, 93], "75 R · 31 HR · 76 RBI · .309"),
    hitter("brent-rooker", "Brent Rooker", "ATH", ["OF", "UTIL"], "launch-angle", 78, 0.8, [73, 92, 90, 13, 68], "46 R · 27 HR · 70 RBI · .266"),
    pitcher("paul-skenes", "Paul Skenes", "PIT", ["SP"], "launch-angle", 99, 4.8, [92, 1, 100, 100, 100], "11 W · 174 K · 2.18 ERA · .91 WHIP"),
    pitcher("yoshinobu-yamamoto", "Yoshinobu Yamamoto", "LAD", ["SP"], "launch-angle", 91, 1.8, [91, 1, 94, 96, 95], "11 W · 149 K · 2.73 ERA · .99 WHIP"),
    pitcher("edwin-diaz", "Edwin Díaz", "NYM", ["RP"], "launch-angle", 79, 0.6, [14, 92, 84, 83, 79], "2 W · 29 SV · 74 K · 3.18 ERA"),
    pitcher("robert-suarez", "Robert Suarez", "SD", ["RP"], "launch-angle", 71, -1.7, [19, 82, 62, 79, 76], "3 W · 24 SV · 48 K · 3.27 ERA"),

    hitter("adley-rutschman", "Adley Rutschman", "BAL", ["C"], "prospect-park", 72, -1.2, [78, 75, 79, 12, 79], "51 R · 17 HR · 56 RBI · .276"),
    hitter("bryce-harper", "Bryce Harper", "PHI", ["1B"], "prospect-park", 91, 2.4, [92, 94, 92, 35, 90], "64 R · 27 HR · 72 RBI · .298"),
    hitter("jackson-chourio", "Jackson Chourio", "MIL", ["OF"], "prospect-park", 89, 5.7, [93, 83, 80, 91, 82], "63 R · 21 HR · 57 RBI · 27 SB"),
    hitter("gunnar-henderson", "Gunnar Henderson", "BAL", ["SS", "3B"], "prospect-park", 95, 3.2, [98, 94, 88, 66, 84], "70 R · 28 HR · 63 RBI · 17 SB"),
    hitter("james-wood", "James Wood", "WSH", ["OF"], "prospect-park", 86, 4.3, [88, 86, 81, 79, 74], "59 R · 23 HR · 57 RBI · 23 SB"),
    hitter("kyle-tucker", "Kyle Tucker", "CHC", ["OF"], "prospect-park", 94, 2.8, [96, 91, 90, 84, 89], "67 R · 26 HR · 68 RBI · 24 SB"),
    pitcher("cole-ragans", "Cole Ragans", "KC", ["SP"], "prospect-park", 87, 1.2, [82, 1, 96, 90, 88], "9 W · 158 K · 3.19 ERA · 1.07 WHIP"),
    pitcher("bryan-woo", "Bryan Woo", "SEA", ["SP"], "prospect-park", 82, 3.1, [77, 1, 80, 94, 97], "8 W · 116 K · 2.97 ERA · .98 WHIP"),
    pitcher("ryan-helsley", "Ryan Helsley", "STL", ["RP"], "prospect-park", 78, 0.4, [15, 93, 73, 84, 80], "2 W · 31 SV · 58 K · 3.08 ERA"),
    pitcher("jhoan-duran", "Jhoan Duran", "MIN", ["RP"], "prospect-park", 75, 1.5, [14, 86, 78, 86, 85], "2 W · 27 SV · 64 K · 2.94 ERA"),

    hitter("logan-ohoppe", "Logan O'Hoppe", "LAA", ["C"], "northside", 67, 0.3, [66, 82, 78, 10, 61], "41 R · 21 HR · 55 RBI · .255"),
    hitter("pete-alonso", "Pete Alonso", "NYM", ["1B"], "northside", 84, 1.2, [84, 96, 97, 8, 65], "56 R · 31 HR · 79 RBI · .261"),
    hitter("brice-turang", "Brice Turang", "MIL", ["2B", "SS"], "northside", 77, 3.6, [88, 50, 57, 96, 78], "60 R · 10 HR · 42 RBI · 31 SB"),
    hitter("bobby-witt", "Bobby Witt Jr.", "KC", ["SS"], "northside", 99, 4.1, [100, 91, 91, 100, 97], "73 R · 25 HR · 67 RBI · 32 SB"),
    hitter("steven-kwan", "Steven Kwan", "CLE", ["OF"], "northside", 76, 1.7, [91, 48, 50, 60, 98], "62 R · 9 HR · 39 RBI · 15 SB"),
    hitter("ronald-acuna", "Ronald Acuña Jr.", "ATL", ["OF"], "northside", 95, 6.4, [99, 90, 79, 96, 91], "69 R · 25 HR · 58 RBI · 30 SB", {
      projectionAdjustment: 4,
    }),
    pitcher("logan-webb", "Logan Webb", "SF", ["SP"], "northside", 81, -0.4, [91, 1, 76, 89, 88], "11 W · 117 K · 3.29 ERA · 1.09 WHIP"),
    pitcher("max-fried", "Max Fried", "NYY", ["SP"], "northside", 85, 1.3, [94, 1, 82, 93, 91], "12 W · 126 K · 3.04 ERA · 1.06 WHIP"),
    pitcher("david-bednar", "David Bednar", "PIT", ["RP"], "northside", 65, -3.8, [13, 72, 69, 68, 64], "2 W · 20 SV · 57 K · 3.78 ERA"),
    pitcher("devin-williams", "Devin Williams", "NYY", ["RP"], "northside", 74, 2.2, [12, 85, 82, 82, 78], "1 W · 26 SV · 69 K · 3.13 ERA"),
  ];

  return {
    mode: "demo",
    activeTeamId: "fog-city",
    league: {
      id: "demo-2026",
      name: "Bay Area Rotisserie",
      season: 2026,
      size: teams.length,
      scoring: "5x5 rotisserie",
      sourceLabel: "Illustrative demo",
      updatedAt: "Demo data",
    },
    categories,
    teams,
    players,
    teamStrategies: {
      "fog-city": {
        puntCategories: ["stolenBases"],
        focusCategories: ["saves"],
      },
    },
    sourceSnapshot: {
      schemaVersion: 1,
      generatedAt: null,
      matchedPlayers: 0,
      fixture: true,
    },
    sources: [
      {
        id: "espn",
        name: "ESPN Fantasy",
        url: "https://www.espn.com/fantasy/baseball/",
        coverage: "League settings, rosters, standings, ownership",
        status: "demo",
        kind: "quantitative",
        cadence: "On sync",
      },
      {
        id: "fangraphs",
        name: "FanGraphs",
        url: "https://www.fangraphs.com/projections",
        coverage: "Rest-of-season projection signal",
        status: "fixture",
        kind: "quantitative",
        cadence: "Illustrative values only",
      },
      {
        id: "savant",
        name: "Baseball Savant",
        url: "https://baseballsavant.mlb.com/",
        coverage: "Expected outcomes and quality of contact",
        status: "fixture",
        kind: "quantitative",
        cadence: "Illustrative values only",
      },
      {
        id: "rotowire",
        name: "RotoWire",
        url: "https://www.rotowire.com/baseball/",
        coverage: "Injury, lineup, and role news",
        status: "fixture",
        kind: "qualitative",
        cadence: "Licensed feed needed",
      },
    ],
    model: {
      version: "2.0 demo evidence model",
      weights: [
        { label: "Market and rank anchor", value: 50 },
        { label: "Category production", value: 30 },
        { label: "Projection and skill evidence", value: 20 },
      ],
      adjustments: ["Availability", "Role news", "Team category strategy"],
    },
  };
});
