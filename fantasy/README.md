# RosterLab

RosterLab is a browser-based fantasy baseball trade analyzer. It ships with an
illustrative six-team league so every workflow is usable without an account.

## Included

- Team category ranks and priority needs for standard 5x5 roto scoring
- One-for-one trade matches scored for roster fit, value fairness, and likely
  partner interest
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

ESPN has no OAuth flow for fantasy leagues, so a one-time session handoff is the
only practical web connection today. Users should treat both values like
passwords and use them only on a trusted device.

The importer accepts standard 5x5 rotisserie and head-to-head category leagues.
It rejects points leagues and custom category sets instead of grading them with
the wrong model.

To connect a supported league, open any ESPN page inside that league, copy its
URL, select **Sync ESPN** in RosterLab, and paste the URL. The importer extracts
the league, team, and season IDs when ESPN includes them in the link. If the
link does not identify a team, choose yours from the team selector after import.

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

Run the engine and ESPN parser tests from the repository root:

```sh
node scripts/fantasy-trade-engine.test.js
node scripts/fantasy-espn-client.test.js
node scripts/fantasy-private-import.test.js
node scripts/fantasy-relay-client.test.js
```
