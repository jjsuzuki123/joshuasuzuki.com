# RESEARCH.md — Phase 1: Candidate Problems, Evidence, Scores, Recommendation

**Date:** 2026-07-12 · **Researcher:** builder agent, session 1
**Method:** Every pricing and complaint claim below was checked this session via live web search.
Primary sources (vendor pricing pages) are marked ⭐; secondary sources (comparison articles,
review aggregators) are plain links. Anything I could not verify directly is flagged and also
logged in ASSUMPTIONS.md.

---

## RECOMMENDATION MEMO (read this first)

### The pick: Candidate 1 — Automated accessibility scanning + white-label reports for freelance web professionals and small agencies

**One-line:** A flat-priced web app that scans client websites for WCAG accessibility issues
(axe-core engine), tracks them over time, and produces agency-branded, client-ready reports —
sold to freelance web designers/developers and 1–10-person agencies who now inherit
accessibility obligations from every client they build sites for.

**Why this one, in order of weight:**

1. **Demand is verified, urgent, and regulatory — not invented.** The European Accessibility
   Act became enforceable 2025-06-28. First enforcement actions were filed in France in Nov
   2025 (Auchan, Carrefour, E.Leclerc, Picard); Germany has an active wave of competitor
   cease-and-desist letters (Abmahnungen) against small e-commerce shops; the Netherlands
   publishes a non-compliance list ([webply.io](https://webply.io/blog/eu-accessibility-act-fines-2026),
   [adatitleiii.com](https://www.adatitleiii.com/2025/08/european-accessibility-act-poses-new-challenges-for-us-companies-with-customers-in-the-eu/)).
   US ADA Title III web lawsuits continue independently. Agencies "inherit the obligation, and
   it almost always rolls back to the agency that built the site" (webply). 2026 is the first
   full year of supervision. People are paying for solutions *today* (see pricing below).

2. **A fat, documented price umbrella with a trust vacuum under it.** Overlay vendors charge
   $49–$199/site/month (accessiBe ⭐$490–$950/yr/site; UserWay $49–$249/mo) and are publicly
   discredited — the FTC fined accessiBe **$1M (order finalized April 2025)** for deceptive
   compliance claims. Real scanners at the low end: Pope Tech ⭐$25–30/mo (50-page tier,
   education-focused), Silktide ~$199+/yr, Monsido ~$3k+/yr enterprise. Agency-specific
   white-label scanning is priced high (e.g. A11yProof advertises $199/mo for a 25-site agency
   plan). A flat ~$29–49/mo multi-site product with honest positioning undercuts all of it.

3. **Pure automation = solo-maintainable.** Crawl, scan, diff, report, email. No manual
   fulfillment anywhere in the loop. Support surface is bounded (crawl edge cases) and
   mitigable with good error messages and page caps.

4. **The deliverable is billable, which motivates purchase.** Like white-label SEO reports
   (AgencyAnalytics' whole business), the agency resells the report to their client at
   $300–$1,500 as an "accessibility audit" or bakes monitoring into care plans. Our $29/mo is
   an input to their revenue, not a cost center. That is the strongest possible willingness-to-pay
   structure for a micro-SaaS.

5. **Operator fit is real, if not maximal.** Joshua sells CDN/WAF/edge security — his daily
   job is translating technical risk into business cases for non-technical buyers. That is
   exactly the register of accessibility-compliance marketing ("quantified risk, honest scope,
   no FUD"). It is not his personal network (that would be sales tooling), but the channels
   are open communities (r/webdev, r/web_design, WP/agency communities, LinkedIn) where
   credible practitioner content wins.

### The strongest case AGAINST this pick (steelman)

1. **The gold rush is visible.** In one research session I found four recent indie entrants
   attacking the same wedge: A11yProof ($29/mo), AccessProof ($0–49/mo), Veracly, Webply. The
   EAA deadline is drawing builders. Differentiation must come from the agency-deliverable
   focus (reports designed to be resold, not just issue lists), flat multi-site pricing, and
   distribution execution — not from the scanning engine, which is commodity (everyone uses
   axe-core or WAVE).
   *Mitigation:* niche down explicitly to freelancers/small agencies and make the branded
   client-facing report the hero feature. Most competitors lead with "compliance for site
   owners" instead.
2. **Automated scanning has a value ceiling and free substitutes.** axe DevTools browser
   extension and WAVE are free for one-off manual checks; automated tools catch only ~30–40%
   of WCAG issues (a fact every serious source repeats). If buyers ever internalize "scans are
   commodity," price pressure follows.
   *Mitigation:* we sell the *workflow* (multi-site scheduling, history, diffs, branded
   reporting, statement generator), not the scan. Honesty about the 30–40% ceiling is itself
   the trust wedge against overlay vendors' lies — and it pre-empts refunds.
3. **Crawling arbitrary websites is the highest-support-burden thing on our shortlist.**
   JS-heavy SPAs, cookie walls, geo-blocks, bot protection (Cloudflare) will produce "why did
   my scan fail" tickets.
   *Mitigation:* page caps, per-page failure reasons in plain English, sitemap+manual URL
   modes, and a refund-first policy. Budgeted at ≤2 of the 3 weekly operator hours early on.
4. **Operator is not from the agency world.** He can't post "as an agency owner."
   *Mitigation:* practitioner voice as a *seller of web infrastructure* ("what the EAA
   actually requires, minus the fear-mongering") plus product-led content (free single-page
   scan as lead magnet).

### The runner-up (build this if the pick dies)

Candidate 2 (mutual-action-plan tool for individual enterprise AEs) scored a close second on
raw points — it has the best operator advantage of anything on the list and the simplest
build — but it fails the *spirit* of hard constraint #4: individual AEs demonstrably get MAP
tooling **free** today (Recapped free tier: 1 user / unlimited rooms; Dock free: 50
workspaces; Aligned free starter; Trumpet free pods; plus Google Sheets templates from every
vendor). Teams pay; individuals mostly don't. Full analysis below. It stays on file as the
fallback because the operator's distribution there is genuinely unfair.

### Decision status

Presented to operator via HUMAN_ACTIONS.md HA-001. Per the brief ("proceed with the top pick
after presenting it if I am unavailable"), Phase 2 proceeds on Candidate 1 now; a veto costs
us only the build time spent, and most infrastructure (auth, billing, crawling) would be
reusable for the runner-up anyway. Logged in DECISIONS.md D-003.

---

## Scoring rubric

Six dimensions, 1–5 each. Weights reflect the hard constraints: demand evidence and the
60-day-revenue clock are weighted highest, alongside support burden (the 3-hour/week cap is a
hard constraint, so a high support burden kills silently).

| Dimension | Weight | 5 means | 1 means |
|---|---|---|---|
| Demand evidence | ×2.0 | Multiple named competitors with public pricing AND urgent external driver | Plausible but unproven demand |
| Competitor gap clarity | ×1.5 | Documented complaints + obvious underserved segment | Gap already filled by cheap/free options |
| Build simplicity | ×1.0 | CRUD app, no third-party APIs | Heavy integrations / platform-permission walls |
| Support burden (5 = very low) | ×1.5 | Set-and-forget, few failure modes | Per-customer configuration or fragile inputs |
| Operator advantage | ×1.0 | Operator is the ICP with owned distribution | No relevant knowledge or channels |
| Time to first dollar | ×1.5 | Buyers actively searching now, short eval | Requires SEO ramp or education |

**Max score = 42.5**

## Score table (sorted)

| # | Candidate | Demand ×2 | Gap ×1.5 | Build ×1 | Support ×1.5 | Operator ×1 | TTFD ×1.5 | **Total** |
|---|---|---|---|---|---|---|---|---|
| C1 | Accessibility scans + white-label reports for web freelancers/agencies | 5 | 4 | 3 | 3 | 3 | 4 | **32.5** |
| C2 | Mutual-action-plan tool for individual AEs | 4 | 2 | 4 | 4 | 5 | 3 | **30.5** |
| C3 | Email-to-structured-data parser (lite) | 4 | 3 | 3 | 2 | 1 | 3 | **24.0** |
| C5 | Onboarding checklist widget for indie SaaS | 4 | 3 | 3 | 2 | 2 | 2 | **23.5** |
| C7 | PDF generation API (lite) | 4 | 2 | 3 | 3 | 2 | 2 | **23.5** |
| C11 | Waitlist + referral tool | 3 | 1 | 4 | 4 | 2 | 2 | **22.5** |
| C9 | Testimonial collection tool | 4 | 1 | 3 | 3 | 2 | 2 | **22.0** |
| C10 | Feedback board (lite) | 4 | 1 | 3 | 3 | 2 | 2 | **22.0** |
| C8 | OG-image / screenshot API | 3 | 2 | 3 | 3 | 2 | 2 | **21.5** |
| C4 | App-review monitoring for indie mobile devs | 3 | 3 | 2 | 2 | 1 | 3 | **21.0** |
| C12 | Uptime/SSL monitoring for freelancers with client sites | 4 | 1 | 3 | 3 | 2 | 1 | **20.5** |
| C6 | Client reporting for solo marketing/SEO consultants | 4 | 3 | 1 | 2 | 2 | 1 | **20.0** |
| C13 | WordPress care-plan reports | 4 | 1 | 2 | 2 | 1 | 2 | **18.5** |
| C14 | Cron-job monitoring | 3 | 1 | 3 | 3 | 2 | 1 | **18.5** |

---

## Candidate detail

### C1 — Accessibility scanning + white-label reports for freelance web professionals ⭐ PICK

- **Niche:** Freelance web designers/developers and 1–10-person agencies who build and
  maintain client marketing/e-commerce sites, selling accessibility audits and monitoring as
  part of care plans. NOT enterprise compliance teams, NOT site owners directly (they arrive
  later via the agencies).
- **Problem:** Clients now ask "are we accessible / are we exposed?" (EAA in force since
  June 2025, ADA suits ongoing). Agencies need (a) a quick credible audit artifact they can
  bill for, (b) ongoing monitoring so sites don't regress, (c) white-label so it carries
  their brand. Existing options are either discredited overlays, enterprise-priced scanners,
  or free single-page tools with no workflow.
- **Demand evidence (all checked this session):**
  - Regulatory driver: EAA enforceable 2025-06-28; French enforcement actions Nov 2025;
    German Abmahnung wave vs small shops; NL non-compliance list.
    Sources: [webply.io/blog/eu-accessibility-act-fines-2026](https://webply.io/blog/eu-accessibility-act-fines-2026),
    [adatitleiii.com](https://www.adatitleiii.com/2025/08/european-accessibility-act-poses-new-challenges-for-us-companies-with-customers-in-the-eu/),
    [veracly.app/blog/eaa-compliance-smb](https://veracly.app/blog/eaa-compliance-smb)
  - Paid competitors with public pricing: accessiBe ⭐ widget $490–$950/yr/site, managed
    $1,188–$5,940/yr ([ratedwithai.com](https://ratedwithai.com/blog/accessibe-pricing-2026));
    UserWay $49–$249/mo ([ratedwithai.com](https://ratedwithai.com/blog/userway-pricing-review-2026));
    Pope Tech ⭐ $25/mo annual for 50-page tier ([pope.tech/websites/pricing](https://www.pope.tech/websites/pricing));
    Silktide ~$199–990/yr, Monsido ~$3,000+/yr
    ([access-proof.com buyer's guide](https://access-proof.com/blog/overlay-widgets-vs-real-wcag-scanners));
    A11yProof $29/mo starter, $199/mo agency/25 sites ([a11yproof.com](https://a11yproof.com/compare/versus/userway-vs-accessibe/)).
  - Complaint/gap evidence: FTC $1M order against accessiBe finalized April 2025 for
    deceptive "automatic compliance" claims ([hounder.co](https://hounder.co/the-dog-bowl/accessibe-vs-audioeye-vs-userway-vs-equalweb-honest-comparison-public-agencies));
    overlay backlash is industry consensus; courts reject overlays as a defense
    ([access-proof.com](https://access-proof.com/blog/overlay-widgets-vs-real-wcag-scanners)).
    Enterprise scanners priced out of small-agency reach (Monsido $3k+, Business Plus tiers
    $225+/mo at Pope Tech).
- **Distribution channels where buyers gather:** r/webdev (~3M), r/web_design, WordPress and
  Webflow agency communities, Indie Hackers, LinkedIn (agency owners), plus SEO intent
  ("accessibility audit tool", "EAA compliance checker", "white label accessibility report").
- **Build complexity:** Moderate. Playwright + axe-core (both boring, maintained), same-origin
  crawler with page caps, SQLite/Postgres storage, HTML/PDF report rendering, cron rescans,
  Stripe/MoR billing. No third-party data APIs, no OAuth walls. Riskiest part: crawl
  robustness against real-world sites.
- **Support burden:** Moderate; crawl failures are the ticket driver. Mitigations designed in
  (caps, per-page error reasons, honest scope). Estimated ≤2h/week early.
- **60-day revenue:** Plausible. Buyers are searching now with money and urgency; trial → $29
  self-serve is a small ask; agencies buy tools that let them bill audits immediately.

### C2 — Mutual-action-plan / deal-room lite for individual enterprise AEs (runner-up)

- **Niche:** Individual quota-carrying B2B AEs running multi-stakeholder deals whose
  companies won't buy a digital sales room; single seat, self-serve.
- **Demand evidence:** Category is real and funded: Recapped ⭐ $45/user/mo paid tiers
  ([recapped.io/pricing](https://www.recapped.io/pricing)); Aligned ⭐ $29–49/seat/mo
  ([alignedup.com/pricing](https://alignedup.com/pricing/)); Dock $350/mo standard; Trumpet
  ~$45/user/mo; GetAccept $25–49/user/mo min 5 users
  ([prospeo.io deal-rooms roundup](https://prospeo.io/s/deal-rooms), [hummingdeck.com comparison](https://hummingdeck.com/blog/digital-sales-room-comparison-2026)).
  AEs do spend own money on tools (Fathom/Claude/Apollo pattern documented:
  [saas-tools.medium.com](https://saas-tools.medium.com/the-100k-sales-tool-stack-vs-the-40-month-one-i-actually-use-2026-aeb9225f3b66)).
  Channels verified: r/sales ~589k members, RevGenius ~50k, Bravado War Room 200k+
  ([salesassembly.com](https://www.salesassembly.com/blog/revenue-leadership/best-sales-communities-b2b-revenue-professionals/), [freesubstats.com](https://freesubstats.com/best/marketing-subreddits)).
- **Why it lost:** The individual seat is already served *free*: Recapped free = 1 user,
  unlimited rooms; Dock free = 50 workspaces; Aligned free starter (4 rooms/seat); Trumpet
  free pods ([prospeo.io](https://prospeo.io/s/recapped-pricing-reviews-pros-and-cons),
  [alignedup.com/pricing](https://alignedup.com/pricing/)). Industry guidance explicitly says
  individuals/small teams should use spreadsheets
  ([prospeo.io/s/mutual-action-plan-template](https://prospeo.io/s/mutual-action-plan-template)).
  Category failure stats are ugly: ~48% of deal rooms never get a single buyer view; rooms go
  stale ([prospeo.io/s/digital-sales-room](https://prospeo.io/s/digital-sales-room),
  [hummingdeck.com](https://hummingdeck.com/blog/why-digital-sales-rooms-fail)). Paying
  demand at the single-seat level is not demonstrated — it would need to be invented, which
  hard constraint #4 bans.
- **Kept because:** operator advantage 5/5 (he is the ICP; owned LinkedIn + community
  distribution; can dogfood in live deals). If C1's crowding risk materializes fast, this is
  the pivot, positioned as paid-only premium personal tool (custom domain + branding), priced
  ~$15/mo, distribution-led.

### C3 — Email-to-structured-data parser (lite)

- **Niche:** Ops people at small businesses parsing recurring machine-generated emails
  (orders, leads, bookings) into sheets/webhooks.
- **Demand:** Parseur ⭐ free 20 pages, $39/mo for 100 pages(!), $99/mo for 1,000
  ([parseur.com/pricing](https://parseur.com/pricing)); Mailparser ~$39.99 entry; Zapier
  Email Parser free-but-basic. Fat per-page margins at the low end.
- **Gap:** $39 for 100 pages is a fat umbrella — but new cheap entrants already exist
  (Parsli $20/mo, JsonHook $12/mo, DigiParser $20/mo — found in one search:
  [parsli.co/compare/parseur](https://parsli.co/compare/parseur)).
- **Why it lost:** Support burden. "My field didn't extract" is an unbounded ticket
  generator; AI-assisted parsing adds recurring LLM cost and nondeterminism. Inbound email
  infra (SES/Postmark inbound) is another account + deliverability surface. Operator
  advantage ~zero. TTFD depends on SEO against entrenched comparison-content players.

### C4 — App-review monitoring/alerts for indie mobile devs

- **Demand:** Appbot ⭐ $49/mo annual entry ([appbot.co/plans](https://appbot.co/plans/));
  Appfigures ⭐ free–$9.99 entry, review features ~$44.99
  ([appfigures pricing](https://app.appfigures.com/platform/pricing)). Complaints: Appbot
  gates CSV export behind Large ($166+/mo).
- **Why it lost:** Platform walls verified: official APIs only cover *your own* apps; Google
  Play API returns only last 7 days of comment-only reviews and needs the customer's own
  service account (real onboarding friction); Apple public RSS is capped (~500 recent) and
  Apple's ToS frowns on storefront scraping; competitor tracking is "officially unsupported"
  ([datashake.com](https://www.datashake.com/blog/app-store-review-data-api-access-what-you-can-and-cant-get-in-2026),
  [developers.google.com](https://developers.google.com/android-publisher/reply-to-reviews)).
  A scraping treadmill + a free competitor (Rivioo) + $9.99 Appfigures = thin, fragile ground.

### C5 — Onboarding checklist/tour widget for indie SaaS

- **Demand:** Userflow $240/mo, Appcues $300–879/mo, UserGuiding $69–89/mo entry — huge
  umbrella, verified ([chameleon.io roundup](https://www.chameleon.io/alternative/appcues-alternatives),
  [produktly.com](https://produktly.com/compare/appcues-vs-userguiding), [usertourkit.com](https://usertourkit.com/blog/onboarding-software-cost-2026)).
- **Why it lost:** The low end is already occupied (Produktly €19/mo, Intro.js/Shepherd free
  OSS, Tour Kit $99 one-time); the product injects JS into *customers'* apps → cross-site CSS
  conflicts and "it broke my app" tickets — the worst possible support profile for a 3h/week
  operator; and buyers need MAU-scale before caring, lengthening TTFD.

### C6 — Client reporting lite for solo marketing/SEO consultants

- **Demand:** AgencyAnalytics ⭐ $59/mo annual (5-client min; +$12–20/client)
  ([agencyanalytics.com/pricing](https://agencyanalytics.com/pricing)); documented Reddit
  complaints about pricing model ([whatagraph.com](https://whatagraph.com/blog/articles/agencyanalytics-pricing)).
- **Why it lost:** Build reality: every useful report needs OAuth integrations (GA4, Search
  Console, Meta/Google Ads). Google OAuth app verification alone is a weeks-long process
  requiring human account actions — incompatible with the 60-day clock. Looker Studio free
  covers the 1–4-client case that would otherwise be our niche.

### C7 — PDF generation API (lite)

- **Demand:** DocRaptor ⭐ $15/mo for 125 docs (12¢ overage!) ([docraptor.com/signup](https://docraptor.com/signup)),
  PDFShift $24/mo for 2,500 ([pdfshift.io/faq](https://pdfshift.io/faq)), Anvil $0.10/doc,
  PDFMonkey €5+. Real paid market.
- **Why it lost:** Crowded field with credible cheap options; differentiation would be price
  alone; abuse risk (anonymous API workloads); developer TTFD is SEO-driven and slow. Solid
  business, weak wedge.

### C8 — OG-image / screenshot API

- **Demand:** Bannerbear ⭐ $49/mo ([bannerbear.com/pricing](https://www.bannerbear.com/pricing/)),
  Placid $19/mo, htmlcsstoimage ⭐ $14/mo ([htmlcsstoimage.com/pricing](https://htmlcsstoimage.com/pricing)).
- **Why it lost:** Free substitutes for the dev crowd (@vercel/og) and a $14 incumbent leave
  no pricing oxygen; headless-Chrome abuse surface; same slow dev-SEO TTFD as C7.

### C9 — Testimonial collection

- **Demand:** Senja $29/$59 with a generous free tier, Testimonial.to $25–60
  ([support.senja.io](https://support.senja.io/what-are-the-differences-between-the-free-and-paid-plans-sdcfs), [vouchview.com](https://vouchview.com/blog/vouchview-vs-senja-vs-testimonialto)).
- **Why it lost:** Senja's free tier + polish closed the gap this category used to have;
  differentiation would be cosmetic. (Pricing verified via Senja's own help center + two
  comparison sites; senja.io/pricing itself not fetched — noted in ASSUMPTIONS A-004.)

### C10 — Feedback board (lite)

- **Demand:** Canny ⭐ free 25 tracked users then $79/mo cliff ([canny.io/pricing](https://canny.io/pricing));
  complaints about the meter are widespread ([votiez.com](https://votiez.com/blog/canny-pricing-worth-it)).
- **Why it lost:** The gap spawned a pile of cheap fillers years ago: Frill $25, Featurebase
  free tier/$29–49, UserJot, Votiez $4.99, Usero $19 ([usero.io](https://usero.io/blog/canny-alternatives-for-indie-hackers)).
  Saturated race to the bottom.

### C11 — Waitlist + referral tool

- **Demand/why it lost:** LaunchList ⭐ owns the one-time low end ($19/500 subs)
  ([getlaunchlist.com/pricing](https://getlaunchlist.com/pricing)); Waitlister free/$15,
  GetWaitlist $15. Inherently churny (waitlists end). Saturated.

### C12 — Uptime/SSL/domain monitoring for freelancers managing client sites

- **Demand/why it lost:** Real spend exists (UptimeRobot ⭐ $9 Solo, Hyperping ⭐ $24,
  Pulsetic ⭐ $9 — all verified on vendor pages) but the free/cheap floor is brutal and WP
  Umbrella bundles uptime+SSL+reports at ⭐ €1.99/site ([wp-umbrella.com/pricing](https://wp-umbrella.com/pricing/)).
  No oxygen.

### C13 — WordPress care-plan reports

- **Why it lost:** WP Umbrella (⭐ €1.99/site/mo, 5,000+ agencies) and ManageWP already own
  exactly this at a price we can't undercut meaningfully; WP-ecosystem support burden
  (every install is a snowflake) is high.

### C14 — Cron-job monitoring

- **Why it lost:** Healthchecks.io ⭐ $20/mo hosted with a generous free tier AND
  open-source self-hosting ([healthchecks.io/pricing](https://healthchecks.io/pricing));
  Cronitor cheap. Beloved incumbents, no complaint wedge found.

---

## Cross-cutting constraint check for the pick (C1)

| Hard constraint | Status |
|---|---|
| Real software product | ✅ Web app (scanner + dashboard + reports) |
| Simple revenue model | ✅ Subscription, self-serve, no moderation surface |
| Solo-maintainable <3h/wk | ✅ designed-in (automation only; page caps; refund-first) |
| Demand exists today | ✅ evidence above; no education needed |
| Specific niche | ✅ freelance web pros & small agencies with client sites |
| No regulated domains | ✅ public-page scanning only; no PII stored beyond account email; reports carry "not legal advice" language (standard for the category — Pope Tech, Silktide do the same) |
| <$500 startup, <$50/mo per expense | ✅ VPS ~$5–20/mo + domain ~$12/yr + Stripe/MoR per-txn fees |
| Revenue plausible in 60 days | ✅ urgent searches + $29 self-serve price point |

## What would kill C1 (tripwires to watch)

1. A well-funded competitor ships a $19/mo agency white-label plan (watch: A11yProof,
   AccessProof, Silktide down-market moves).
2. Playwright-based crawling proves unable to scan >20% of trial users' sites (bot
   protection) — measure during beta.
3. Trial→paid conversion <2% after 100 trials with fixed positioning — revisit pricing or
   pivot to C2.
