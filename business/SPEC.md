# SPEC.md — SiteRamp MVP (working name)

**Date:** 2026-07-12 · Phase 2 · Owner: builder agent
**Product:** Automated website accessibility scanning, monitoring, and white-label reporting
for freelance web professionals and small agencies.

## 1. The one promise

> Add a client's website. In minutes, get a prioritized accessibility report you can put your
> own logo on and hand to your client — and never let the site regress silently again.

Everything in the MVP serves that promise. Everything else is cut (see §9).

## 2. Users and jobs

- **Primary buyer/user:** freelance web designer/developer or 1–10-person agency.
  - Job 1: "Client asked about accessibility/EAA/ADA — I need a credible answer this week."
  - Job 2: "I want to sell an accessibility audit + remediation project. Give me the artifact."
  - Job 3: "I maintain 10 client sites. Tell me when something regresses, cheaply."
- **Secondary reader (not a user):** the agency's client, who receives the branded report.
  The report must read as professional, plain-English, and honest.

## 3. MVP feature list (build order)

1. **Accounts:** email + password signup, login, logout. Argon2id hashing. Session cookie
   (random 256-bit id, SHA-256-hashed at rest, httpOnly, SameSite=Lax, Secure in prod,
   30-day rolling expiry). Password reset via emailed token — active only when SMTP is
   configured, otherwise the page explains support-assisted reset (support email).
2. **Branding settings:** agency name, accent color, logo upload (PNG/JPEG only, ≤1 MB,
   magic-byte validated, stored on disk). Used in app-generated reports.
3. **Sites:** add up to plan limit. URL is validated, normalized to an origin + start URL.
   Per site: client label, scan schedule (off / weekly / monthly).
4. **Scanning engine:**
   - Crawler: start URL + same-origin `sitemap.xml` seeds, BFS over same-origin links,
     de-duplicated after URL normalization (strip fragments/tracking params), page cap by
     plan. `robots.txt` disallow → warn user, require explicit "I own/manage this site"
     override per site.
   - Renderer: Playwright Chromium, one browser, ≤2 concurrent pages, 30 s per-page budget;
     media/font requests blocked for speed (CSS/JS/images load normally).
   - Checks: axe-core (via `@axe-core/playwright`), WCAG 2.1 A/AA rule tags recorded.
   - Output per page: violations (rule, impact, selector, HTML snippet, help URL, WCAG tags)
     or a plain-English failure reason (DNS, timeout, HTTP status, bot-block suspicion).
   - **SSRF guard:** scan targets resolve to public IPs only. Private/loopback/link-local/
     metadata ranges are refused at submission AND re-checked at fetch time (redirects
     included). Unit-tested.
   - Queue: in-process FIFO, one site-scan at a time, 2 page-workers within it. Queued scans
     show position. Process restart marks orphaned "running" scans failed with a clear message.
5. **Scores and diffs:** deterministic "SiteRamp Score" 0–100 per page (weighted by
   violation impact), site score = mean of page scores, letter grade bands. Diff vs previous
   completed scan: new / resolved / persisting issues via fingerprint
   `hash(ruleId + normalizedUrl + selector)`.
6. **Reports:**
   - In-app report page (issues grouped by severity → rule → pages, with fix guidance text
     and WCAG references, "Top fixes first" section).
   - **White-label PDF export** (print-styled route rendered to PDF by Playwright): agency
     logo/name/color, "Prepared for {client}", executive summary in plain English, score,
     severity breakdown, top fixes, per-page appendix, and an honesty box: automated checks
     find only ~30–40% of WCAG issues; this is not legal advice; manual review recommended.
   - Revocable public share link (`/r/{128-bit token}`, `X-Robots-Tag: noindex`).
7. **Monitoring:** scheduler tick every 15 min enqueues due scans (weekly/monthly since last
   completed scan) for active subscriptions; email on completion when new issues > 0 (or
   first scan), env-gated on SMTP.
8. **Billing (env-gated):** Stripe Checkout subscriptions by default (provider adapter kept
   thin; Phase 3 finalizes Stripe vs merchant-of-record and can swap). Plans:
   - **Trial** — 7 days from signup, no card: Solo limits.
   - **Solo $29/mo** — 10 sites, 25 pages/scan, weekly monitoring.
   - **Studio $59/mo** — 30 sites, 100 pages/scan, weekly monitoring, (same features, bigger limits).
   Enforcement server-side at: site creation, scan enqueue, crawler page cap, scheduler.
   Webhooks: `checkout.session.completed`, `customer.subscription.updated`, `…deleted` →
   entitlement rows; signature verified; idempotent. Billing portal link for card/cancel.
   Without Stripe env vars the app runs in **unbilled dev mode** with a visible banner
   (makes the local demo runnable with zero accounts).
9. **Account deletion:** self-serve, deletes all user data (sites, scans, issues, logo),
   notes that any active subscription is cancelled via the billing portal first (linked).

## 4. Explicit cut list (BACKLOG.md holds these)

- Anonymous "free scan" lead-magnet widget on the landing page (abuse surface; add post-launch with rate limits).
- Teams/multi-user workspaces, roles.
- Scheduled PDF email delivery to end clients; custom domains for share links.
- Fix-verification mode ("re-check just this issue"), CI integration, API.
- Auth-wall scanning (login flows), multi-language reports, Lighthouse/performance checks.
- Accessibility statement generator (v1.1 candidate — high value, small build).
- Annual pricing, coupons, usage-based tiers.

## 5. Architecture and stack (justification in DECISIONS.md D-004)

- **Runtime:** Node 22 + TypeScript. Single process: Fastify HTTP + in-process scan queue +
  node-cron scheduler. One deployable unit, one VPS.
- **Views:** server-rendered Nunjucks templates + one hand-written CSS file + ~100 lines of
  vanilla JS (scan-status polling, small UX niceties). No frontend framework.
- **DB:** SQLite via better-sqlite3 (WAL). All access through prepared statements
  (parameterized by construction). Nightly `sqlite3 .backup` script + optional Litestream
  (documented in RUNBOOK).
- **Browser:** Playwright Chromium (pinned), shared instance, restarted between site scans.
- **Email:** nodemailer over SMTP, env-gated; all sends wrapped so failures never break requests.
- **Payments:** Stripe SDK; webhook route uses raw-body signature verification.
- **Dependency budget (each earns its place):** fastify, @fastify/{cookie,formbody,multipart,
  static,view}, nunjucks, better-sqlite3, playwright, @axe-core/playwright, axe-core, zod,
  argon2, stripe, nodemailer, node-cron. Dev: typescript, tsx, vitest, @types/*. Nothing else.

## 6. Data model

```
users(id PK, email UNIQUE, password_hash, agency_name, accent_color, logo_path,
      plan ['trial','solo','studio'], plan_status ['trialing','active','past_due','canceled'],
      trial_ends_at, stripe_customer_id, stripe_subscription_id, current_period_end,
      created_at)
sessions(id PK, user_id FK, token_hash UNIQUE, expires_at, created_at)
password_resets(id PK, user_id FK, token_hash, expires_at, used_at)
sites(id PK, user_id FK, name, origin, start_url, schedule ['off','weekly','monthly'],
      robots_override INT, created_at)          -- UNIQUE(user_id, origin)
scans(id PK, site_id FK, status ['queued','running','done','failed'], trigger ['manual','scheduled'],
      started_at, finished_at, pages_crawled, pages_failed, score, grade,
      counts per impact, new_issue_count, resolved_issue_count, error_message, created_at)
scan_pages(id PK, scan_id FK, url, status ['ok','failed'], fail_reason, score,
           counts per impact)
issues(id PK, scan_id FK, page_id FK, fingerprint, rule_id, impact, selector,
       snippet, help_url, wcag_tags, description)   -- INDEX(scan_id, fingerprint)
share_links(id PK, scan_id FK, token_hash UNIQUE, created_at, revoked_at)
```

## 7. Error handling & security requirements (non-negotiable checklist)

- zod-validated forms; inline field errors; nothing 500s on bad input.
- Global error handler → friendly 500 page, structured log line; 404 page.
- Per-page scan failures never fail the whole scan; every failure has a user-readable reason.
- Rate limiting (in-memory, per-IP and per-account) on login, signup, forgot-password, scan
  enqueue, and share-link creation.
- CSRF: token per session on all mutating forms + Origin/Referer check. Webhook exempt
  (signature-verified instead).
- Security headers (CSP for app pages, nosniff, frame-deny, referrer-policy).
- SSRF guard as in §3.4. Upload validation as in §3.2 (magic bytes, size, extension allowlist).
- Secrets only via env (`.env` git-ignored, `.env.example` committed). `npm audit` clean
  (no high/critical) before launch.
- Session fixation avoided (new session id at login); logout destroys server-side session.

## 8. Testing requirements

Unit (no browser needed): URL normalization & same-origin rules · SSRF IP classification
(incl. IPv6-mapped, decimal-encoded) · crawler link extraction + page-cap logic (HTML fixtures,
fetch stubbed) · scoring + grade bands · issue fingerprint + diff · entitlements (plan caps,
trial expiry, canceled sub) · auth flows (signup/login/session expiry) via fastify inject ·
Stripe webhook signature + event idempotency (stripe lib construct) · report view-model builder.
Integration (needs Chromium; auto-skips if `SITERAMP_SKIP_BROWSER_TESTS=1`): scan a fixture
site served in-process; assert violations found, score computed, PDF bytes produced.

Exit for Phase 2: all tests green; hostile-user QA checklist (bad URLs, huge sites, dead
domains, robots-blocked, expired trial, no-JS forms misuse, double-submits) passes; docs
(README/ARCHITECTURE/RUNBOOK) complete.

## 9. Non-goals restated

No microservices, no external queue, no Kubernetes, no multi-cloud, no admin panel (SQLite +
RUNBOOK queries are the admin panel), no feature that implies recurring manual operator work.
