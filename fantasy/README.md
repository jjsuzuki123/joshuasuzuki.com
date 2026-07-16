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
- ESPN lineup requirements and up to 100 highly rostered free agents or waiver
  players for league-specific replacement estimates
- ESPN injury designations and lineup-slot status in current-season player value
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
Head-to-head category leagues use category-strength and standings leverage as
an approximation; the model does not claim to simulate a particular future
weekly matchup.

To connect a supported league, open any ESPN page inside that league, copy its
URL, select **Sync ESPN** in RosterLab, and paste the URL. The importer extracts
the league, team, and season IDs when ESPN includes them in the link. If the
link does not identify a team, choose yours from the team selector after import.

FanGraphs, Baseball Savant, and RotoWire values in the demo are fixtures, not
live claims. Production evidence is accepted only from the configured
first-party source endpoint. The endpoint must label each feed as licensed,
official, or user-provided. RotoWire's commercial XML/JSON feeds require a
syndication agreement; the browser never scrapes RotoWire or stores provider
credentials. ESPN's undocumented news endpoints and Yahoo pages are not scraped.
An approved Yahoo OAuth integration or another licensed provider can be
normalized by the same endpoint.

## Model

Player value uses inputs that are actually present:

- 50% league market, ownership, or rank anchor
- 30% category production
- 20% connected projection and underlying-skill evidence
- duration-aware availability and dated role-news adjustments

Availability scales the complete current-season value instead of applying a
small flat deduction. A day-to-day player retains 93% of value, a generic ESPN
IL designation 65%, a 60-day or independently confirmed long-term injury 38%,
and a season-ending injury 8%. A structured expected-return date can reduce the
factor further when a long absence remains. Counting-category production is
scaled by the same factor, while rate-category sample weight is reduced, so an
injured player no longer contributes a healthy full-season line to a simulated
roster. These factors are decision-model estimates, not medical forecasts.

The team layer is separate. Strategy defaults to `Auto`. The engine infers a
punt only when a category is a clear performance outlier versus that team's
other categories and the gap to the next standings point is expensive relative
to the production one player can add. Category IDs and names do not affect the
decision. Managers can override Auto with `Compete`, `Focus`, or `Punt`. A punt
has zero weight in roster fit and trade recommendations, and the model
redistributes that weight across the remaining categories.

Every trade recomputes both teams' category totals and approximate rotisserie
points. Partner interest uses the other manager's category priorities,
roster-specific player value, package shape, star premium, and projected
standings movement. An ordinary second asset contributes 30% to package value,
an ordinary third contributes 15%, and later assets decay geometrically, so an
8-for-1 offer cannot manufacture value by stacking marginal players. The second
and third assets retain substantially more when they are independently elite
and close in quality to the package headliner, so two 90-level players are not
treated like one star plus ordinary depth.

The package-adjusted result is blended into both teams' roster-value decisions
instead of being used only for the fairness meter. The engine also trims
overfull post-trade rosters and removes players below the roster cutoff. For an
open spot it now uses the best position-compatible ESPN free agent when that
pool is available; otherwise it falls back to an estimate that becomes more
conservative as the league's rostered-player pool gets deeper. Imported lineup
slot counts set coverage requirements such as two-catcher formats.
Recommendations must clear minimum fairness and partner-interest thresholds.
The score is an explainable decision aid, not a claimed probability that
another manager will accept.

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
          "type": "injury",
          "summary": "Transferred to the 60-day injured list.",
          "impact": "injured",
          "injuryStatus": "60-day IL",
          "severity": "long-term",
          "ilDays": 60,
          "expectedReturn": "2026-08-15T00:00:00Z",
          "sourceUrl": "https://provider.example/player/101",
          "confidence": 0.95,
          "asOf": "2026-07-06T18:45:00Z"
        }
      ]
    }
  ]
}
```

The client rejects unsupported schema versions, unlicensed source labels,
unknown player IDs, unknown categories, oversized responses, and stale evidence
adjustments. It never matches a player by name alone. Ordinary headlines affect
the model for three days. Structured injury state can remain usable for up to
the reported return horizon (capped at 120 days), but only while the provider
source itself remains current. A non-injury role note cannot silently clear an
ESPN IL status.

Run the engine and ESPN parser tests from the repository root:

```sh
node scripts/fantasy-trade-engine.test.js
node scripts/fantasy-espn-client.test.js
node scripts/fantasy-source-client.test.js
node scripts/fantasy-private-import.test.js
node scripts/fantasy-relay-client.test.js
```
