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
- ESPN lineup requirements and up to 100 highly rostered free agents or waiver
  players for league-specific replacement estimates
- ESPN injury designations and lineup-slot status in current-season player value
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
Head-to-head category leagues use category-strength and standings leverage as
an approximation; the model does not claim to simulate a particular future
weekly matchup.

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

The optional Firecrawl research service searches a seven-day window across a
deployment allowlist that can include ESPN, Yahoo Sports, MLB, NBC Sports, CBS
Sports, and FantasyPros. Firecrawl runs only behind the AWS endpoint; its key is
stored in Secrets Manager. RosterLab does not call undocumented publisher APIs,
authenticated pages, or paywalled pages. A single media report is displayed
with its source link and supporting excerpt. Firecrawl-discovered web text is
always context-only and cannot alter player value; imported ESPN roster status
or an explicitly licensed structured feed must supply model-changing state.
Each refresh checks at most 12 relevant players. Active injuries, watchlist
players, open trade scenarios, and current trade targets come first. Cached
notes remain available for three days without another Firecrawl search.

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

## Evidence endpoint

Set `SOURCE_ENDPOINT` during deployment to write the primary endpoint into
`config.js`; `SECONDARY_SOURCE_ENDPOINT` preserves a licensed feed alongside
Firecrawl. RosterLab sends league/category metadata and player IDs, names,
MLB teams, roster ownership, availability, and value priority to that HTTPS
endpoint for at most 12 relevant players, with no ESPN session values. Relay
imports also attach a short-lived signed authorization that permits research
only for players returned by ESPN, but only when the operator supplies the
private research access code created by the AWS bootstrap stack.
The response uses schema version
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
          "modelEligible": true,
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
ESPN IL status. Set `modelEligible: false` for display-only reporting; it remains
cited in the UI but cannot change status or value. Firecrawl always emits that
display-only flag, together with `publisher`, `evidenceQuote`, `reportType`,
`corroborated`, and `publicationVerified`.

The included `fantasy-insights/` service fulfills this contract with a
cache-first API, DynamoDB, SQS, and up to two Firecrawl workers. One signed
import can queue at most 12 uncached players. The browser polls quietly while
cited results arrive. See
`fantasy-insights/README.md` for the source policy, daily
credit cap, AWS secret setup, and deployment switch.

Run verification from the repository root (RosterLab, sunset, admin syntax,
and the ESPN connector):

```sh
./scripts/verify.sh
# or
npm test
```
