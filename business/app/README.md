# SiteRamp

Accessibility scanning, monitoring, and white-label reports for web professionals.
One Node.js process, one SQLite file, one small server. Working name — rename is a
find-and-replace on "SiteRamp" plus the `brand` variable in `src/app.ts`.

## What it does

- Crawls a site (sitemap + internal links, capped by plan), loads each page in headless
  Chromium, and runs axe-core WCAG 2.1 A/AA checks.
- Produces an in-app report, a **white-label PDF** (agency name/logo/color), and revocable
  public share links.
- Rescans on a weekly/monthly schedule and emails when new issues appear.
- Stripe subscriptions (7-day free trial without card; Solo $29 / Studio $59).

## Run it locally (zero accounts required)

```bash
cd business/app
npm install
npx playwright install chromium   # one-time browser download
npm run seed                      # creates demo@example.com / demo-password-123
SCAN_ALLOW_PRIVATE=1 npm run dev  # http://127.0.0.1:3000
```

Log in with the seeded account, add any public website (or `http://127.0.0.1:<port>` of a
local fixture — allowed because of `SCAN_ALLOW_PRIVATE=1`, which production ignores), and
run a scan. Billing and email are disabled by default in development; banners in the UI say so.

## Tests

```bash
npm test                               # everything, including a real browser scan
SITERAMP_SKIP_BROWSER_TESTS=1 npm test # unit tests only (no Chromium needed)
npm run typecheck
bash scripts/smoke-test.sh             # end-to-end against a running server (BASE=... to point elsewhere)
```

## Configuration

Copy `.env.example` to `.env`. Everything is optional in development. Production requires
`SESSION_SECRET`, `BASE_URL`, and either full Stripe config (`BILLING_MODE=stripe`) or the
explicit `ALLOW_UNBILLED_PRODUCTION=yes` escape hatch. SMTP variables activate password
resets and scan-alert emails; without them those features degrade with honest UI copy.

| Area | Variables |
|---|---|
| Core | `NODE_ENV`, `HOST`, `PORT`, `BASE_URL`, `DATA_DIR`, `SESSION_SECRET`, `SUPPORT_EMAIL` |
| Billing | `BILLING_MODE`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_STUDIO` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| Scanner | `SCAN_PAGE_TIMEOUT_MS`, `SCAN_TOTAL_TIMEOUT_MS`, `SCAN_CONCURRENCY`, `SCAN_ALLOW_PRIVATE` (dev only) |

## Deploy (one VPS, ~$5–10/month)

Any Ubuntu 24.04 box with 2 GB RAM works (Hetzner CX22 class). DNS A record → server, then:

```bash
scp -r business/app root@server:/opt/siteramp/app
ssh root@server 'APP_DOMAIN=app.yourdomain.com bash /opt/siteramp/app/scripts/deploy-vps.sh'
```

The script installs Node 22 + Caddy (automatic HTTPS), Playwright Chromium, a systemd
service, and a nightly backup cron. Post-deploy checklist lives in `RUNBOOK.md`; Stripe
setup steps live in `../LAUNCH.md`.

Alternatives that also work: Fly.io or Railway with a persistent volume (set `DATA_DIR` to
the volume mount). Avoid serverless platforms — the scanner needs a persistent browser.

## Repo tour

```
src/
  server.ts        boot: config → db → services → HTTP → scheduler
  app.ts           Fastify app: sessions, CSRF, headers, errors, view engine
  config.ts        env parsing + production guardrails (fails loudly, early)
  db.ts            SQLite open + versioned migrations
  domain/          pure logic: plans/entitlements, scoring, diffs, report view-model, repo (all SQL)
  scanner/         crawler (fetch-based discovery), runner (Playwright + axe), in-process queue
  services/        auth, billing (Stripe), mailer (SMTP), pdf (Playwright print)
  routes/          public, auth, dashboard (sites/scans/shares), settings, billing+webhook
  views/           Nunjucks templates (server-rendered; app works without JS)
  public/          one CSS file, one small JS file, favicon
tests/             vitest: 140 unit/HTTP tests + a real-browser integration scan
scripts/           deploy-vps.sh, backup.sh, smoke-test.sh
```

More detail: `ARCHITECTURE.md` (how and why) and `RUNBOOK.md` (failures and fixes).
