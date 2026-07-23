# OPERATIONS.md — Phase 4: run this business in ≤3 hours/week

**Product:** SiteRamp (working name) · **Operator:** Joshua · **Written:** 2026-07-12
This file + `marketing/CONTENT.md` (all post drafts) + `app/RUNBOOK.md` (technical fixes)
are everything needed to operate. Read top to bottom once; then the weekly routine (§4) is
your only recurring obligation.

---

## 1. Distribution plan — channels ranked by expected return per operator-hour

Ranking logic: (audience density of freelance web pros × permission to sell × compounding
value) ÷ hours required. Channel members verified in Phase 1/4 research where noted.

| # | Channel | Why this rank | Hours/wk | Expected yield |
|---|---|---|---|---|
| 1 | **Warm outreach + free audit offer** (your 1st/2nd-degree network: agency owners, freelancers, ex-colleagues who run sites) | Highest conversion motion that exists: you personally send a branded PDF audit of *their client's* site — the product demos itself in the deliverable. Bounded, no algorithm, no moderation risk. | 1.0 | 20 sends/mo → expect 6–10 replies, 3–5 trials, 1–2 paid. First dollars come from here. |
| 2 | **LinkedIn under your own name** | Your existing professional identity (enterprise sales, security/infra credibility) is the moat no competitor copies. Agency owners and freelancers are dense on LinkedIn. Compounds: every post builds the audience that makes future launches cheaper. | 1.0 | Slow weeks 1–2, visible inbound by week 4–6 if consistent (3 posts/wk, drafts pre-written). |
| 3 | **Reddit value posts** — r/webdev (~3M), r/web_design, r/Wordpress, r/freelance | Where the niche literally gathers (verified member counts in RESEARCH.md). Strict anti-promo norms → post genuinely useful content (EAA explainer, audit findings write-ups); mention the tool only in comments when asked, or where rules allow. One good post can out-reach a month of LinkedIn. | 0.5 | Spiky: 0 or 300 visitors per post. 4 posts/mo pre-drafted. |
| 4 | **Launch platforms** — Product Hunt, Indie Hackers, r/SideProject | One-time spike + permanent backlinks + early-adopter feedback. Buyers here are tool-curious founders/freelancers, decent ICP overlap. Do it in week 3–4, after a few real users exist to leave comments. | one-time (~3h) | 100–500 visitors, a handful of trials, review-site seeds. |
| 5 | **Free-listing directories** — accessibility tool roundups, AlternativeTo, SaaSHub, a11y resource lists | 2 hours once, low ongoing value each, but they compound as SEO citations and "alternative to accessiBe/UserWay" queries are high intent. | one-time (~2h) | Trickle, forever. |
| 6 | **SEO/blog content** | The long-term winner in this category (every competitor's traffic is comparison content) but pays out in months, not weeks. Deferred to month 2+; BACKLOG has the keyword plan. | 0 now | n/a at launch |

Explicitly rejected: mass cold email (deliverability risk + time sink + brand damage in a
trust-sensitive category), paid ads before PMF (burns the budget cap for unvalidated copy),
Twitter/X (weak agency density relative to effort).

## 2. First 30 days of marketing — calendar

All drafts are ready to publish in **`marketing/CONTENT.md`** — mapped by ID below. Voice
rules baked into every draft: practitioner-to-practitioner, specific numbers, zero hype, name
the tool's limits out loud (the honesty *is* the positioning).

| Day | Action (content ID) | Channel |
|---|---|---|
| 1 | LI-1 "why I built this" + OUT-A × 5 sends | LinkedIn + warm outreach |
| 2 | DIR batch: submit 8 directories (list in CONTENT.md §5) | directories |
| 3 | LI-2 (EAA fines, plainly) | LinkedIn |
| 4 | RD-1 to r/webdev (EAA/ADA explainer, no product link in post) | Reddit |
| 5 | OUT-A × 5 | outreach |
| 8 | LI-3 (what an automated scan can/can't catch) | LinkedIn |
| 9 | OUT-B × 5 (follow-ups) | outreach |
| 10 | LI-4 (the overlay problem, FTC case) | LinkedIn |
| 11 | RD-2 to r/web_design ("I audited 25 small-agency sites — the same 6 failures every time") | Reddit |
| 12 | OUT-A × 5 | outreach |
| 15 | LI-5 (how to sell an accessibility audit to a client, script included) | LinkedIn |
| 17 | LI-6 (care-plan economics: turning $29 of tooling into $200/mo of retainer) | LinkedIn |
| 18 | RD-3 to r/freelance (pricing accessibility work) | Reddit |
| 19 | OUT-B follow-ups × 5 | outreach |
| 22 | **Product Hunt launch** (PH-1 copy pack) + LI-7 (launch post) + IH-1 | PH/IH/LinkedIn |
| 24 | LI-8 (what launch taught us — numbers, honest) | LinkedIn |
| 25 | RD-4 to r/Wordpress (WP accessibility gotchas from real scans) | Reddit |
| 26 | OUT-A × 5 to agencies that engaged with any content | outreach |
| 29 | LI-9 (case study #1 — first customer's before/after, with permission) | LinkedIn |
| 30 | Metrics review (§5) → decide month-2 plan | internal |

(LI-10/11/12 are spares in CONTENT.md for weeks when a planned post feels stale.)

## 3. Support playbook

**Channel:** one support email address, checked Mon/Wed/Fri (auto-reply promises answers
within 2 business days — under-promise, over-deliver). No live chat, ever — it's a 3h/week
business.

**Refund policy (customer-facing, already on the site):** any charge refunded on request
within 30 days, no questions. Rationale: a $29 refund costs less than 15 minutes of
back-and-forth, and refund-first generates the trust that this category's incumbents burned.

**Canned responses (paste, personalize one line, send):** full texts in CONTENT.md §6 —
(a) scan failed / bot protection → allowlist `SiteRampBot` steps, (b) "will this make us
ADA/EAA compliant?" → honest scope answer, (c) refund → instant yes + ask one optional
question, (d) feature request → thanks + BACKLOG + no promises, (e) "can you scan behind
login?" → not yet + workaround, (f) cancellation → portal steps + door open, (g) security
questionnaire → architecture one-pager pointer.

**Escalation rule:** anything requiring >20 minutes of investigation gets a refund/credit
first, then goes on the maintenance list — protect the weekly cap.

## 4. The weekly 3-hour operator routine

| Slot | Time | What (exact steps) |
|---|---|---|
| Mon | 45 min | Support inbox (canned responses). Then health: uptime monitor green? `systemctl status siteramp` OK? Backups fresh (`ls -lh data/backups/` — newest <48h)? Stripe dashboard: any disputes/failed payments? |
| Wed | 60 min | Marketing: publish this week's pre-drafted posts (§2 calendar), send 5 outreach messages, reply to every comment/DM from previous posts. |
| Fri | 45 min | Support inbox again. Metrics snapshot (§5 — one SQL command + Stripe MRR glance, log the 6 numbers in a note). |
| Flex | 30 min | Buffer: one small product/copy improvement from the feedback list, or nothing. Guard this — it's the overflow absorber, not a feature-building slot. |

Monthly extras (fold into a Fri slot): `apt upgrade` + `npm audit` on the VPS (RUNBOOK §
"Updating"), restore-test one backup quarterly, review ASSUMPTIONS.md tripwires.

## 5. Metrics — the numbers that decide scale vs kill

Collected in <10 minutes/week: one SQL block (below) + Stripe dashboard MRR. Log weekly.

| # | Metric | Healthy (day 60) | Kill-signal |
|---|---|---|---|
| 1 | New trials/week | ≥5 | <2/wk by day 30 with marketing executed → distribution problem: change channels before touching product |
| 2 | Trial→paid conversion (14-day lag) | ≥3% | <2% after 100 trials → per RESEARCH tripwire: reposition/reprice or pivot to runner-up (C2) |
| 3 | MRR | ≥$300 (≈10 Solo) by day 60 | <$100 by day 60 AND metric-1 healthy → product/pricing problem |
| 4 | Logo churn (monthly) | <8% | >15% for 2 consecutive months → value delivery problem (are scheduled scans landing?) |
| 5 | Scan success rate (pages ok ÷ pages attempted) | ≥80% | <60% → bot-blocking is eating the product (ASSUMPTIONS A-010); fix before spending another marketing hour |
| 6 | Support hours/week | <2h | >3h for 2 weeks → find the top ticket driver and automate/document it away that week |

```bash
# Weekly snapshot (run on the VPS)
sqlite3 /opt/siteramp/app/data/siteramp.db "
SELECT 'trials_7d', COUNT(*) FROM users WHERE created_at > strftime('%s','now','-7 days');
SELECT 'paying', COUNT(*) FROM users WHERE plan != 'trial' AND plan_status IN ('active','past_due');
SELECT 'scans_7d', COUNT(*) FROM scans WHERE created_at > strftime('%s','now','-7 days');
SELECT 'scan_success_pct', ROUND(100.0*SUM(pages_crawled-pages_failed)/NULLIF(SUM(pages_crawled),0),1)
  FROM scans WHERE status='done' AND created_at > strftime('%s','now','-7 days');
SELECT 'sites_monitored', COUNT(*) FROM sites WHERE schedule != 'off';"
```

**Review cadence:** weekly glance (Fri), monthly decision review, and a formal
**day-60 scale-or-kill review** against the table above.

### If the numbers are good — first three scaling levers (in order)

1. **Agency tier + annual billing** (≈2 days of build): $99–149/mo, 100 sites, scheduled
   monthly PDF email to end clients, custom domain for share links. Triggers: ≥3 Studio
   customers at the 30-site cap, or repeated "can you email my client directly" requests.
   Annual = 2 months free, only after first organic month-3 renewals.
2. **SEO content engine** (steady 2h/wk redirected from outreach): 2 posts/mo targeting
   the comparison and how-to keywords listed in BACKLOG (e.g. "accessibility audit template",
   "accessiBe alternatives", "EAA compliance checklist for agencies"), plus a free
   no-signup single-page scan as the lead magnet (rate-limited; build ≈1 day).
3. **White-label reseller motion** (zero build): the Studio tier already produces
   agency-branded reports — package a "reseller kit" page (suggested client pricing, a
   pitch-email template, a sample report) and pitch it through WP-maintenance and
   web-agency communities. Turns every customer into a distributor.

### If the numbers are bad — shutdown checklist (dignified, ~2 weeks elapsed, <4h work)

1. Log the decision + post-mortem in DECISIONS.md (what the metrics said, what we believe
   killed it, what transfers to the next attempt).
2. Disable new signups (config flag) and remove/annotate the landing CTA.
3. Email customers: 30 days notice, service until period end, all further charges stopped,
   final month refunded proactively, one-click data export offer (I provide a script that
   bundles each account's reports as PDFs + CSV).
4. Cancel all Stripe subscriptions at period end from the dashboard; refund the final month.
5. Day 30: final backup off-server (keep 90 days), replace app with a static thank-you page,
   power down the VPS. Keep the domain one renewal cycle (option value).
6. Total ongoing obligations after shutdown: $0/mo except the domain.
7. The runner-up candidate (RESEARCH.md C2) inherits the entire stack: auth, billing,
   crawling, PDF, deploy scripts — a restart is weeks, not months.
