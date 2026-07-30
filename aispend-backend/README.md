# Spendscope enrichment service

This service powers the unlisted `/aispend/` product — an Intricately-style
estimate of how much a company spends on AI coding tools (Claude Code,
Cursor, OpenAI Codex, GitHub Copilot, Devin). The UI is company-name first,
not linked from the homepage, and optionally gated by `AccessCode`.

It is deliberately asynchronous:

1. Typeahead hits `POST /v1/aispend/suggest`. Lookup posts a company name or
   domain to `POST /v1/aispend/company`.
2. The API resolves the name via a curated directory (or treats the input as
   a domain), then returns the current DynamoDB record. When there are no
   fresh readings, it atomically claims the row, consumes one unit of the
   daily enrichment budget, and queues a worker message.
3. One worker collects public adoption signals (GitHub + optional Firecrawl
   tool/job mentions and headcount snippets) and stores the readings.
4. The browser polls until readings land, then scores them locally with
   ACES v3 (`aispend/score-engine.js`): an Intricately-style expected-spend
   model — firmographic priors (org scale, tech-forwardness tier, era
   adoption, blended $/engineer) tuned by public evidence, so every sized
   company gets a dollar estimate.

Secrets exist only in AWS Secrets Manager. They are never written to the
static site, the queue, DynamoDB, logs, or the repository.

## What the worker reads

**GitHub (primary, deterministic).** The domain is resolved to its public
GitHub organization(s): the API checks the org whose login matches the
domain's owner label plus org search results, and keeps only orgs whose
public website or email matches the domain. Per matched org it records:

- `filename:CLAUDE.md` and `.claude/settings.json` code-search counts (Claude Code)
- `.cursorrules` and `.cursor/rules` code-search counts (Cursor)
- `AGENTS.md` code-search counts (Codex-style agent instructions)
- `.github/copilot-instructions.md` counts (Copilot)
- commit-search counts for `Co-authored-by: Claude` and `Co-authored-by: Cursor Agent`
- pull requests authored by `devin-ai-integration`, `copilot-swe-agent`,
  `cursor`, `claude`, and `chatgpt-codex-connector` GitHub apps
- public repository and public member counts (headcount proxies)

Code and commit search require an authenticated token. Without one the worker
degrades gracefully: it still resolves the org and counts agent pull
requests, and the stored coverage flags tell the scorer what was checked.

**Web (secondary, optional).** One Firecrawl search-only request (no page
scrapes) looks for public mentions pairing the company with the tools —
jobs, engineering blogs, press. Only HTTPS citation links plus short titles
are stored; result text is classified with deterministic patterns and is
never treated as instructions.

## Cost controls

- The HTTP API is throttled (burst 4, 1 req/s) and CORS-locked to the site.
- New enrichments consume a DynamoDB-enforced daily budget
  (`MaxDailyEnrichments`, 50/day by default) inside the claim transaction.
- A domain is not re-enriched more than once per day (`researchAfter`), and
  readings with signal stay valid for 14 days.
- Firecrawl usage is search-only (about 8 credits per enrichment: tool
  mentions + headcount SERP) behind its own atomic daily budget
  (`MaxDailyFirecrawlCredits`, 100/day by default).
  Set a provider-side Firecrawl project limit as a second billing boundary.
- GitHub calls are capped at 40 per enrichment and back off immediately on
  rate-limit responses. Worker concurrency is 1 with a 2-message queue cap.
- Items carry a 60-day DynamoDB TTL, so the table stays small.

## One-time AWS setup

The shared SAM artifact bucket comes from the existing
`rosterlab-fantasy-import-bootstrap` stack; deploy that first if it does not
exist. Then create the Spendscope roles and secrets:

```sh
aws cloudformation deploy \
  --template-file aispend-backend/bootstrap-template.yaml \
  --stack-name aispend-bootstrap \
  --capabilities CAPABILITY_NAMED_IAM
```

Then in the AWS console:

1. Open **Secrets Manager** → **aispend/github/production**.
2. Choose **Retrieve secret value**, then **Edit**, and store a fine-grained
   GitHub personal access token with **public repository read access only**:

   ```json
   { "token": "github_pat_your_token" }
   ```

3. (Optional) Open **aispend/firecrawl/production** and store a Firecrawl
   key the same way to enable web-mention research:

   ```json
   { "apiKey": "fc-your-key" }
   ```

Apply the updated `permissions-policy.json` to the
`GitHubActionsDeployPersonalSite` role. The production workflow deploys the
`aispend-production` stack once the bootstrap roles exist, reads its
`CompanyEndpoint` output, and writes that HTTPS URL into the no-cache runtime
`aispend/config.js`. Set GitHub Actions secret `AISPEND_ACCESS_CODE` to gate
the unlisted UI and API. Without the GitHub secret filled in, enrichment still
runs in the degraded anonymous mode; without the Firecrawl secret, web
research reports `missing-key` and everything else works.

To explicitly disable the service, add this GitHub Actions repository
variable:

```text
AISPEND_ENABLED=false
```

## Local verification

No tokens or live network requests are needed:

```sh
node scripts/aispend-score-engine.test.js
node scripts/aispend-service.test.js
```

The tests use fixed GitHub/Firecrawl fixtures and mocked AWS boundaries.
