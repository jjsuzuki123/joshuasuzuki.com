# QA.md — hostile first-time-user QA log (Phase 2 exit evidence)

**Date:** 2026-07-12 · Environment: local dev server (billing disabled, SCAN_ALLOW_PRIVATE=1) + automated suite

## Automated coverage

- 150 tests passing (10 files): URL parsing/normalization, SSRF classifier (IPv4/IPv6/mapped/
  obfuscated), crawler discovery + caps + origin containment, scoring/grades/fingerprints/
  diffs, entitlements (trial expiry, past-due grace, cancel-at-period-end), auth flows,
  CSRF (missing/mismatched/cross-origin), plan limits, ownership isolation, share links
  (create/revoke/404), account deletion, scheduler due-logic, orphan recovery, Stripe
  webhook signatures + idempotency + status mapping, report view-model.
- Browser integration test: real Chromium scan of a fixture site with planted violations —
  detects image-alt, link-name, label, color-contrast; scores; diffs (second scan = 0 new /
  0 resolved); renders a valid PDF. Graceful whole-site-unreachable failure verified.
- `scripts/smoke-test.sh`: live end-to-end (signup → add site → scan → report → PDF →
  share link) — PASSED.
- `npm audit`: **0 vulnerabilities** after upgrading @fastify/static, nodemailer, node-cron,
  vitest (2026-07-12).

## Manual hostile pass (live server, curl)

| Attack / mistake | Result |
|---|---|
| Garbage URLs: `https://`, `http://.com`, `ftp://x.com`, credentials-in-URL, `[::1]`, 3000-char URL | All rejected with friendly flash; **two bugs found & fixed**: empty-label domains were accepted (now label-validated), 3000-char URL hit a 500 (now safeParse + flash). Regression tests added. |
| IP obfuscation `http://0x7f000001` | URL-normalized to 127.0.0.1 → SSRF check rejects. Test added. |
| `<script>` in site name / agency name | Escaped everywhere (autoescape); asserted no raw `<script>` in output. Test added. |
| Fake PNG (text with .png name) | Rejected by magic-byte sniff: "Logos must be PNG or JPEG images." |
| 2 MB logo | Rejected at multipart limit with friendly flash (no 500). |
| Real 1×1 PNG | Accepted; branding saved. |
| Wrong current password on change | Friendly flash, no change. |
| Junk/oversized session cookie | Treated as logged out (302 → /login), no error. |
| 12 rapid failed logins | Rate-limited at attempt 11 with wait guidance. |
| Double scan submission | Second POST refused: "already queued or running" (also covered by test). |
| Expired trial | Scan/add blocked server-side, banner + redirect to /billing (test). |
| Cross-user access to sites/scans | 404, no information leak (test). |
| Stripe webhook: unsigned / tampered / replayed | 400 / 400 / idempotent no-op (tests). |

## Known limitations accepted for MVP (documented in UI/docs, in BACKLOG)

- No login-wall scanning; bot-protected sites fail with honest per-page reasons + allowlist guidance.
- Scans pause during deploys (orphans auto-failed with explanation; user re-runs).
- One app instance assumed (in-memory rate limits, in-process queue) — fine at launch scale.
- Real-DNS rejection of nonexistent domains couldn't be observed in this sandbox (its
  resolver answers for everything); the logic is unit-tested and will work on a real host.
  Flagged in ASSUMPTIONS A-009.
