# BACKLOG.md — deliberately deferred (with triggers)

Not a wishlist: each item has the trigger that promotes it. Anything without a trigger gets
deleted, not hoarded.

## Product

| Item | Trigger to build |
|---|---|
| Accessibility statement generator (template + site facts, heavy disclaimers) | 3+ customers ask, or first EU-heavy customer cohort |
| Free no-signup single-page scan on the landing page (rate-limited, email-gated PDF) | When shifting to SEO-led growth (scaling lever #2) |
| Agency tier ($99–149: 100 sites, scheduled client-facing PDF emails, custom share domain) | ≥3 Studio customers at the 30-site cap or asking for client email delivery |
| Annual billing (2 months free) | First organic month-3 renewals exist |
| Login-wall scanning (Playwright storage-state) | Most-requested item post-launch AND >5 paying requesters |
| Fix-verification quick re-scan ("did my fix work?" single-issue re-check) | Recurring support pattern |
| Scan-diff email digest improvements (weekly rollup vs per-scan) | Complaints about email volume |
| PDF/WCAG 2.2 rule-set toggle + EN 301 549 mapping table in report | EU agency demand |
| API + CI integration (scan on deploy) | 3+ developer-shop customers ask |
| Public status page | First real outage |

## Marketing / SEO keyword plan (scaling lever #2)

Comparison: "accessiBe alternatives", "UserWay alternative for agencies", "Silktide vs",
"Pope Tech vs". How-to: "accessibility audit template", "how to sell accessibility audits",
"EAA compliance checklist agency", "WCAG report example PDF". Programmatic: per-rule fix
guides (the 17 hand-written rule explainers are seed content).

## Ops

| Item | Trigger |
|---|---|
| Off-server backup automation (rclone to R2/B2) | At first paying customer (HUMAN_ACTIONS will carry it) |
| Plausible analytics (~$9/mo) | When content marketing starts in earnest |
| Postgres migration + second app instance | Sustained >50 concurrent scan demand or >5k sites monitored |
| Dependabot/Renovate on the repo | When repo moves to its own home (HA-002) |

## Explicitly rejected (don't revisit without new evidence)

- Overlay/widget of our own — contradicts the entire positioning.
- Marketplace of auditors, community features, user-generated content — moderation burden.
- Mobile app, browser extension — no evidence of need; support surface.
- Mass cold-email motion — deliverability + brand risk in a trust-selling category.
