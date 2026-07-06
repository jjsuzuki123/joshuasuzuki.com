# RosterLab

RosterLab is a browser-based fantasy baseball trade analyzer. It ships with an
illustrative six-team league so every workflow is usable without an account.

## Included

- Team category ranks and priority needs for standard or custom category scoring
- One-for-one and bounded two-for-one trade matches scored for both rosters
- A multi-player trade lab with category impact and partner-fit estimates
- Player search in the trade finder, both trade-lab rosters, and league market
- A league-wide player market and local watchlist
- Public ESPN league import for rosters, standings, ownership, and available
  projections
- Source and model pages that distinguish connected data from demo fixtures

The analysis code is deterministic and runs in the browser. Saved scenarios,
watchlists, and imported public-league data stay in local storage.

## ESPN limits

ESPN does not publish a supported fantasy API. Its web endpoints may block
cross-origin browser requests, and private leagues require ESPN session values.
RosterLab routes imports through a fixed-purpose Lambda relay. Private users
provide `espn_s2` and `SWID` for one request; the app and relay do not store or
log them. The browser clears both fields after every attempt.

ESPN has no OAuth flow for fantasy leagues, so handing an existing session to a
relay is the only practical web connection today. RosterLab uses the values
once, but ESPN may continue accepting them afterward. Users should treat both
values like passwords and use them only on a trusted device.

The importer accepts standard and custom rotisserie or head-to-head category
leagues. It reads ESPN's active categories, lower-is-better settings, and
projected stat lines before building team needs and trade scores. Points leagues
remain unsupported because they require a separate points-based valuation
model. Categories with unknown ESPN stat IDs or no available season data are
listed in the app and excluded from recommendations rather than estimated.

To connect a supported league, open any ESPN page inside that league, copy its
URL, select **Sync ESPN** in RosterLab, and paste the URL. The importer extracts
the league, team, and season IDs when ESPN includes them in the link. If the
link does not identify a team, choose yours from the team selector after import.

FanGraphs, Baseball Savant, and RotoWire values in the demo are fixtures, not
live claims. Production evidence is accepted only from the configured
first-party source endpoint. The endpoint must label each feed as licensed,
official, or user-provided. RotoWire's commercial XML/JSON feeds require a
syndication agreement; the browser never scrapes RotoWire or stores provider
credentials.

## Model

Player value uses inputs that are actually present:

- 50% league market, ownership, or rank anchor
- 30% category production
- 20% connected projection and underlying-skill evidence
- bounded adjustments for availability and dated role news

The team layer is separate. Each category can be set to `Compete`, `Focus`, or
`Punt`. A punt has zero weight in roster fit and trade recommendations. Focused
categories receive extra weight. Other categories use standings leverage, so a
small, recoverable gap matters more than a distant last-place category.

Every trade recomputes both teams' category totals and approximate rotisserie
points. Partner interest uses the other manager's category priorities,
roster-specific player value, package shape, star premium, and projected
standings movement. Recommendations must clear minimum fairness and partner
interest thresholds. The score is an explainable decision aid, not a claimed
probability that another manager will accept.

## Licensed evidence endpoint

Set `SOURCE_ENDPOINT` during deployment to write `sourceEndpoint` into
`config.js`. RosterLab sends league categories and provider IDs to that
HTTPS endpoint, with no ESPN session values. The response uses schema version
1:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-06T18:55:00Z",
  "sources": [
    {
      "id": "rotowire",
      "name": "RotoWire",
      "kind": "qualitative",
      "access": "licensed",
      "updatedAt": "2026-07-06T18:45:00Z"
    }
  ],
  "players": [
    {
      "externalIds": { "espn": "101" },
      "quantitative": [
        {
          "sourceId": "fangraphs",
          "overall": 84,
          "categoryScores": { "homeRuns": 88 },
          "confidence": 0.8,
          "asOf": "2026-07-06T18:30:00Z"
        }
      ],
      "qualitative": [
        {
          "sourceId": "rotowire",
          "type": "role",
          "summary": "Moved into a closing role.",
          "impact": 0.7,
          "confidence": 0.9,
          "asOf": "2026-07-06T18:45:00Z"
        }
      ]
    }
  ]
}
```

The client rejects unsupported schema versions, unlicensed source labels,
unknown player IDs, unknown categories, oversized responses, and stale evidence
adjustments. It never matches a player by name alone.

Run the engine and ESPN parser tests from the repository root:

```sh
node scripts/fantasy-trade-engine.test.js
node scripts/fantasy-espn-client.test.js
node scripts/fantasy-source-client.test.js
node scripts/fantasy-private-import.test.js
node scripts/fantasy-relay-client.test.js
```
