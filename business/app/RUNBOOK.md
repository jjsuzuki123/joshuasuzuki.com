# RUNBOOK.md — common failures and fixes

Audience: the operator (non-developer OK) and any future maintainer. Commands assume the
VPS layout from `scripts/deploy-vps.sh` (`/opt/siteramp/app`, systemd service `siteramp`,
Caddy in front). On a different host, adjust paths.

## Daily knowledge (60 seconds)

```bash
systemctl status siteramp          # is the app running?
journalctl -u siteramp -n 100      # recent logs (timestamps are UTC)
curl -s https://APP_DOMAIN/healthz # {"ok":true} means HTTP is alive
ls -lh /opt/siteramp/app/data/     # siteramp.db (+ backups/ after first cron run)
```

The app log is plain lines: scan lifecycle (`scan#N: …`), Stripe events (`stripe: user#N → plan/status`),
email failures, and error stacks. `grep error` and `grep scan#` cover most investigations.

---

## "The site is down"

1. `systemctl status siteramp` — if `inactive/failed`: `journalctl -u siteramp -n 50` for the
   crash reason, then `systemctl restart siteramp`. The service auto-restarts; repeated
   crash-loops are almost always a bad `.env` edit (the config layer prints exactly which
   variable is wrong) or a full disk (`df -h`).
2. App running but domain unreachable → Caddy: `systemctl status caddy`,
   `journalctl -u caddy -n 50`. Certificate issues fix themselves once DNS points correctly;
   `caddy validate --config /etc/caddy/Caddyfile` catches syntax errors.
3. Disk full → delete old backups (`/opt/siteramp/app/data/backups`), `apt-get clean`,
   check journal size (`journalctl --vacuum-size=200M`).

## "A customer's scan failed"

The scan page shows a per-page reason — read it first; it usually answers everything:

| Report says | Meaning | What to tell the customer |
|---|---|---|
| "refused our request (HTTP 403/429)… bot protection" | Cloudflare/WAF blocking headless browsers | Allowlist the user agent `SiteRampBot` (or their firewall's "good bots" list), then re-run. They control the site, so this is a 5-minute fix. |
| "took too long to load" | Slow page or hung third-party script | Re-run once; if persistent, it's genuinely slow — that's worth them knowing anyway. |
| "domain could not be found (DNS)" | Typo'd domain or DNS down | Check spelling on the site page. |
| "HTTPS certificate is invalid" | Expired/misconfigured TLS | Their cert is broken — also worth knowing. Fix cert, re-run. |
| "requires a login or blocks automated visitors" (no pages found) | Login wall or full bot-block | Login-wall scanning isn't supported yet (BACKLOG). Offer a refund if this was their main use case. |
| "interrupted by a server restart" | We deployed/restarted mid-scan | Apologize, re-run the scan. Free. |

Server-side confirmation: `journalctl -u siteramp | grep "scan#<id>"`.

## "Scans are stuck in 'queued'"

One scan runs at a time; a big site ahead in the queue is the usual cause (page cap keeps
this under ~10 min worst case). If genuinely wedged: `systemctl restart siteramp` — on boot,
orphaned scans are auto-failed with an honest message and users can re-run. If Chromium
refuses to launch after a system upgrade: `cd /opt/siteramp/app && npx playwright install-deps chromium && sudo -u siteramp npx playwright install chromium`.

## "Customer paid but is still on trial limits" / webhook problems

1. Stripe Dashboard → Developers → Webhooks → check the endpoint's recent deliveries.
   Failures there = our endpoint erroring or unreachable; Stripe retries automatically for days.
2. `journalctl -u siteramp | grep stripe:` — look for `user#N → solo/active` after their payment.
3. Common cause: `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint (each endpoint has its
   own secret). Fix `.env`, `systemctl restart siteramp`, then "Resend" the failed events in
   Stripe — handlers are idempotent, resending is safe.
4. Emergency manual unblock (use sparingly, note it in the customer thread):
   ```bash
   sqlite3 /opt/siteramp/app/data/siteramp.db \
     "UPDATE users SET plan='solo', plan_status='active' WHERE email='customer@x.com';"
   ```
   The next real webhook will overwrite this with Stripe's truth.

## "Password reset emails aren't arriving"

- SMTP not configured → the forgot-password page already tells users to email support.
  Manual reset: generate a link for them (valid 1 h):
  ```bash
  cd /opt/siteramp/app && npx tsx -e "
  import {loadConfig} from './src/config.js'; import {openDb} from './src/db.js';
  import {Repo} from './src/domain/repo.js'; import {AuthService} from './src/services/auth.js';
  const c=loadConfig(); const repo=new Repo(openDb(c.dataDir));
  const r=new AuthService(repo).createPasswordResetToken(process.argv[1]);
  console.log(r ? c.baseUrl+'/reset-password?token='+r.token : 'no such account');
  " customer@x.com
  ```
- SMTP configured but failing → `journalctl -u siteramp | grep "email send failed"`; verify
  credentials and the provider's dashboard (suspensions, domain verification).

## Database: backup, restore, inspect

- Nightly cron (installed by deploy script) runs `scripts/backup.sh` → gzipped snapshots in
  `data/backups/`, 30-day retention. **Off-server copies are on you** (HUMAN_ACTIONS):
  simplest is a cron `rclone copy` of `data/backups` to any object storage, or even a weekly
  `scp` to your laptop.
- Restore:
  ```bash
  systemctl stop siteramp
  gunzip -c data/backups/siteramp-YYYYMMDD-HHMMSS.db.gz > data/siteramp.db
  rm -f data/siteramp.db-shm data/siteramp.db-wal
  systemctl start siteramp
  ```
- Useful queries:
  ```bash
  sqlite3 data/siteramp.db "SELECT email, plan, plan_status, datetime(created_at,'unixepoch') FROM users ORDER BY id DESC LIMIT 20;"
  sqlite3 data/siteramp.db "SELECT status, COUNT(*) FROM scans GROUP BY status;"
  sqlite3 data/siteramp.db "SELECT s.origin, sc.status, sc.error_message FROM scans sc JOIN sites s ON s.id=sc.site_id WHERE sc.status='failed' ORDER BY sc.id DESC LIMIT 10;"
  ```

## Updating the app

```bash
cd /opt/siteramp/app
git pull                        # or scp the new version
npm ci --omit=dev
sudo -u siteramp npx playwright install chromium   # if playwright version changed
SITERAMP_SKIP_BROWSER_TESTS=1 npm test             # sanity
systemctl restart siteramp
```
Rollback = check out the previous commit and restart. The DB migrates forward automatically;
migrations are append-only and never destructive, but take a manual backup before big updates.

## Memory / CPU pressure

Symptoms: OOM kills in `journalctl -k`, scans failing with "engine could not start".
The systemd unit caps the app at 1.5 GB. Fixes in order: lower `SCAN_CONCURRENCY` to 1 in
`.env`; ensure only one Chromium is running (`pkill -u siteramp -f chromium` then restart);
upgrade the VPS a size. One CX22 (2 vCPU/4 GB — or 2 GB variants) handles well over a hundred
paying customers' scan volume at concurrency 2.

## Security incidents

- Leaked `SESSION_SECRET` or server compromise suspicion: rotate `SESSION_SECRET` in `.env`
  + restart (invalidates nothing server-side but breaks CSRF cookies), then
  `sqlite3 data/siteramp.db "DELETE FROM sessions;"` to force re-login everywhere.
- Leaked Stripe key: roll it in the Stripe dashboard, update `.env`, restart.
- A share link leaked: the customer can revoke from the report page (revokes all links for
  that report), or: `sqlite3 data/siteramp.db "UPDATE share_links SET revoked_at=strftime('%s','now') WHERE scan_id=<id>;"`

## Monitoring the monitor

Set up a free external uptime check on `https://APP_DOMAIN/healthz` (HUMAN_ACTIONS lists
this — any provider's free tier works). That plus Stripe's own email receipts is genuinely
all the ops monitoring this system needs at launch scale.
