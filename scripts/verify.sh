#!/usr/bin/env bash
# Local + CI verification. No AWS credentials or SAM CLI required.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required." >&2
  exit 1
fi

echo "==> Syntax check"
node --check fantasy/app.js
node --check fantasy/config.js
node --check fantasy/data.js
node --check fantasy/espn-client.js
node --check fantasy/espn-connector.js
node --check fantasy/source-client.js
node --check fantasy/trade-engine.js
node --check fantasy/football-data.js
node --check fantasy/football-value.js
node --check fantasy/football-trade.js
node --check fantasy/football/app.js
node --check fantasy-insights/service/core.js
node --check fantasy-insights/service/api.js
node --check fantasy-insights/service/worker.js
node --check fantasy-backend/import-league/index.js
node --check sunset/app.js
node --check sunset/score-engine.js
node --check admin.js
node --check admin-backend/admin-login/index.js
node --check admin-backend/admin-messages/index.js
node --check theme-init.js
node --check script.js

echo "==> Unit tests"
node scripts/fantasy-trade-engine.test.js
node scripts/fantasy-espn-client.test.js
node scripts/fantasy-espn-connector.test.js
node scripts/fantasy-source-client.test.js
node scripts/fantasy-insights.test.js
node scripts/fantasy-private-import.test.js
node scripts/fantasy-relay-client.test.js
node --test scripts/fantasy-football-trade.test.js
node scripts/sunset-score-engine.test.js

echo "==> ESPN connector"
npm run check --prefix extensions/rosterlab-espn
npm test --prefix extensions/rosterlab-espn

echo "==> Verify passed"
