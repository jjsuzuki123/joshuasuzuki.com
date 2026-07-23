# DECISIONS

Append-only log. Newest entries at the bottom. Every significant choice, the reasoning, and rejected alternatives.

---

## 2026-07-12 — D-001: Keep all business-builder work in `business/` on a feature branch

**Decision:** All files for this project live under `business/` in the operator's existing
personal-site repo (joshuasuzuki.com), on branch `cursor/business-builder-010d`.

**Reasoning:** The provided workspace is the operator's personal site. Mixing business files
into the site root risks accidentally deploying them (the site deploys from repo root via
`deploy.sh`). A subdirectory keeps a clean boundary; the product app itself will live in
`business/app/` and deploy separately from the personal site.

**Alternatives rejected:**
- New standalone repo — I cannot create GitHub repos (account action = human-only). Would stall Phase 1. Logged as an optional human action instead (migrate later if desired).
- Repo root — pollutes the personal site and its deploy pipeline.

---

## 2026-07-12 — D-002: Operator profile treated as scoring signal

**Decision:** Use the resume found in the repo (Fastly mid-market AE, MEDDPICC, CDN/WAF/edge,
NYC, enterprise motions, writes internal enablement) as the concrete definition of "operator
advantage" when scoring candidates. Per the brief, this is a scoring advantage, not a filter;
non-sales niches stay in the candidate pool.

**Reasoning:** The brief says to weigh "operator can personally validate demand and write
credible marketing." The resume gives specifics: he runs multi-stakeholder enterprise deals,
knows MEDDPICC/mutual-action-plan mechanics firsthand, and sells to engineering/security
buyers. Candidates where the buyer is "an AE like him" or "a developer-tools buyer he already
talks to" get real, not imagined, distribution advantages (his LinkedIn network, sales
communities, credible practitioner voice).

---

## 2026-07-12 — D-003: Phase 1 pick — accessibility scanning + white-label reports for freelance web professionals

**Decision:** Build Candidate 1 from RESEARCH.md: an automated website-accessibility scanner
(axe-core engine) with scheduled monitoring and agency-branded, client-ready reports, sold as
a flat-priced subscription to freelance web designers/developers and 1–10-person agencies.
Working name: **SiteRamp** (final name + domain = human action; shortlist in Phase 3).

**Reasoning (full memo in RESEARCH.md):**
1. Verified urgent demand with a regulatory driver (EAA enforceable since 2025-06-28; active
   enforcement since Nov 2025; ongoing US ADA litigation).
2. Verified price umbrella: overlays $490–$950+/yr/site (and publicly discredited — FTC $1M
   order against accessiBe, April 2025); enterprise scanners $199–$3,000+/yr; agency
   white-label plans priced ~$199/mo. A flat $29–49/mo undercuts everything while staying
   profitable.
3. Purest automation profile of any high-demand candidate → compatible with the 3h/week cap.
4. The output (branded audit report) is something the buyer resells — strongest
   willingness-to-pay structure available.
5. Runner-up (MAP tool for AEs) failed hard constraint #4 in spirit: individual seats are
   served free by funded vendors (Recapped/Dock/Aligned/Trumpet free tiers) and by
   spreadsheets; paying demand at the individual level would have to be invented.

**Alternatives rejected:** 13 other candidates, all scored in RESEARCH.md with evidence.
Closest: C2 MAP tool (30.5 vs 32.5) — kept as documented fallback/pivot.

**Strongest case against the pick** (recorded so a future session can re-evaluate honestly):
visible crowding by fresh indie entrants (A11yProof, AccessProof, Veracly, Webply all found
in one session); commodity scanning engine (axe-core); free substitutes for one-off checks
(WAVE, axe DevTools); crawling arbitrary sites is our biggest support risk. Mitigations and
kill-tripwires are listed at the bottom of RESEARCH.md.

**Escalation status:** Presented via HUMAN_ACTIONS HA-001. Operator unavailable this session;
per the brief, proceeding to Phase 2 with the pick. A veto later costs only build time; auth,
billing, crawling, and report plumbing would be reusable for the runner-up.

---

## 2026-07-12 — D-004: Stack — plain Node/TypeScript + Fastify + server-rendered views + SQLite, single process, single VPS

**Decision:** One Node 22 process: Fastify (HTTP) + Nunjucks server-rendered templates +
better-sqlite3 (WAL) + in-process scan queue + node-cron scheduler + Playwright Chromium +
axe-core. Deploy target: one small VPS (Hetzner CX22-class, ~$5–9/mo) behind Caddy
(automatic HTTPS). Tests: vitest.

**Reasoning:**
- The brief's allowed stacks include "plain Node backend + SQLite/Postgres." This is the
  most boring option that fits the workload.
- Scanning requires a persistent headless browser → serverless (Vercel/Netlify) is a bad
  fit; a VPS-style host is the natural home, and then SQLite removes an entire external
  dependency (no managed DB account, no connection pooling, trivial backups, and the local
  demo runs with zero setup — a Phase 2 deliverable).
- Write concurrency is tiny (one operator's customer base; scans write in one process).
  SQLite WAL handles this with headroom. If the business ever outgrows it, the storage layer
  is a single module to port to Postgres.
- Server-rendered templates + vanilla JS keep the dependency count and attack surface small
  and make the app maintainable by any stranger (per the docs constraint). No React/Next
  needed for a form-based dashboard.
- better-sqlite3's synchronous prepared statements give parameterized queries by
  construction (security constraint) and dead-simple transactional code.

**Alternatives rejected:**
- Next.js + Postgres on Vercel + Neon: two managed accounts, serverless/browser mismatch
  (would need a separate scan worker → violates "single deployable"), heavier deps.
- Python/FastAPI: fine, but axe-core's first-class integration is the JS Playwright package;
  one language everywhere (app + scan engine) is simpler.
- Postgres from day 1: adds an account + service for zero current benefit; revisit at scale.
- Fly.io/Railway PaaS: acceptable fallbacks (documented in README); Hetzner chosen for cost
  and absence of platform magic. Final hosting account creation is a human action regardless.

---

## 2026-07-12 — D-005: Pricing $29/$59 flat monthly; payments via Stripe (Managed Payments if available, direct otherwise)

**Decision:** Two flat tiers — Solo $29/mo (10 sites, 25 pages/scan) and Studio $59/mo
(30 sites, 100 pages/scan) — 7-day cardless trial, monthly-only at launch, refund-first.
Payment provider: Stripe. At account setup the operator checks whether **Stripe Managed
Payments** (Stripe's merchant-of-record product, GA/public since Feb 2026 at 5% + $0.50) is
available for the account; if yes, use it (zero sales-tax admin — relevant because the
operator has NY physical nexus and NY taxes SaaS); if not, launch Stripe direct (code built
and tested) + NY Certificate of Authority + Stripe Tax, and revisit MoR at $2k MRR.

**Reasoning:** Full analysis with competitor anchors and cheaper/higher-tier analysis in
LAUNCH.md §1–2. Key sources verified this session: Lemon Squeezy status post-acquisition
(operational but effectively migration-mode; Stripe Managed Payments is the successor —
devtonicstudios.com, cadence.withremote.ai, solooperatorstack.com) and NY SaaS taxability +
nexus rules (numeral.com, nexusbystate.com, hellobooks.ai).

**Alternatives rejected:** Lemon Squeezy (migration-mode risk for a brand-new account);
Paddle (solid fallback, but a second vendor relationship and a checkout rewrite when Stripe
covers both paths); $19 cheap tier and $99+ agency tier at launch (LAUNCH.md §1); annual
plans at launch (refund-liability before PMF); one-time pricing (fights the monitoring loop).
