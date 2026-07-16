# Cursor Analytics Canvas — Handoff

Customer-demo dashboard for the Cursor analytics suite. This version supersedes the
earlier local-only `cursor-model-usage.canvas.tsx` / handoff notes: the canvas now has a
real data pipeline, a daily refresh, correlation analysis, and Conversation Insights.

## What it is

- **Canvas**: `.cursor/canvases/cursor-model-usage.canvas.tsx` — a single-file Cursor
  canvas (imports only from `cursor/canvas`). Sections: freshness header, KPI strip,
  narrative insights, model usage, AI output & acceptance, **Conversation Insights**
  (intents / complexity / categories / guidance / work types / subcategories),
  **git-level AI code tracking** (suggestion → shipped code), **correlated signals**
  (Pearson r across daily series), workflow adoption (MCP / commands / skills / modes),
  people & environment, spend & Bugbot, and a methodology/data-lineage panel.
- **Data sidecar**: `cursor-model-usage.canvas.data.json` next to the canvas. The canvas
  reads it with `useCanvasState('dashboard', null)` and renders nothing invented — every
  number traces to an API response, and each section cites its endpoint.
- **Refresh script**: `scripts/cursor-analytics-refresh.mjs` (Node >= 18, zero deps).

## Data sources (most direct available — first-party Cursor APIs only)

| Canvas section | Endpoint | API |
| --- | --- | --- |
| DAU, KPI strip | `GET /analytics/team/dau` | Analytics API |
| Model usage | `GET /analytics/team/models` | Analytics API |
| Output & acceptance | `GET /analytics/team/agent-edits`, `GET /analytics/team/tabs` | Analytics API |
| Conversation insights | `GET /analytics/team/conversation-insights?include=intents,complexity,categories,guidanceLevels,workTypes` | Analytics API (Enterprise) |
| Suggestion → shipped code | `GET /analytics/ai-code/commits` | AI Code Tracking API (git-level, Enterprise alpha) |
| Adoption | `GET /analytics/team/{mcp,commands,skills,plans,ask-mode}` | Analytics API |
| People & environment | `GET /analytics/team/{leaderboard,client-versions,top-file-extensions}` | Analytics API |
| Bugbot | `GET /analytics/team/bugbot?prState=all` | Analytics API |
| Team size / spend | `GET /teams/members`, `POST /teams/spend` | Admin API |

Correlations and the "What the data says" insights are computed by the refresh script
from those responses (Pearson r over the daily series, n >= 8, evidence embedded in
every statement). Correlation rows are labeled strong / moderate / weak; treat weak as
noise.

## Refresh (set up once)

1. **Create the right key**: cursor.com/dashboard → API Keys → new key with **`admin:*`
   scope** on the Enterprise team you want to demo. User-scoped keys (the kind used for
   Cloud Agents, e.g. the one currently in Cloud Agents secrets) are rejected by the
   Analytics API with `Invalid Team API Key`.
2. **Install the daily job** (on the Mac you demo from, repo root):

   ```bash
   ./scripts/cursor-analytics-install-launchd.sh
   ```

   Stores the key in `~/.config/cursor-analytics/env` (chmod 600), installs a launchd
   job that runs **daily at 07:30 local + at login**, logs to
   `~/Library/Logs/cursor-analytics-refresh.log`, and runs the first refresh
   immediately.
3. **On-demand**: `/refresh-analytics` in Cursor chat, or
   `node scripts/cursor-analytics-refresh.mjs`.

The script writes the sidecar to both the repo (`.cursor/canvases/`) and the Cursor
managed canvases directory for this workspace
(`~/.cursor/projects/Users-josh-suzuki-joshuasuzuki-com/canvases/`), and syncs the
canvas source there too — so the canvas you already have open refreshes in place. The
header shows exact data age; if data is >26 h old a stale warning appears, so you'll
never unknowingly demo old numbers.

## Demo modes

- `--sample` — generates clearly-labeled, internally consistent demo data (no API
  calls, big "Sample data" banner). Safe when you can't show a real team.
- Anonymization is **on by default** (leaderboard/spend names become "Engineer 01…"),
  so real teammate emails never appear in front of customers. Use `--no-anonymize` for
  internal reviews.
- `--window <days>` — 7–30 day window (Analytics API caps ranges at 30 days).

## Privacy & safety

- This repo is **public** and deploys to a public S3 site. The data sidecar
  (`*.canvas.data.json`) is **gitignored**, and both `deploy.sh` and the GitHub Actions
  deploy exclude `.cursor/*` and `scripts/*` from the S3 sync — analytics data never
  leaves the laptop. That is also why the daily refresh runs locally via launchd rather
  than in GitHub Actions.
- Conversation Insights returns aggregates only (classification runs on-device); the
  canvas states this in the section caption.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Every source `401 Invalid Team API Key` | Key is user-scoped. Create an admin-scoped (`admin:*`) team key and update `~/.config/cursor-analytics/env`. |
| `missing required scope` | Key is a team key but lacks `admin:*` (or `read:*` for Bugbot reviews). Recreate with the right scope. |
| Conversation Insights `401`, rest ok | Insights disabled in team settings, or not an Enterprise team. Canvas renders the rest and marks the source in Methodology. |
| AI code section missing | AI Code Tracking is Enterprise alpha — ask your Cursor contact to enable it. Everything else still renders. |
| Canvas says "Data stale" | launchd job didn't run; check `~/Library/Logs/cursor-analytics-refresh.log`, or run `/refresh-analytics`. |

## Tests

`node --test scripts/cursor-analytics-refresh.test.mjs` — covers the math (Pearson),
the full transform pipeline, graceful degradation when sources fail, an end-to-end run
against a mock API with documented response shapes, the auth-failure path (exit 2,
never overwrites good data), and the `--sample` CLI.
