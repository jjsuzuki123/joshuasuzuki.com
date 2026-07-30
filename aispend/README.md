# Spendscope

Unlisted AI coding-tool spend intelligence in the spirit of Intricately.
Enter a **company name** (or domain); the backend enriches public GitHub and
web signals once, stores the readings in DynamoDB, and the browser scores
them locally with ACES v2.

The app lives at `/aispend/` with `noindex`, is not linked from the homepage,
and can sit behind a shared access code (`AISPEND_ACCESS_CODE`). A vanity
host such as `scope.joshuasuzuki.com` can be pointed at the same CloudFront
distribution later — CORS already allows it.

## Model

**ACES v2 — AI Coding Expenditure Signal** (`score-engine.js`)

Public GitHub/web hits are an iceberg tip, not a seat census. v1's
file-count × SMB list-price math produced nonsense like “$8k/mo at Stripe”
while a single Cursor enterprise contract can be ~$2.5M/yr.

v2:

1. **Size the org** — curated directory scale, web employee/engineer
   mentions, then aggressive GitHub expansion (public membership is a thin
   slice at bigcos).
2. **Tier adoption** from public signals (trace → company-wide). Markers and
   job posts mean private-repo usage is assumed.
3. **Price enterprise ACV** = eng × tier penetration × effective $/seat,
   with annual contract floors for large orgs (Cursor calibrated to a
   $2.5M Stripe-scale deal).

The report includes an analyst **brief**: headline, thesis, vendor mix, and
top evidence drivers. Headcount can be overridden in the UI.

## Honest limitations

- Modeled estimate — not invoices or leaked contracts.
- Private-repo + API spend is inferred once a tool looks like an org standard.
- Directory scale and ACV floors are coarse; override headcount when you know better.

## Local demo

```sh
node scripts/aispend-demo-server.js
# open http://127.0.0.1:8787/aispend/  (access code: demo-access)
node scripts/aispend-score-engine.test.js
node scripts/aispend-service.test.js
```
