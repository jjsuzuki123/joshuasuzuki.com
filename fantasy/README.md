# RosterLab

RosterLab is a browser-based fantasy baseball trade analyzer. It ships with an
illustrative six-team league so every workflow is usable without an account.

## Included

- Team category ranks and priority needs for standard or custom category scoring
- One-for-one trade matches scored for roster fit, value fairness, and likely
  partner interest
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
Public league URL imports use a fixed-purpose Lambda relay. Private leagues use
the optional RosterLab ESPN Connector for Chrome or Edge.

The connector opens ESPN in another tab, where the user signs in and chooses a
baseball league. It then requests that fixed league endpoint through the ESPN
session already held by the browser. It does not request cookie access, inspect
login fields, or send ESPN credentials or league data to a RosterLab server.
The extension returns the response directly to the originating RosterLab tab.

The importer accepts standard and custom rotisserie or head-to-head category
leagues. It reads ESPN's active categories, lower-is-better settings, and
projected stat lines before building team needs and trade scores. Points leagues
remain unsupported because they require a separate points-based valuation
model. Categories with unknown ESPN stat IDs or no available season data are
listed in the app and excluded from recommendations rather than estimated.

To connect a private league, install the extension, select **Sync ESPN** in
RosterLab, and choose **Connect with ESPN**. On the first connection, sign in on
ESPN and open the league you want. Later syncs use the saved league and team IDs
and finish in one click while the ESPN session remains active.

For a public league, paste any ESPN page URL from that league into the public
import form. If the link does not identify a team, choose yours from the team
selector after import.

FanGraphs, Baseball Savant, and RotoWire appear as modeled source adapters in
the demo. Their displayed values are fixtures, not live claims. Production use
requires approved API access or a data license.

## Model

The trade engine first builds a relative category profile for every team. It
then grades a proposal with:

- category gain weighted toward the receiving team's weakest categories
- total player-value fairness
- fit for the other manager
- roster-size and availability penalties
- market trend for upside-oriented searches

Run the connector tests from the repository root:

```sh
npm test --prefix extensions/rosterlab-espn
npm run check --prefix extensions/rosterlab-espn
node scripts/fantasy-espn-client.test.js
node scripts/fantasy-espn-connector.test.js
```
