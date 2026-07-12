# HUMAN ACTIONS

The running batch of things only the operator can do. I never wait on these; I keep working
and mark dependent steps "blocked on human."

**Legend:** `PENDING` = needs you · `DONE` = you confirmed · `BLOCKED` = can't proceed until something else happens

---

## Batch 1 — created 2026-07-12 (Phase 1, none urgent yet)

### HA-001 · Approve or veto the Phase 1 pick — PENDING
- **What:** Read `business/RESEARCH.md` (candidates + scores) and the recommendation memo at the top.
- **Time:** ~15 minutes.
- **Tell me:** "Approved: <candidate>" or "Rejected because X, use <other> instead."
- **Note:** Per the brief, if you're unavailable I proceed with the top pick and log it in DECISIONS.md. Build work continues either way; nothing public happens without you.

### HA-002 · (Optional) Decide where this code should live long-term — PENDING
- **What:** Work currently lives in `business/` inside your personal-site repo. If you want a dedicated private repo: create one on GitHub (e.g. `<product>-app`), then tell me and I'll produce exact `git` commands to move history cleanly.
- **Time:** ~3 minutes.
- **Tell me:** "Keep it here" or "New repo created: <url>."
