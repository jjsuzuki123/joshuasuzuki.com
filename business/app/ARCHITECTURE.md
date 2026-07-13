# ARCHITECTURE.md — how SiteRamp works and why it's built this way

Audience: a developer who has never seen this codebase and needs to maintain it.
Read `README.md` first for setup; this file explains the moving parts and the reasoning.

## The one-paragraph version

A single Node.js process serves a server-rendered dashboard (Fastify + Nunjucks), stores
everything in one SQLite file (better-sqlite3, WAL mode), and runs website scans in-process:
a fetch-based crawler discovers same-origin pages, Playwright Chromium loads each page, and
axe-core evaluates WCAG 2.1 A/AA rules. Results are scored, diffed against the previous scan,
and rendered as HTML reports, branded PDFs (Playwright's PDF printer), and tokenized public
share pages. node-cron enqueues scheduled rescans. Stripe Checkout + webhooks drive the
`users.plan/plan_status` columns, and a pure function (`computeEntitlement`) turns those into
limits enforced at every entry point.

## Design decisions and their reasons

**Single process, no external queue.** Scan volume is bounded by the customer count of a
solo business; an in-process FIFO (one site at a time, 2 pages concurrently) is plenty and
removes Redis/worker infrastructure. Queue state *is* the `scans` table (`status='queued'`),
so restarts can't lose jobs invisibly — on boot, orphaned `queued/running` scans are marked
failed with a user-facing explanation ("interrupted by a server restart"), which is honest
and cheap. The tradeoff (scans pause during deploys) is acceptable at this scale.

**SQLite over Postgres.** One writer process, small data, and it makes local setup and
backups trivial (`sqlite3 .backup`, nightly cron, 30-day retention). WAL mode + 5 s busy
timeout handles the web/scanner interleaving. Every query in the app goes through prepared
statements in `domain/repo.ts` — the only file that talks SQL. If the business outgrows
SQLite, port that one file.

**Server-rendered pages, JS optional.** The dashboard is forms and tables. Nunjucks
templates + one CSS file keep the dependency tree small and the app fully functional with
JavaScript disabled; `public/app.js` only adds progress polling, copy buttons, and confirm
dialogs. This is also why CSP can be strict.

**Crawl with fetch, scan with a browser.** Page *discovery* uses plain `fetch` (fast, cheap,
no browser): sitemap.xml (+one level of sitemap indexes) seeds a BFS over `<a href>` links,
with URL normalization (fragments/tracking params stripped, slashes collapsed) for
de-duplication. Page *evaluation* needs real rendering, so Playwright loads each page
(`domcontentloaded` + a bounded `networkidle` wait) and `@axe-core/playwright` runs the
rules. Media/font requests are blocked for speed; CSS/JS/images load because axe evaluates
rendered output. The browser restarts between site scans to bound memory on a 2 GB box.

**SSRF defense in depth.** Users submit arbitrary URLs, so: (1) `parseTargetUrl` rejects
non-http(s), credentials, and dotless hosts at the form; (2) `assertPublicHost` resolves DNS
and rejects private/loopback/link-local/CGNAT/metadata/multicast ranges (IPv4 + IPv6 +
v4-mapped), re-checked at crawl time and on cross-host redirects; (3) the dev-only
`SCAN_ALLOW_PRIVATE=1` bypass is forced off in production by the config layer. Tests cover
the classifier and both enforcement points.

**Scoring is deterministic and explained in the report footer.** 100 minus per-rule
penalties (critical 12, serious 6, moderate 2, minor 0.5; repeat instances of the same rule
discounted to 25%), page scores averaged into the site score, letter grades on fixed bands.
No ML, no magic — an agency can explain it to a client, and two scans of the same site give
the same number.

**Issue identity and diffs.** An issue's fingerprint is
`sha256(len-prefixed ruleId | normalizedUrl | selector)`. Scans store all issues; the diff
against the previous *completed* scan produces `new/resolved` counts shown in the UI, the
report, and alert emails. Length-prefixing prevents crafted values from colliding across
field boundaries.

**Entitlements are one pure function.** `computeEntitlement(plan, status, trialEndsAt,
periodEnd, now)` returns active/reason/limits. It's called by the HTTP layer (adding sites,
enqueueing scans), the queue worker (re-checked at execution time), and the scheduler
(skips inactive accounts). Stripe webhooks are the only writer of plan fields; handlers are
idempotent via a `webhook_events` id table, and signatures are verified against the raw body.
`past_due` gets a 7-day grace window so a flaky card doesn't silently kill monitoring.

**Auth.** Argon2id password hashes; session tokens are 256-bit random values stored SHA-256
hashed with 30-day rolling expiry; login issues a fresh session (no fixation), password
change/reset revokes all other sessions. Login failure burns a real argon2 verify against a
dummy hash so timing doesn't reveal account existence, and all auth errors are deliberately
generic. CSRF uses the double-submit-cookie pattern on every mutating form plus an
Origin/Referer check; the Stripe webhook is exempt (signature-verified instead).

**Reports.** `domain/report.ts` builds one view-model consumed by three surfaces: the in-app
report page, the print template (`report-print.njk`, self-contained inline CSS), and the PDF
(same print template rendered via `page.setContent` + `page.pdf` — no network round-trip, no
auth plumbing; the logo is inlined as a data URI). ~17 common axe rules carry hand-written
plain-English "why it matters / how to fix" text aimed at the agency's client; unknown rules
fall back to axe's own description and help URL. Every surface carries the honesty box:
automated checks ≈ one-third of issues, not legal advice, not a certification.

**Error handling philosophy.** Per-page scan failures never fail a scan; each failed page
records a human-readable reason (timeout, DNS, HTTP status, bot-block suspicion, bad TLS).
A scan only fails wholesale when discovery fails or *every* page fails, and the failure text
tells the user what to do next (allowlist `SiteRampBot`, check the URL, try later). HTTP-side,
zod validates all input with inline messages; a global handler renders friendly 404/403/413/500
pages and logs the stack. Emails never throw into request paths.

## Data model (see `db.ts` for exact DDL)

`users 1—n sites 1—n scans 1—n scan_pages 1—n issues`, plus `sessions`, `password_resets`,
`share_links (token_hash, revocable)`, and `webhook_events (idempotency)`. All child rows
cascade on delete, so account deletion is one statement and actually deletes everything.
Migrations are a versioned array applied transactionally on boot; only ever append.

## Request lifecycles worth knowing

- **Manual scan:** POST `/sites/:id/scan` → entitlement + active-scan + rate-limit +
  robots checks → insert `scans(status=queued)` → `queue.poke()` → worker discovers pages →
  scans each page → inserts pages/issues → computes score + diff → `finishScan` → progress
  page polls `/scans/:id/status` every 3 s and reloads when done.
- **Scheduled scan:** cron tick (15 min) → `listSitesDueForScheduledScan()` (SQL does the
  due-date math; skips sites with active scans) → entitlement check → enqueue → on finish,
  `notifyScanFinished` emails scheduled-scan results (manual scans don't email — the user is
  watching).
- **Subscription:** POST `/billing/checkout` → Stripe Checkout → webhook
  `checkout.session.completed`/`customer.subscription.*` → verify signature → idempotency
  check → map price→plan, status→plan_status, store period end → entitlement changes
  everywhere instantly.

## Known limits (deliberate, documented for the next maintainer)

- One app instance. The in-memory rate limiter and in-process queue assume it. Scale-up path:
  move the queue to a second process reading the same DB (statuses already coordinate), or
  jump to Postgres + a real queue when revenue justifies it.
- No login-wall scanning, no per-path robots.txt nuance (root-disallow triggers an owner
  confirmation instead), JS-only navigation links that never appear in HTML may be missed.
- Playwright pins a Chromium; `npx playwright install chromium` must run on deploy (script
  does it). Renovate/dependabot should watch playwright + axe-core versions.
