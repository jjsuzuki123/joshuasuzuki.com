# LAUNCH.md — Phase 3: pricing, purchase flow, and the path to live

**Date:** 2026-07-12 · Product: SiteRamp (working name) · Status: everything below is ready
except items marked **[YOU]**, which are mirrored in HUMAN_ACTIONS.md.

---

## 1. Pricing recommendation

### Recommended: two flat monthly tiers, 7-day free trial without card

| Plan | Price | Limits | Intent |
|---|---|---|---|
| Trial | $0, 7 days | Solo limits | Prove value on their real client site fast; no card = no refund churn |
| **Solo** | **$29/mo** | 10 sites, 25 pages/scan, weekly monitoring, white-label PDF, share links | Freelancers with a handful of care-plan clients |
| **Studio** | **$59/mo** | 30 sites, 100 pages/scan, same features | Small agencies; the "we manage lots of client sites" tier |

**Justification against Phase 1 competitor data (all sources in RESEARCH.md):**

- Overlay widgets (the incumbent spend we're stealing): accessiBe $490–$950/yr **per site**,
  UserWay $49+/mo per site. One agency client's overlay budget pays for our whole Studio tier.
  Our pitch: "cancel one overlay, monitor your entire book of clients, honestly."
- Direct scanner competitors: A11yProof $29/mo (starter, single site) and $199/mo (agency,
  25 sites); AccessProof $0–49/mo; Pope Tech $25–30/mo for a 50-page pool. Our Solo matches
  the $29 psychological anchor while covering **10 sites**, and Studio at $59 delivers what
  the nearest agency plan sells for $199. We are the value leader without being the cheap
  option, and flat pricing (no per-page metering, no per-seat fees) is itself a
  differentiator every competitor's pricing page fails.
- Unit economics: hosting ~$6–15/mo total; marginal cost per customer ≈ pennies of compute.
  At 60% gross margin floor even with heavy scan usage, price is a positioning question, not
  a cost question.

### Cheaper-tier analysis ($19/mo) — considered, rejected

A $19 tier would sit below A11yProof's $29 single-site starter while offering 10 sites —
maximum undercut. Rejected because: (a) the buyer bills their *client* $300–$1,500 per audit;
$10/mo price sensitivity is not where this purchase decision lives, (b) cheap tiers attract
hobbyists who generate disproportionate support (violates the 3 h/week constraint), and
(c) with a genuinely free trial, price isn't the adoption barrier — proof on their own client
site is. Revisit only if trial→paid conversion is healthy but jailbreaks on price objections
(tracked in OPERATIONS.md metrics).

### Higher-tier analysis ($99–199/mo "Agency") — build later, not never

Price umbrella exists (A11yProof $199/25 sites; Silktide/Monsido far above). An Agency tier
(100 sites, scheduled PDF delivery to clients, custom domain for share links) is in
BACKLOG.md with triggers: ≥3 Studio customers hitting the 30-site cap or asking. Launching
with three tiers adds choice paralysis for zero day-one revenue.

### Model choices, stated plainly

- **Subscription, not one-time:** the durable value is *monitoring* (regression alerts,
  monthly re-audits). One-time purchase fights the product's core loop.
- **Monthly-only at launch:** annual plans complicate the refund-first policy and create
  liability before product-market fit is proven. Annual (2 months free) goes live only after
  the first organic month-3 renewals (BACKLOG).
- **Trial without card:** removes the #1 signup objection, guarantees zero surprise-charge
  refund tickets, and expired trials convert via a soft in-app wall (data preserved).
- **[YOU] Final pricing sign-off** is required before launch — HA-005.

---

## 2. Payment provider: decision and integration plan

### Recommendation: Stripe — direct Checkout now, with a Managed Payments decision at setup

Verified this session (sources in DECISIONS D-005): Stripe acquired Lemon Squeezy (2024);
**Stripe Managed Payments** — Stripe's own merchant-of-record product at 5% + $0.50 — went
public in Feb 2026 and is the successor; Lemon Squeezy is effectively in migration mode.
Paddle remains the mature independent MoR alternative.

**The actual choice is "merchant of record vs DIY tax," and it matters for you specifically:**

- You live in NYC → physical nexus in New York, and **NY taxes SaaS**. Selling direct means
  registering for a NY Certificate of Authority (free, ~30 min online), charging ~8.9% to NY
  buyers (Stripe Tax automates the math), and filing NY returns quarterly (~30–60 min each,
  even at $0). Other US states are far away ($100k–500k thresholds). EU B2C sales technically
  require VAT from the first sale for non-EU sellers; most of our buyers are businesses, but
  compliance-by-the-book with DIY tax is real ongoing admin.
- A merchant of record makes all of that Stripe's problem for ~2.1 extra points
  (5% + $0.50 vs 2.9% + $0.30 ≈ **$0.81/month extra per Solo customer**). For a 3-hour/week
  operator, that is cheap insurance.

**Decision tree for you at account-setup time (HA-004):**

1. Create the Stripe account. If **Managed Payments** is offered for your account and its
   checkout is compatible with standard Checkout Sessions (Stripe support can confirm in one
   question), enable it. Zero tax admin, keep all our code (I'll make any small API
   adjustments once you can see the dashboard).
2. If Managed Payments is unavailable/rejected for the business: launch **Stripe direct**
   (code is done and tested), register the NY Certificate of Authority before first sale
   (HA-006), enable Stripe Tax in monitoring mode, and revisit MoR at $2k MRR.
3. If Stripe rejects the business entirely (unlikely): Paddle is the fallback; I will rewrite
   the billing adapter for Paddle's overlay checkout + webhooks (about a day of work).

### What's already wired (Stripe direct, tested with signed test events)

- Checkout Sessions (subscription mode) for Solo/Studio with promotion-code support.
- Webhook endpoint `/webhooks/stripe`: signature verification against the raw body,
  idempotency by event id, handlers for `checkout.session.completed`,
  `customer.subscription.created/updated/deleted`, `invoice.payment_failed`
  (→ 7-day grace, then lockout with data preserved).
- Billing portal (card changes, cancellation, invoices) — one button in the app.
- Server-side entitlement enforcement at every feature gate, driven only by webhook state.

### What you create in the Stripe dashboard (exact steps, HA-004)

1. Products → create "SiteRamp Solo" with recurring price $29/mo USD → copy `price_…` id.
2. Products → create "SiteRamp Studio" with recurring price $59/mo USD → copy `price_…` id.
3. Developers → Webhooks → Add endpoint `https://APP_DOMAIN/webhooks/stripe`, subscribe to
   the five event types above → copy the signing secret `whsec_…`.
4. Developers → API keys → copy the secret key `sk_live_…`.
5. Put all four values in `/opt/siteramp/app/.env` (template lines are already there),
   set `BILLING_MODE=stripe`, remove `ALLOW_UNBILLED_PRODUCTION`, restart:
   `systemctl restart siteramp`.
6. Settings → Billing Portal → enable, allow plan cancellation.
7. Run one live test: subscribe with a real card on Solo, confirm plan flips in the app,
   then cancel via the portal and refund yourself in the dashboard.

---

## 3. Landing page and legal — status

- Landing page: **built and live in the app** (`/`). Headline states problem + outcome in
  plain language; sections: why-now (EAA/ADA, no fear-mongering), how it works, honesty box
  about the ~⅓ automated-coverage ceiling (our trust wedge), flat pricing, and an FAQ written
  to pre-empt the support tickets QA said we'd get (bot-blocked scans, page caps, "will this
  make me compliant?", refunds, data handling).
- Terms + Privacy: honest working drafts at `/legal/terms` and `/legal/privacy`, clearly
  marked as drafts. **[YOU]** accept them as-is for launch or run them past a lawyer (HA-008);
  also swap `SUPPORT_EMAIL` to the real support address in `.env`.
- No analytics on the site yet by design (privacy posture + simplicity). Plausible
  (~$9/mo) is a BACKLOG item if traffic data becomes a real need.

---

## 4. Name and domain

"SiteRamp" is a working name — collision-checked only informally. Buying a domain is yours
(HA-003). Shortlist in preference order, with a 10-minute check each (exact-name web search +
USPTO TESS quick search + the .com/.io availability):

1. **siteramp.com** — clean, descriptive-ish, ramp = accessibility metaphor.
2. **rampcheck.com** — verb-y, memorable.
3. **curbcheck.com** — nods to the curb-cut effect; practitioners will get it.
4. **a11yramp.com** — niche-legible (a11y = accessibility), narrower appeal.
5. **siteramp.io** — fallback TLD.

If the pick changes the name: it's one find-and-replace (`SiteRamp`) plus the `brand`
variable in `src/app.ts`, plus `BASE_URL`/Caddy config. Nothing else references the name.

---

## 5. Launch checklist (ordered; owner marked)

Pre-flight (can all happen in one sitting, ~2–3 hours of your time total):

1. **[YOU]** HA-001 Approve the Phase 1 pick (or veto — everything else pauses).
2. **[YOU]** HA-002 Decide repo home (keep in personal-site repo vs new private repo).
3. **[YOU]** HA-003 Buy the domain (~$12/yr). Registrar of your choice; Cloudflare Registrar
   is at-cost. Create an A record `app.DOMAIN` → VPS IP (after step 4).
4. **[YOU]** HA-007 Create a Hetzner (or equivalent) account, provision one CX22-class
   Ubuntu 24.04 VPS (~$8/mo), paste your SSH key.
5. **[ME]** Provide the exact deploy commands filled in with your domain (script is ready:
   `scripts/deploy-vps.sh`); walk the deploy; verify `/healthz`, run `scripts/smoke-test.sh`
   against production; add an uptime check target list.
6. **[YOU]** HA-009 Create a transactional email account (Resend free tier: 3k emails/mo,
   or Postmark $15/mo), verify the domain (SPF/DKIM records), put SMTP creds in `.env`.
7. **[YOU]** HA-004 Stripe account + §2 steps above (Managed Payments decision included).
8. **[YOU]** HA-005 Final pricing sign-off ($29/$59 as recommended, or your numbers).
9. **[YOU]** HA-008 Accept ToS/Privacy drafts (or lawyer pass).
10. **[YOU]** HA-010 Free external uptime monitor on `/healthz` (any provider's free tier).
11. **[ME]** Pre-launch QA on production: full smoke test, one real scan of a real site you
    own, PDF + share link check, Stripe live-mode test purchase + refund, backup cron
    verified (`data/backups/` populated next morning).
12. **[YOU]** HA-011 Green-light going public (this is the "any public action" escalation).
13. **[ME→YOU]** Execute the first-week distribution plan from OPERATIONS.md (content is
    pre-written; you post under your name).

Definition of "launched": a stranger can find the landing page, start a trial, scan a site,
pay with a card, and get a receipt — with no manual involvement from either of us.

---

## 6. Startup cost check (constraint: <$500 total, no recurring >$50/mo without sign-off)

| Item | Cost |
|---|---|
| Domain | ~$12/yr |
| VPS (Hetzner CX22-class) | ~$8/mo |
| Email (Resend free tier → Postmark $15/mo if needed) | $0–15/mo |
| Stripe | % of revenue only |
| Uptime monitor | $0 (free tier) |
| **Total pre-revenue** | **≈ $20–35 + ~$12 domain** — far under the ceiling; no single expense near $50/mo |
