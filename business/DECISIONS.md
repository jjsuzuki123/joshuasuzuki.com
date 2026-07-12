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
