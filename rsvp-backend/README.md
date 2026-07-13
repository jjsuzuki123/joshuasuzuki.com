# NYC RSVP sniper backend

Auto-books hard-to-get NYC restaurant reservations the moment they are released.
`nycrsvps.com` is the source of truth for *when* a restaurant drops tables; this
backend computes the exact release instant, wakes a Lambda about a minute
before, and fires a Resy booking at the exact release millisecond.

## How it works

```
/rsvp page ──> Requests API (Lambda) ──> DynamoDB (requests + results)
                     │                      ▲
                     │ computes release     │ outcome
                     ▼                      │
             EventBridge Scheduler ── wakes ~90s early ──> Sniper (container Lambda)
                                                                │
                     Secrets Manager (Resy creds, proxy) ───────┤
                                                                ▼
                                                          api.resy.com
                                                                │
                                                     SNS (SMS / email) notify
```

- **Release-rule engine** (`release-rules.js`): turns a dining date into the
  exact release instant in `America/New_York`, DST-safe. Supports daily
  (days-out), weekly (e.g. Balthazar Saturdays), monthly (e.g. EMP 1st of prev
  month), and manual overrides.
- **Requests API** (`requests-api/`): password login (JWT), lists snapshot
  restaurants, and CRUD for snipe requests. Creating a request computes the
  release time and creates a one-time EventBridge Scheduler schedule that wakes
  the sniper ~90 seconds early.
- **Sniper** (`sniper/`, container image): on wake it authenticates, pre-warms
  the connection, measures its clock offset + RTT against Resy, then busy-waits
  and fires `find -> details -> book` at the exact release millisecond, ranking
  in-window slots and falling back across candidates on a race. Writes the
  outcome to DynamoDB and notifies via SNS.

### Beating bot detection

The sniper's HTTP goes through `impers` (a `libcurl-impersonate` binding) so the
TLS/JA3/JA4 + HTTP-2 fingerprint matches real Chrome — the default Node OpenSSL
handshake is trivially flagged by Cloudflare/WAFs. The container image bundles
the `libcurl-impersonate` shared library (see `sniper/Dockerfile`). Request
velocity is kept human-like outside the drop, and the drop-moment burst is short
and bounded. An optional outbound US proxy can be configured in the secret.

## One-time setup (administrator)

1. **Bootstrap** the IAM roles and ECR repository (needs an admin/role that can
   create IAM roles):

   ```bash
   ./deploy-rsvp.sh bootstrap
   ```

2. **Populate the config secret** (`rsvp-sniper-production`). The stack generates
   a random `jwtSecret`; this merges your credentials in without clobbering it:

   ```bash
   RSVP_ADMIN_PASSWORD='choose-a-strong-password' \
   RESY_EMAIL='you@example.com' \
   RESY_PASSWORD='your-resy-password' \
   ./deploy-rsvp.sh secret
   ```

   Optional keys: `RESY_AUTH_TOKEN` (skip email/password), `RESY_PROXY_URL`
   (e.g. `http://user:pass@host:port`), `RESY_API_KEY` (if Resy rotates the
   public web-app key). A credit card must already be saved on the Resy profile;
   some venues require it to book.

3. **Grant the CI deploy role** the extra permissions in
   [`deploy-policy.json`](deploy-policy.json) (append to the existing
   `GitHubActionsDeployPersonalSite` policy). The bootstrap step above is the
   only part that needs admin `iam:CreateRole`.

Once the ECR repo exists, the GitHub Actions workflow builds/pushes the sniper
image and deploys the stack on every push to `main`. To deploy manually:

```bash
NOTIFICATION_EMAIL='you@example.com' ./deploy-rsvp.sh deploy
```

## Notifications

Set repo Actions variables `RSVP_NOTIFICATION_EMAIL` and/or
`RSVP_NOTIFICATION_SMS` (E.164, e.g. `+12125550123`), or pass
`NOTIFICATION_EMAIL` / `NOTIFICATION_SMS` to `deploy-rsvp.sh deploy`. Email
subscriptions require a one-time confirmation click; SMS requires the account to
be out of the SNS SMS sandbox (or the number to be verified in the sandbox).

## Network access

Building/testing the Resy client and snapshot from a restricted environment
needs `api.resy.com`, `resy.com`, `www.nycrsvps.com`, and
`github.com`/`objects.githubusercontent.com` (curl-impersonate release binaries)
allowlisted. Deployed Lambdas run in AWS and are unaffected.

## Tests

Pure logic is unit-tested with plain `node` (see `../scripts/rsvp-*.test.js`):
release-rule math (incl. DST), slot ranking, the Resy client (fake transport),
request validation/scheduling, and the sniper loop (fake client + fake clock).

```bash
npm test   # from this directory
```

## Caveats and risk

- Resy's Terms of Service prohibit automation and enforcement is
  account-level: a flagged account can be terminated and its reservations
  cancelled. Low-volume personal use with the anti-detection measures above is
  the mitigation, but the risk is not zero.
- Millisecond timing is optimized (warm connection, synced clock, parallel
  fire) but not guaranteed to beat every competing service.
- `nycrsvps.com` schedules drift; the UI shows the computed release time and
  every field is overridable per request. Snapshot `resyVenueId` is left null on
  purpose — the sniper resolves and name-verifies the venue at run time so a
  stale slug fails safe instead of booking the wrong restaurant.
- Non-Resy / phone-only venues (e.g. The Polo Bar) are not auto-booked; they get
  a reminder notification with the booking link instead.
