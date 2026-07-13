# ASSUMPTIONS

Every assumption I could not verify, marked UNVERIFIED until confirmed. Each lists the
evidence that would confirm or kill it. Reviewed at the start of each phase.

| ID | Assumption | Status | Confirms it | Kills it |
|----|------------|--------|-------------|----------|
| A-001 | The operator approves working inside the personal-site repo under `business/` until a dedicated repo exists. | UNVERIFIED | Operator says OK / merges PR | Operator asks for a separate repo (easy migration; folder is self-contained) |
| A-002 | Operator has ~3 hrs/week available pre-launch for human-only actions (accounts, domain, payments). | UNVERIFIED | HUMAN_ACTIONS items get done within ~2 weeks | Items sit blocked >30 days — revisit plan pacing |
| A-003 | Operator is willing to market under his own name/LinkedIn (his identity is a distribution asset). | UNVERIFIED | He posts the Phase 4 content or approves it | He wants the business anonymous — rework distribution plan |
| A-004 | Senja/Testimonial.to pricing figures (C9) came from Senja's help center + comparison sites, not senja.io/pricing directly. Directionally safe; exact numbers may drift. | UNVERIFIED (low impact) | Vendor pricing page check | n/a — candidate already rejected |
| A-005 | A11yProof / AccessProof / Veracly / Webply are small, recent indie entrants (inferred from their content-marketing style and absence from older roundups), not funded incumbents. | UNVERIFIED | Traffic/funding data, launch dates | If any is funded and scaling, C1's crowding risk rises — check before launch |
| A-006 | Freelance agencies will pay $29–49/mo flat for white-label a11y reports + monitoring (price umbrella supports it; direct willingness at OUR price point untested). | UNVERIFIED | ≥3% trial→paid conversion in first 100 trials | <2% conversion after 100 trials with fixed positioning → pricing/pivot per RESEARCH tripwires |
| A-007 | Playwright + axe-core can successfully scan the large majority (>80%) of typical small-business marketing sites without bot-protection blocks. | UNVERIFIED | Beta scan success-rate metric | High block rates → add scan-proxy budget or narrow ICP to sites the agency controls (can allowlist our crawler) |
| A-008 | EAA/ADA-driven urgency persists through our launch window (60–90 days). Enforcement news suggests yes. | UNVERIFIED | Continued enforcement actions/coverage | Regulatory retreat would soften urgency; ADA suits are independent of EAA |
| A-009 | DNS-based rejection of nonexistent domains works on a real host (sandbox resolver answered every lookup, so only unit-tested here). | UNVERIFIED | One manual check on the production VPS: adding `https://no-such-domain-xyzzy.com` should be rejected at submit time | If a wildcard resolver is ever in play, dead domains fail at scan time with a friendly DNS error instead — acceptable fallback |
| A-010 | Playwright-rendered scans pass typical bot protection often enough (>80% of trial users' sites scannable). | UNVERIFIED | Beta metric: pages_failed/pages_crawled ratio | High block rate → document allowlist flow harder, consider residential-friendly hosting or scan-from-browser feature (BACKLOG) |
