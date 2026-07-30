# Spendscope

Unlisted AI coding-tool spend intelligence in the spirit of Intricately.
Enter a **company name** (or domain); the backend enriches public GitHub and
web signals once, stores the readings in DynamoDB, and the browser scores
them locally with ACES v1.

The app lives at `/aispend/` with `noindex`, is not linked from the homepage,
and can sit behind a shared access code (`AISPEND_ACCESS_CODE`). A vanity
host such as `scope.joshuasuzuki.com` can be pointed at the same CloudFront
distribution later — CORS already allows it.

## Model

**ACES v1 — AI Coding Expenditure Signal** (`score-engine.js`)

Per vendor, each stored reading feeds a saturating component, combined with
a noisy-OR so corroborating evidence compounds. Spend is seats × blended
list price (Devin is per concurrent agent). Headcount prefers web-reported
engineer counts, then public GitHub members ×3, then repo count, and can be
overridden in the UI without another API call.

The report includes an analyst **brief**: headline, thesis, vendor mix, and
top evidence drivers.

## Honest limitations

- Modeled from public signals — never billing data.
- Public GitHub only: private-repo usage is invisible and usually larger.
- Prices are blended list prices; negotiated contracts differ.

## Local demo

```sh
node scripts/aispend-demo-server.js
# open http://127.0.0.1:8787/aispend/  (access code: demo-access)
node scripts/aispend-score-engine.test.js
node scripts/aispend-service.test.js
```
