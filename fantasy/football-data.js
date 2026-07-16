(function initFootballData(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.FootballData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFootballData() {
  "use strict";

  const SOURCES = [
    {
      id: "projections",
      name: "Consensus projections",
      kind: "quantitative",
      access: "fixture",
      note: "Illustrative rest-of-season counting stats for the calculator demo.",
    },
    {
      id: "efficiency",
      name: "Efficiency / volume",
      kind: "quantitative",
      access: "fixture",
      note: "Fixture efficiency and opportunity scores (not a live feed).",
    },
    {
      id: "role-news",
      name: "Role & injury notes",
      kind: "qualitative",
      access: "fixture",
      note: "Illustrative role and availability notes for the demo model.",
    },
  ];

  function buildPlayer(row) {
    const [
      id,
      name,
      proTeam,
      position,
      age,
      bye,
      market,
      adp,
      projections,
      skillScore,
      impact,
      note,
    ] = row;
    const p = projections && typeof projections === "object" ? projections : {};
    return {
      id,
      name,
      proTeam,
      position,
      age: age == null ? null : age,
      bye: Number(bye) || 0,
      marketValue: Number(market) || 50,
      adp: Number.isFinite(adp) ? Number(adp) : null,
      status: "active",
      projections: {
        passYds: Number(p.passYds) || 0,
        passTd: Number(p.passTd) || 0,
        interceptions: Number(p.int) || 0,
        rushYds: Number(p.rushYds) || 0,
        rushTd: Number(p.rushTd) || 0,
        rec: Number(p.rec) || 0,
        recYds: Number(p.recYds) || 0,
        recTd: Number(p.recTd) || 0,
        fumblesLost: Number(p.fum) || 0,
      },
      quantitative: {
        overall: Number(skillScore) || Number(market) || 50,
        confidence: 0.75,
        sourceId: "efficiency",
      },
      qualitative: {
        impact: Number(impact) || 0,
        summary: note || null,
        sourceId: "role-news",
      },
    };
  }

  const ROWS = [
    ["jalen-hurts", "Jalen Hurts", "PHI", "QB", 27, 5, 95, 18, { passYds: 3600, passTd: 28, int: 10, rushYds: 650, rushTd: 12 }, 90],
    ["josh-allen", "Josh Allen", "BUF", "QB", 29, 12, 98, 12, { passYds: 4000, passTd: 30, int: 12, rushYds: 520, rushTd: 10 }, 94],
    ["lamar-jackson", "Lamar Jackson", "BAL", "QB", 28, 7, 96, 14, { passYds: 3800, passTd: 28, int: 8, rushYds: 850, rushTd: 5 }, 93],
    ["jayden-daniels", "Jayden Daniels", "WAS", "QB", 24, 14, 90, 28, { passYds: 3400, passTd: 24, int: 10, rushYds: 700, rushTd: 6 }, 88],
    ["joe-burrow", "Joe Burrow", "CIN", "QB", 28, 12, 86, 35, { passYds: 4300, passTd: 32, int: 10 }, 89],
    ["patrick-mahomes", "Patrick Mahomes", "KC", "QB", 29, 6, 82, 40, { passYds: 4100, passTd: 28, int: 11, rushYds: 280, rushTd: 2 }, 87],
    ["baker-mayfield", "Baker Mayfield", "TB", "QB", 30, 9, 72, 70, { passYds: 3900, passTd: 28, int: 12 }, 74],
    ["bo-nix", "Bo Nix", "DEN", "QB", 25, 12, 70, 85, { passYds: 3600, passTd: 24, int: 12, rushYds: 250, rushTd: 3 }, 70],
    ["dak-prescott", "Dak Prescott", "DAL", "QB", 32, 7, 66, 95, { passYds: 3800, passTd: 26, int: 12 }, 72],
    ["caleb-williams", "Caleb Williams", "CHI", "QB", 23, 5, 64, 100, { passYds: 3400, passTd: 22, int: 12, rushYds: 150, rushTd: 2 }, 68],
    ["justin-herbert", "Justin Herbert", "LAC", "QB", 27, 5, 74, 75, { passYds: 4100, passTd: 26, int: 10 }, 78],
    ["kyler-murray", "Kyler Murray", "ARI", "QB", 28, 8, 71, 80, { passYds: 3600, passTd: 22, rushYds: 450, rushTd: 5 }, 73],
    ["bijan-robinson", "Bijan Robinson", "ATL", "RB", 23, 12, 99, 2, { rushYds: 1400, rushTd: 12, rec: 60, recYds: 450, recTd: 3 }, 96],
    ["saquon-barkley", "Saquon Barkley", "PHI", "RB", 28, 5, 97, 3, { rushYds: 1450, rushTd: 12, rec: 45, recYds: 350, recTd: 2 }, 95],
    ["jahmyr-gibbs", "Jahmyr Gibbs", "DET", "RB", 23, 5, 96, 4, { rushYds: 1100, rushTd: 12, rec: 70, recYds: 480, recTd: 4 }, 94],
    ["derrick-henry", "Derrick Henry", "BAL", "RB", 31, 7, 90, 10, { rushYds: 1400, rushTd: 14, rec: 15, recYds: 100 }, 88],
    ["jonathan-taylor", "Jonathan Taylor", "IND", "RB", 26, 14, 91, 8, { rushYds: 1250, rushTd: 12, rec: 30, recYds: 200 }, 89],
    ["breece-hall", "Breece Hall", "NYJ", "RB", 24, 12, 88, 16, { rushYds: 1100, rushTd: 8, rec: 55, recYds: 450, recTd: 3 }, 87],
    ["kyren-williams", "Kyren Williams", "LAR", "RB", 25, 6, 85, 15, { rushYds: 1100, rushTd: 12, rec: 25, recYds: 200 }, 84],
    ["josh-jacobs", "Josh Jacobs", "GB", "RB", 27, 5, 84, 20, { rushYds: 1200, rushTd: 10, rec: 20, recYds: 180 }, 83],
    ["james-cook", "James Cook", "BUF", "RB", 25, 12, 83, 22, { rushYds: 1100, rushTd: 10, rec: 40, recYds: 280 }, 82],
    ["kenneth-walker", "Kenneth Walker III", "SEA", "RB", 24, 5, 78, 32, { rushYds: 1000, rushTd: 9, rec: 25, recYds: 180 }, 78],
    ["alvin-kamara", "Alvin Kamara", "NO", "RB", 30, 12, 80, 30, { rushYds: 800, rushTd: 6, rec: 70, recYds: 500, recTd: 3 }, 80],
    ["chase-brown", "Chase Brown", "CIN", "RB", 24, 12, 70, 50, { rushYds: 950, rushTd: 7, rec: 40, recYds: 280 }, 70],
    ["devon-achane", "De'Von Achane", "MIA", "RB", 24, 6, 79, 28, { rushYds: 900, rushTd: 8, rec: 50, recYds: 400, recTd: 3 }, 78],
    ["joe-mixon", "Joe Mixon", "HOU", "RB", 29, 14, 74, 45, { rushYds: 1000, rushTd: 8, rec: 25, recYds: 200 }, 74],
    ["james-conner", "James Conner", "ARI", "RB", 30, 8, 72, 48, { rushYds: 950, rushTd: 8, rec: 30, recYds: 220 }, 72],
    ["tony-pollard", "Tony Pollard", "TEN", "RB", 28, 5, 68, 55, { rushYds: 900, rushTd: 6, rec: 35, recYds: 250 }, 68],
    ["rachaad-white", "Rachaad White", "TB", "RB", 26, 9, 66, 58, { rushYds: 700, rushTd: 4, rec: 55, recYds: 400, recTd: 2 }, 65],
    ["aaron-jones", "Aaron Jones", "MIN", "RB", 30, 6, 65, 60, { rushYds: 800, rushTd: 5, rec: 40, recYds: 300 }, 64],
    ["jaylen-warren", "Jaylen Warren", "PIT", "RB", 26, 5, 58, 90, { rushYds: 700, rushTd: 4, rec: 45, recYds: 300 }, 58],
    ["tyjae-spears", "Tyjae Spears", "TEN", "RB", 24, 5, 55, 100, { rushYds: 500, rushTd: 3, rec: 40, recYds: 300 }, 56],
    ["nick-chubb", "Nick Chubb", "HOU", "RB", 29, 14, 52, 110, { rushYds: 900, rushTd: 6, rec: 10, recYds: 80 }, 61, -0.3, "Workload share risk in committee."],
    ["jamarr-chase", "Ja'Marr Chase", "CIN", "WR", 25, 12, 100, 1, { rec: 110, recYds: 1400, recTd: 12 }, 99],
    ["justin-jefferson", "Justin Jefferson", "MIN", "WR", 26, 6, 98, 5, { rec: 100, recYds: 1400, recTd: 9 }, 97],
    ["ceedee-lamb", "CeeDee Lamb", "DAL", "WR", 26, 7, 95, 6, { rec: 100, recYds: 1300, recTd: 9 }, 95],
    ["amon-ra", "Amon-Ra St. Brown", "DET", "WR", 25, 5, 94, 7, { rec: 110, recYds: 1200, recTd: 10 }, 93],
    ["puka-nacua", "Puka Nacua", "LAR", "WR", 24, 6, 90, 11, { rec: 95, recYds: 1200, recTd: 8 }, 89],
    ["nico-collins", "Nico Collins", "HOU", "WR", 26, 14, 89, 14, { rec: 85, recYds: 1200, recTd: 8 }, 90],
    ["brian-thomas", "Brian Thomas Jr.", "JAX", "WR", 22, 12, 88, 17, { rec: 80, recYds: 1100, recTd: 8 }, 87],
    ["aj-brown", "A.J. Brown", "PHI", "WR", 28, 5, 87, 18, { rec: 75, recYds: 1100, recTd: 8 }, 86],
    ["malik-nabers", "Malik Nabers", "NYG", "WR", 22, 14, 85, 21, { rec: 90, recYds: 1100, recTd: 6 }, 84],
    ["drake-london", "Drake London", "ATL", "WR", 24, 12, 84, 24, { rec: 90, recYds: 1100, recTd: 7 }, 84],
    ["ladd-mcconkey", "Ladd McConkey", "LAC", "WR", 23, 5, 82, 26, { rec: 85, recYds: 1100, recTd: 7 }, 82],
    ["marvin-harrison", "Marvin Harrison Jr.", "ARI", "WR", 23, 8, 81, 27, { rec: 80, recYds: 1100, recTd: 8 }, 81],
    ["tee-higgins", "Tee Higgins", "CIN", "WR", 26, 12, 80, 33, { rec: 70, recYds: 1000, recTd: 8 }, 80],
    ["garrett-wilson", "Garrett Wilson", "NYJ", "WR", 25, 12, 79, 34, { rec: 85, recYds: 1000, recTd: 5 }, 79],
    ["dk-metcalf", "DK Metcalf", "PIT", "WR", 27, 5, 78, 38, { rec: 70, recYds: 1000, recTd: 7 }, 77],
    ["mike-evans", "Mike Evans", "TB", "WR", 32, 9, 77, 36, { rec: 65, recYds: 1000, recTd: 10 }, 76],
    ["devonta-smith", "DeVonta Smith", "PHI", "WR", 26, 5, 74, 42, { rec: 75, recYds: 950, recTd: 6 }, 74],
    ["george-pickens", "George Pickens", "DAL", "WR", 24, 7, 71, 44, { rec: 70, recYds: 1000, recTd: 6 }, 70],
    ["zay-flowers", "Zay Flowers", "BAL", "WR", 24, 7, 69, 50, { rec: 70, recYds: 900, recTd: 5 }, 70],
    ["chris-olave", "Chris Olave", "NO", "WR", 25, 12, 70, 52, { rec: 70, recYds: 950, recTd: 5 }, 69, -0.2, "Injury history caps ceiling."],
    ["jameson-williams", "Jameson Williams", "DET", "WR", 24, 5, 67, 55, { rec: 55, recYds: 900, recTd: 7 }, 68],
    ["jaylen-waddle", "Jaylen Waddle", "MIA", "WR", 26, 6, 66, 56, { rec: 70, recYds: 900, recTd: 4 }, 66],
    ["jordan-addison", "Jordan Addison", "MIN", "WR", 23, 6, 65, 62, { rec: 65, recYds: 900, recTd: 6 }, 65],
    ["courtland-sutton", "Courtland Sutton", "DEN", "WR", 29, 12, 64, 65, { rec: 65, recYds: 900, recTd: 6 }, 64],
    ["josh-downs", "Josh Downs", "IND", "WR", 24, 14, 56, 90, { rec: 70, recYds: 750, recTd: 3 }, 57],
    ["romeo-doubs", "Romeo Doubs", "GB", "WR", 25, 5, 54, 95, { rec: 55, recYds: 700, recTd: 5 }, 54],
    ["calvin-ridley", "Calvin Ridley", "TEN", "WR", 30, 5, 58, 80, { rec: 60, recYds: 850, recTd: 4 }, 58],
    ["brock-bowers", "Brock Bowers", "LV", "TE", 22, 8, 91, 19, { rec: 90, recYds: 1000, recTd: 6 }, 91],
    ["trey-mcbride", "Trey McBride", "ARI", "TE", 25, 8, 86, 25, { rec: 90, recYds: 1000, recTd: 5 }, 87],
    ["george-kittle", "George Kittle", "SF", "TE", 32, 9, 78, 36, { rec: 65, recYds: 900, recTd: 6 }, 80],
    ["sam-laporta", "Sam LaPorta", "DET", "TE", 24, 5, 75, 40, { rec: 65, recYds: 750, recTd: 6 }, 75],
    ["travis-kelce", "Travis Kelce", "KC", "TE", 35, 6, 74, 45, { rec: 70, recYds: 800, recTd: 5 }, 73, -0.15, "Age curve; still a volume TE1."],
    ["tj-hockenson", "T.J. Hockenson", "MIN", "TE", 28, 6, 70, 55, { rec: 65, recYds: 750, recTd: 5 }, 70],
    ["mark-andrews", "Mark Andrews", "BAL", "TE", 30, 7, 68, 58, { rec: 55, recYds: 700, recTd: 7 }, 68],
    ["dalton-kincaid", "Dalton Kincaid", "BUF", "TE", 25, 12, 62, 75, { rec: 60, recYds: 650, recTd: 4 }, 62],
    ["kyle-pitts", "Kyle Pitts", "ATL", "TE", 25, 12, 57, 85, { rec: 50, recYds: 650, recTd: 4 }, 58],
    ["david-njoku", "David Njoku", "CLE", "TE", 29, 9, 58, 88, { rec: 55, recYds: 650, recTd: 4 }, 55],
    ["brandon-aubrey", "Brandon Aubrey", "DAL", "K", 30, 7, 42, 140, {}, 42],
    ["justin-tucker", "Justin Tucker", "BAL", "K", 35, 7, 40, 150, {}, 40],
    ["harrison-butker", "Harrison Butker", "KC", "K", 30, 6, 36, 160, {}, 36],
    ["bills-dst", "Bills D/ST", "BUF", "DST", null, 12, 35, 155, {}, 34],
    ["ravens-dst", "Ravens D/ST", "BAL", "DST", null, 7, 33, 170, {}, 33],
    ["eagles-dst", "Eagles D/ST", "PHI", "DST", null, 5, 32, 175, {}, 32],
  ];

  return {
    sources: SOURCES,
    players: ROWS.map(buildPlayer),
    defaultSettings: {
      leagueSize: 12,
      ppr: 1,
      superflex: false,
      tep: false,
    },
  };
});
