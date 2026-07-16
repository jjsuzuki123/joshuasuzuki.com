# refresh-analytics

Refresh the Cursor analytics canvas data from the live Cursor APIs, then report the result.

run:
node scripts/cursor-analytics-refresh.mjs

After it finishes:
1. Report how many sources succeeded (the script prints ok/ERR per source) and call out any errors with their remediation hints.
2. Confirm both sidecar paths that were written (repo `.cursor/canvases/` and the managed `~/.cursor/projects/<workspace>/canvases/` copy).
3. If every source failed with "Invalid Team API Key", remind me the key must be an admin-scoped team key (admin:* scope) from cursor.com/dashboard -> API Keys, stored in `~/.config/cursor-analytics/env` as `CURSOR_ADMIN_KEY=...`.

For a customer-safe demo without real team data, run `node scripts/cursor-analytics-refresh.mjs --sample` instead.

This command will be available in chat with /refresh-analytics
