import test from "node:test";
import assert from "node:assert/strict";

import {
  ESPN_API_ORIGIN,
  ESPN_VIEWS,
  ConnectorInputError,
  buildEspnApiUrl,
  buildEspnLeaguePageUrl,
  isEspnPageUrl,
  isReadableLeaguePayload,
  isRosterLabPageUrl,
  normalizeLeagueReference,
  parseEspnLeagueReference,
} from "../lib/espn.js";

test("accepts only supported ESPN baseball pages", () => {
  assert.equal(
    isEspnPageUrl(
      "https://fantasy.espn.com/baseball/team?leagueId=123&teamId=4"
    ),
    true
  );
  assert.equal(
    isEspnPageUrl("https://www.espn.com/fantasy/baseball/"),
    true
  );
  assert.equal(
    isEspnPageUrl("https://www.espn.com/fantasy/football/"),
    false
  );
  assert.equal(
    isEspnPageUrl("https://www.espn.com.evil.example/fantasy/baseball/"),
    false
  );
  assert.equal(
    isEspnPageUrl(
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb"
    ),
    false
  );
});

test("accepts only the production RosterLab path", () => {
  assert.equal(
    isRosterLabPageUrl("https://www.joshuasuzuki.com/fantasy/"),
    true
  );
  assert.equal(
    isRosterLabPageUrl("https://joshuasuzuki.com/fantasy/index.html"),
    true
  );
  assert.equal(
    isRosterLabPageUrl("https://www.joshuasuzuki.com/admin/"),
    false
  );
  assert.equal(
    isRosterLabPageUrl(
      "https://www.joshuasuzuki.com/fantasy/connector/privacy.html"
    ),
    false
  );
  assert.equal(
    isRosterLabPageUrl("https://joshuasuzuki.com.evil.example/fantasy/"),
    false
  );
});

test("parses league, season, and team IDs from ESPN links", () => {
  assert.deepEqual(
    parseEspnLeagueReference(
      "https://fantasy.espn.com/baseball/team?leagueId=84721&seasonId=2026&teamId=9"
    ),
    {
      leagueId: "84721",
      season: "2026",
      teamId: "9",
    }
  );
  assert.deepEqual(
    parseEspnLeagueReference(
      "https://www.espn.com/fantasy/baseball/#/league?leagueId=42&season=2025",
      { defaultSeason: "2026" }
    ),
    {
      leagueId: "42",
      season: "2025",
      teamId: null,
    }
  );
  assert.equal(
    parseEspnLeagueReference("https://www.espn.com/fantasy/baseball/"),
    null
  );
});

test("builds a fixed ESPN API request with required views", () => {
  const url = new URL(
    buildEspnApiUrl({ leagueId: "84721", season: "2026", teamId: "9" })
  );
  assert.equal(url.origin, ESPN_API_ORIGIN);
  assert.equal(
    url.pathname,
    "/apis/v3/games/flb/seasons/2026/segments/0/leagues/84721"
  );
  assert.deepEqual(url.searchParams.getAll("view"), [...ESPN_VIEWS]);
});

test("builds an ESPN page URL without accepting arbitrary input", () => {
  assert.equal(
    buildEspnLeaguePageUrl({
      leagueId: "84721",
      season: "2026",
      teamId: "9",
    }),
    "https://fantasy.espn.com/baseball/team?leagueId=84721&seasonId=2026&teamId=9"
  );
  assert.throws(
    () =>
      normalizeLeagueReference({
        leagueId: "84721/../../account",
        season: "2026",
      }),
    ConnectorInputError
  );
});

test("requires a readable multi-team league payload", () => {
  assert.equal(isReadableLeaguePayload({ teams: [{}, {}] }), true);
  assert.equal(isReadableLeaguePayload({ teams: [{}] }), false);
  assert.equal(isReadableLeaguePayload({ message: "not authorized" }), false);
});
