# Spendscope

Spendscope estimates how much a company spends on AI coding tools — in the
spirit of Intricately's cloud-spend intelligence, but for Claude Code,
Cursor, OpenAI Codex, GitHub Copilot, and Devin. Enter a company domain; the
backend enriches it from public signals once, stores the readings in
DynamoDB, and the browser scores them locally.

## Model

**ACES v1 — AI Coding Expenditure Signal** (`score-engine.js`, shared
between the browser and Node tests)

Per vendor, each stored reading feeds a bounded component with a saturating
count curve:

\[
c_i = w_i \cdot \frac{v}{v + k_i}
\]

Repository markers (CLAUDE.md, `.cursorrules`, AGENTS.md, …) also earn
credit for covering a small org's repositories, so a 10-repo startup with 5
markers is not outscored by a 500-repo enterprise with 5. Components combine
with a noisy-OR so corroborating evidence compounds without any single count
dominating:

\[
\text{adoption} = 100 \cdot \left(1 - \prod_i (1 - c_i)\right)
\]

Spend is seats times blended list price:

\[
\text{seats} = \text{devs} \cdot p_{\max} \cdot \frac{\text{adoption}}{100},
\qquad
\text{mid} = \text{seats} \cdot \text{price}
\]

Devin is priced per concurrent agent (sized from public agent pull-request
volume) rather than per developer. The low/high band widens as coverage
confidence drops. Developer headcount comes from public GitHub org members
(×3, membership is opt-in), falls back to repository count, and can be
overridden in the UI — the report re-scores instantly without another API
call.

| Signal family | Examples | Why it matters |
| --- | --- | --- |
| Repo markers | CLAUDE.md, .cursor/rules, AGENTS.md, copilot-instructions.md | Tool is wired into the workflow |
| Attribution trails | `Co-authored-by: Claude`, `Co-authored-by: Cursor Agent` commits | Sustained usage volume |
| Agent pull requests | devin-ai-integration, copilot-swe-agent, claude, cursor bots | Paid agent products in production |
| Web mentions | jobs, engineering blogs, press (cited links) | Corroboration beyond GitHub |

Confidence reflects coverage (org resolved, code/commit/PR search ran, web
research ran) and reading age. It is a data-quality indicator, not a
calibrated probability.

## Honest limitations

- Estimates are modeled from public signals — never billing data.
- Public GitHub only: private-repo usage is invisible and usually larger,
  so treat results as a floor stated with wide uncertainty.
- Prices are blended list prices; negotiated contracts differ.
- AGENTS.md is becoming a cross-tool convention, so it is attributed to
  OpenAI with reduced weight.

## Performance

No framework, no web fonts, no image payloads. Readings are cached
server-side (DynamoDB, 14-day validity) and locally (10-minute
`localStorage` cache), so repeat lookups render instantly and re-scoring
with a manual headcount is pure client-side math.

```sh
node scripts/aispend-score-engine.test.js
node scripts/aispend-service.test.js
```
