# HUMAN ACTIONS

The running batch of things only the operator can do. I never wait on these; I keep working
and mark dependent steps "blocked on human."

**Legend:** `PENDING` = needs you · `DONE` = you confirmed · `BLOCKED` = can't proceed until something else happens

---

## Batch 1 — created 2026-07-12 (Phase 1, none urgent yet)

### HA-001 · Approve or veto the Phase 1 pick — PENDING
- **What:** Read the recommendation memo at the top of `business/RESEARCH.md`. The pick:
  **automated accessibility scanning + white-label reports for freelance web designers and
  small agencies** (working name "SiteRamp"), flat ~$29–49/mo subscription. Runner-up was a
  mutual-action-plan tool for AEs (your home turf) — memo explains why it lost.
- **Time:** ~15 minutes.
- **Tell me:** "Approved" or "Rejected because X, use <other> instead."
- **Note:** Per the brief I've proceeded to Phase 2 build on the pick (logged in DECISIONS.md
  D-003). Nothing public happens without you; a veto just costs the build time.

### HA-002 · (Optional) Decide where this code should live long-term — PENDING
- **What:** Work currently lives in `business/` inside your personal-site repo. If you want a dedicated private repo: create one on GitHub (e.g. `<product>-app`), then tell me and I'll produce exact `git` commands to move history cleanly.
- **Time:** ~3 minutes.
- **Tell me:** "Keep it here" or "New repo created: <url>."

---

## Batch 2 — created 2026-07-12 (launch path; full context in LAUNCH.md §5)

### HA-003 · Buy the domain — PENDING
- **What:** Check the shortlist in LAUNCH.md §4 (start with siteramp.com), buy one (~$12/yr; Cloudflare Registrar is at-cost). Don't create DNS records yet — that needs the VPS IP from HA-007.
- **Time:** ~15 minutes including the collision sanity-check described in LAUNCH.md.
- **Tell me:** "Bought <domain>."

### HA-004 · Create the Stripe account + products — PENDING
- **What:** stripe.com → create account (sole proprietor is fine to start; upgrading to an LLC later is a settings change). Then follow LAUNCH.md §2 exactly: ask/check whether **Stripe Managed Payments** is available for your account (this decides who handles sales tax), create the two products/prices, the webhook endpoint, and copy 4 values into the server `.env`.
- **Time:** ~40 minutes.
- **Tell me:** "Stripe live, Managed Payments = yes/no" + confirm the 4 env values are set.

### HA-005 · Final pricing sign-off — PENDING
- **What:** Approve Solo $29/mo + Studio $59/mo (analysis in LAUNCH.md §1) or give me your numbers; changing them is a 2-minute edit + new Stripe prices.
- **Time:** ~10 minutes of reading.
- **Tell me:** "Pricing approved" or "Change to X/Y."

### HA-006 · (Only if Managed Payments = no) NY sales tax registration — PENDING
- **What:** You have NY physical nexus and NY taxes SaaS. Register a NY Certificate of Authority (free, online, ~30 min) before the first sale, and enable Stripe Tax in the dashboard. If Managed Payments = yes in HA-004, skip this entirely.
- **Time:** ~30 minutes once.
- **Tell me:** "Registered" (or "Skipped — MoR").

### HA-007 · Hosting account + one VPS — PENDING
- **What:** Create a Hetzner Cloud account (or DigitalOcean/Vultr equivalent), provision 1× Ubuntu 24.04 server, CX22 class (2 vCPU / 4 GB, ~€8/mo), add your SSH key. Then point DNS: A record `app.<domain>` → server IP.
- **Time:** ~20 minutes.
- **Tell me:** The server IP + confirm DNS is set. I'll then hand you the exact 2 deploy commands (script is already in the repo) and verify everything remotely via the checklist.

### HA-008 · Legal: accept ToS/Privacy drafts — PENDING
- **What:** Read `/legal/terms` and `/legal/privacy` (drafts written; honest, plain-language). Accept as-is for launch or send to a lawyer first — your call, your risk tolerance. Also give me the real support email address to put in config.
- **Time:** ~15 minutes (reading) or lawyer-dependent.
- **Tell me:** "Legal approved, support email is X" (or "waiting on lawyer").

### HA-009 · Transactional email account — PENDING
- **What:** Create a Resend account (free tier 3k emails/mo — plenty) or Postmark ($15/mo). Verify the domain (they give you 2–3 DNS records to add: SPF/DKIM), create an SMTP credential, add the 5 SMTP values to the server `.env`, restart the service (`systemctl restart siteramp`).
- **Time:** ~25 minutes (DNS propagation may add a wait).
- **Tell me:** "Email live" — I'll verify password-reset and scan-alert emails end to end.

### HA-010 · Free uptime monitor — PENDING
- **What:** Any free uptime service pointed at `https://app.<domain>/healthz`, alerting your personal email. (Pulsetic/StatusCake free tiers allow commercial use.)
- **Time:** ~10 minutes.
- **Tell me:** "Monitor set."

### HA-011 · Green-light launch (public actions gate) — BLOCKED until HA-003…HA-010 done
- **What:** Say go. Then: I finalize production QA (LAUNCH.md §5 step 11), and you start posting the Week-1 content from OPERATIONS.md under your name.
- **Tell me:** "Launch."

### HA-012 · Check your employment agreement's side-project clause — PENDING
- **What:** Before Day-1 content goes out under your name, confirm your employer's IP/moonlighting policy permits an unrelated side business (accessibility tooling doesn't compete with CDN/edge, but the paper matters). The marketing drafts never name your employer.
- **Time:** ~20 minutes of reading (or one HR question).
- **Tell me:** "Clear" or any constraints — content and attribution can be adjusted (e.g., brand-first instead of person-first distribution).

### HA-013 · Off-server backup copy — PENDING (after first paying customer)
- **What:** The VPS makes nightly local backups automatically. Add an off-server copy: simplest is an `rclone` cron to any object storage (Cloudflare R2 free tier works) — I'll give exact commands once you pick a provider; or even a weekly `scp` to your laptop.
- **Time:** ~20 minutes.
- **Tell me:** "Backups off-server."
