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
