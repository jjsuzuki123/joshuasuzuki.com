# RosterLab

RosterLab is a browser-based fantasy trade toolkit.

## Football (redraft calculator)

`/fantasy/football/` is a FantasyCalc-style redraft trade calculator. It does
**not** require ESPN or any league sync.

- League settings: size, PPR / half / standard, Superflex, TE premium
- Settings-aware player values from projected points + VORP, market anchors,
  and fixture quantitative / qualitative sources
- Two-sided trade calculator for multi-player packages
- **Roster-slot / consolidation math**: receiving more players pays a
  roster-space tax near replacement value; consolidating into fewer players
  earns a premium so “more players” is never a free win
- Rankings table that recomputes when settings change

Player values and source cards are model/fixture based, not a live trade
database and not a claim of FantasyCalc’s real-trade methodology.

## Baseball

The baseball app at `/fantasy/` is a category-league trade analyzer. It ships with an
illustrative six-team league so every workflow is usable without an account.

## Included

- Team category ranks and priority needs for standard or custom category scoring
- One-for-one and bounded two-for-one trade matches scored for both rosters
- A multi-player trade lab with category impact and partner-fit estimates
- Player search in the trade finder, both trade-lab rosters, and league market
- A league-wide player market and local watchlist
- Public and private ESPN league import for rosters, standings, ownership, and
  available projections
- Source and model pages that distinguish connected data from demo fixtures

The analysis code is deterministic and runs in the browser. Saved scenarios,
watchlists, and imported league data stay in local storage.

## ESPN limits

ESPN does not publish a supported fantasy API. Its web endpoints may block
cross-origin browser requests, and it offers no OAuth flow for fantasy leagues.
Public league URL imports use a fixed-purpose Lambda relay.

Private leagues can connect in two ways:
1. **Browser connector (preferred):** the optional RosterLab ESPN Connector for
   Chrome or Edge opens ESPN in another tab, reuses the browser session, and
   returns league data directly to RosterLab without reading cookies or sending
   credentials to a RosterLab server.
2. **Session-value relay:** users may provide `espn_s2` and `SWID` for one
   request through the Lambda relay. The app and relay do not store or log them,
   and the browser clears both fields after every attempt. Treat those values
   like passwords and use them only on a trusted device.

The importer accepts standard and custom rotisserie or head-to-head category
leagues. It reads ESPN's active categories, lower-is-better settings, and
projected stat lines before building team needs and trade scores. Points leagues
remain unsupported because they require a separate points-based valuation
model. Categories with unknown ESPN stat IDs or no available season data are
listed in the app and excluded from recommendations rather than estimated.

To connect a private league with the connector, install the extension, select
**Sync ESPN** in RosterLab, and choose **Connect with ESPN**. On the first
connection, sign in on ESPN and open the league you want. Later syncs use the
saved league and team IDs and finish in one click while the ESPN session remains
active.

For a public league (or private import via the relay), open any ESPN page inside
that league, copy its URL, select **Sync ESPN**, and paste the URL. The importer
extracts the league, team, and season IDs when ESPN includes them in the link.
If the link does not identify a team, choose yours from the team selector after
import.

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
standings movement. Multi-player packages use diminishing asset weights. The
engine trims overfull post-trade rosters, removes players below the roster
cutoff, and models replacement-level waiver additions for newly opened spots.
Package weights decay geometrically after the third asset, so even an 8-for-1
offer cannot manufacture value by stacking marginal players indefinitely. The
second and third assets retain more weight when they are independently elite
and close in quality to the package headliner, so two 90-level players are not
treated like one star plus ordinary depth.
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

Run the RosterLab tests from the repository root:

```sh
node scripts/fantasy-trade-engine.test.js
node scripts/fantasy-espn-client.test.js
node scripts/fantasy-espn-connector.test.js
node scripts/fantasy-source-client.test.js
node scripts/fantasy-private-import.test.js
node scripts/fantasy-relay-client.test.js
node --test scripts/fantasy-football-trade.test.js
npm test --prefix extensions/rosterlab-espn
npm run check --prefix extensions/rosterlab-espn
```
