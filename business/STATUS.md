# STATUS

> Read this first. This file tells a fresh session exactly where work stands.
> All business-builder files live in `business/` on branch `cursor/business-builder-010d`.

**Last updated:** 2026-07-12 (end of session 1)

## Current phase

Phases 1–4 deliverables COMPLETE. → **Blocked on human actions for launch.**
Nothing is public and no accounts/money exist yet — by design (escalation rules).

## What exists (all committed and pushed)

- **Phase 1:** RESEARCH.md — 14 candidates, verified evidence, weighted rubric, memo.
  Pick: accessibility scanning + white-label reports for freelance web pros/small agencies
  (working name **SiteRamp**). Runner-up documented (MAP tool for AEs). DECISIONS D-003.
- **Phase 2:** `app/` — complete working product. Node22/TS + Fastify + Nunjucks + SQLite +
  Playwright + axe-core, single deployable. Auth (argon2id, sessions, resets), sites CRUD,
  crawler (sitemap+BFS, caps, SSRF-guarded), scanner, scoring/grades, scan diffs,
  white-label PDF, share links, scheduler, Stripe billing + webhooks, rate limits, CSRF,
  security headers. **150 tests passing incl. real-browser integration; npm audit: 0 vulns.**
  Docs: README, ARCHITECTURE, RUNBOOK. Deploy: `scripts/deploy-vps.sh` (+backup.sh,
  smoke-test.sh). QA evidence: QA.md (2 bugs found & fixed during hostile pass).
- **Phase 3:** LAUNCH.md — pricing $29/$59 (justified vs Phase-1 competitor data, with
  cheaper/higher-tier analyses), Stripe decision incl. Managed-Payments-vs-direct tax
  analysis (D-005), landing page + FAQ + legal drafts live in the app, domain shortlist,
  ordered launch checklist with owners.
- **Phase 4:** OPERATIONS.md — ranked distribution plan, 30-day calendar, support playbook
  (refund-first), weekly 3-hour routine, 6 metrics with kill/scale thresholds, 3 scaling
  levers, dignified shutdown checklist. marketing/CONTENT.md — every post/outreach/canned
  response drafted. BACKLOG.md — deferred items with promotion triggers.

## Verification state (don't re-verify blindly, but here's how)

`cd business/app && npm install && npx playwright install chromium && npm test` → 150 pass.
`npm run seed && SCAN_ALLOW_PRIVATE=1 npm run dev` → click around as demo@example.com /
demo-password-123. `bash scripts/smoke-test.sh` against it → full e2e.

## Next 3 concrete actions

1. **Operator:** work through HUMAN_ACTIONS.md batch 2 (HA-003…HA-012). Everything is
   step-by-step; total ≈ 2–3 hours. HA-001 (ratify the pick) ideally first.
2. **Next agent session (after HA-007 exists):** walk the production deploy
   (LAUNCH.md §5 step 5), run production QA (step 11), verify backups next morning.
3. **Next agent session (if operator is idle >2 weeks):** re-check ASSUMPTIONS tripwires
   (A-005 competitor watch, A-008 EAA news) and refresh RESEARCH if the window shifted.

## Standing rules for future sessions

- Never take public actions or create accounts — those are HUMAN_ACTIONS by definition.
- Update this file + DECISIONS.md before ending any major unit of work.
- The dev server may be running in tmux session `siteramp-dev` (port 3400) — kill or reuse.
