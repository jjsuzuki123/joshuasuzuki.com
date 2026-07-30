# Spendscope

Unlisted AI coding-tool spend intelligence in the spirit of Intricately.
Enter a **company name** (or domain); the backend enriches public GitHub and
web signals once, stores the readings in DynamoDB, and the browser scores
them locally with ACES v3.

The app lives at `/aispend/` with `noindex`, is not linked from the homepage,
and can sit behind a shared access code (`AISPEND_ACCESS_CODE`). A vanity
host such as `scope.joshuasuzuki.com` can be pointed at the same CloudFront
distribution later — CORS already allows it.

## Model

**ACES v3 — expected-spend model** (`score-engine.js`)

Earlier versions gated dollars behind public GitHub markers, so a
private-monorepo shop (e.g. Wealthfront) scored $0 and per-seat list prices
undershot real contracts (Stripe pays ~$2.5M/yr for Cursor alone). v3 works
like Intricately: every sized company gets a modeled dollar value, and
being wrong sometimes beats refusing to answer.

1. **Size the engineering org** — curated directory scale, SEC/web
   headcount mentions, then aggressive GitHub expansion (public membership
   is a thin slice at real companies).
2. **Classify tech-forwardness** from many sources — curated firmographic
   tier (AI-native → traditional), GitHub org profile (verified, eng blog,
   OSS footprint), job posts, and any direct AI marker.
3. **Apply era priors** — expected adoption rate (25–95% of engineers) and
   blended per-engineer monthly spend ($110–$630, seats + token/API +
   agents — far above any list price), with volume discounts at scale.
4. **Tune with evidence** — public markers multiply the estimate up to
   1.25×; absence of markers only trims it (0.6–0.85×) because private
   repos are invisible. Spend allocates across Claude Code, Cursor, OpenAI
   Codex, Copilot, and Devin by prior mix blended with observed signal
   share. Enterprise ACV floors still apply at large orgs.

Calibration anchors:

- **Stripe** (3,200 eng, tech-forward, heavy public markers): ~$17M/yr
  total stack, Cursor ~$5.6M — clears the known ~$2.5M contract.
- **Wealthfront** (195 eng, tech-forward, zero public markers): ~$0.9M/yr
  prior-led estimate with a $0.5M–$1.8M band, instead of v2's $0.

The report shows the tech-forwardness score, blended $/engineer/mo, an
analyst brief, and per-vendor bands. Headcount can be overridden in the UI
and re-scores instantly.

## Honest limitations

- Expected-spend model — not invoices; prior-led reads carry wide bands.
- Private repos and API bills are invisible; absence of evidence is weak
  evidence of absence.
- Directory tiers and per-engineer economics are coarse dials — recalibrate
  as real contract data accumulates.

## Local demo

```sh
node scripts/aispend-demo-server.js
# open http://127.0.0.1:8787/aispend/  (access code: demo-access)
node scripts/aispend-score-engine.test.js
node scripts/aispend-service.test.js
```
