# STATUS

> Read this first. This file tells a fresh session exactly where work stands.
> All business-builder files live in `business/` on branch `cursor/business-builder-010d`.

**Last updated:** 2026-07-12 (session 1)

## Current phase

Phase 1: COMPLETE (pick made, pending operator ratification HA-001) → Phase 2: Build — STARTING

## Where things stand

- Phase 1 done: 14 candidates researched with live web evidence, scored on the weighted
  rubric, full memo in RESEARCH.md.
- **Pick: SiteRamp (working name)** — automated accessibility scanner + scheduled monitoring
  + white-label client-ready reports, for freelance web designers/devs and 1–10-person
  agencies. Flat subscription ~$29–49/mo. Decision + steelman in DECISIONS.md D-003.
- Runner-up/fallback: mutual-action-plan tool for individual AEs (C2 in RESEARCH.md).
- Operator context confirmed from resume in repo root: Joshua Suzuki, Mid-Market AE at
  Fastly (NYC), sells CDN/WAF/edge security, MEDDPICC. Used in scoring.

## In progress

- Phase 2: writing SPEC.md, then building the app in `business/app/`.

## Next 3 concrete actions

1. Write SPEC.md (MVP definition, cut list, data model, error-handling strategy).
2. Scaffold app: Node 22 + TypeScript + Fastify + server-rendered views + SQLite; Playwright
   + axe-core scan engine with page caps; tests with vitest.
3. Build features in order: auth → sites CRUD → scan engine → report rendering → scheduling
   → billing adapter → hostile-user QA pass. Commit after each.

## File map

| File | Purpose |
|---|---|
| `business/STATUS.md` | This file. Resume point. |
| `business/DECISIONS.md` | Append-only decision log. |
| `business/ASSUMPTIONS.md` | Unverified assumptions + what would confirm/kill each. |
| `business/HUMAN_ACTIONS.md` | Batched actions only the operator can take. |
| `business/RESEARCH.md` | Phase 1 candidates, evidence, scores, memo. (pending) |
| `business/SPEC.md` | Phase 2 MVP spec. (pending) |
| `business/app/` | Product code. (pending) |
| `business/LAUNCH.md` | Phase 3 launch checklist. (pending) |
| `business/OPERATIONS.md` | Phase 4 operating playbook. (pending) |
| `business/BACKLOG.md` | Ideas deliberately deferred. (pending) |
