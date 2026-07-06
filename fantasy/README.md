# RosterLab

RosterLab is a browser-based fantasy baseball trade analyzer. It ships with an
illustrative six-team league so every workflow is usable without an account.

## Included

- Team category ranks and priority needs for standard 5x5 roto scoring
- One-for-one trade matches scored for roster fit, value fairness, and likely
  partner interest
- A multi-player trade lab with category impact and acceptance estimates
- A searchable league-wide player market and local watchlist
- Public ESPN league import for rosters, standings, ownership, and available
  projections
- Source and model pages that distinguish connected data from demo fixtures

The analysis code is deterministic and runs in the browser. Saved scenarios,
watchlists, and imported public-league data stay in local storage.

## ESPN limits

ESPN does not publish a supported fantasy API. Its web endpoints may block
cross-origin browser requests, and private leagues require ESPN cookies. This
prototype intentionally does not ask for or store those cookies. A production
version needs a server-side connector with authenticated secret storage,
request retries, caching, and monitoring.

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
```
