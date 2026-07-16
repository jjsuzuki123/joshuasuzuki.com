# RosterLab Firecrawl research service

This service turns recent, cited baseball reporting into RosterLab's existing
schema-v1 evidence format. It is deliberately asynchronous:

1. The browser requests evidence for at most 12 relevant players. It prioritizes
   active injuries, watchlist players, open trade scenarios, and current trade
   targets.
2. The API returns current DynamoDB records immediately. Only a short-lived
   token signed by the ESPN import relay can queue missing or expiring players.
3. At most two workers search allowlisted domains through Firecrawl.
4. The browser polls quietly for newly cached evidence.

The Firecrawl API key exists only in AWS Secrets Manager. It is never written to
the static site, request queue, DynamoDB, logs, or repository.

## Evidence policy

The worker searches a seven-day window and asks Firecrawl to return main-content
Markdown for at most five results per player. It then uses deterministic parsing
rather than obeying or executing instructions found in page content.

- Redirect destinations must remain HTTPS and inside the configured allowlist.
- Every item keeps its publisher, URL, report time, and an exact supporting
  excerpt.
- Firecrawl-discovered text is always visible context only. It never changes
  player status, category production, or trade value.
- ESPN roster designations and explicitly licensed structured feeds are the
  only model-changing availability and role inputs.
- ESPN's imported roster designation remains the fallback authority.
- Conflicting reports remain separate evidence records.
- RotoWire is not in the default allowlist; use its licensed API instead.

Firecrawl is a retrieval service, not permission to republish third-party
content. Review each configured publisher's terms and robots policy. Do not add
authenticated pages, paywalled pages, or sources for which automated access is
prohibited. RosterLab stores links and short supporting excerpts, not articles.

## Cost controls

One player refresh is budgeted as seven Firecrawl credits: one five-result web
search plus up to five basic Markdown scrapes. DynamoDB atomically enforces
`MaxDailyFirecrawlCredits` (350 by default). Requests force Firecrawl's basic
proxy and disable document parsers so the seven-credit reservation is bounded.
Worker concurrency is capped at two, in-flight leases last five minutes, and a
player is not eligible for another refresh for six hours. Results with evidence
are cached for three days, so the saved player note is reused instead of
starting another search. Empty results are cached for six hours. Set a
provider-side Firecrawl project limit as a second billing boundary. Each signed
import authorization can queue at most 12 players and expires after two hours.

Adjust these CloudFormation parameters in `template.yaml` to match the
Firecrawl plan:

- `FirecrawlAllowedDomains`
- `OfficialSourceDomains` (provenance labeling only)
- `MaxDailyFirecrawlCredits`

## One-time AWS setup

An administrator must update the existing bootstrap stack before enabling the
service. This creates separate API and worker roles, an empty Secrets Manager
secret named `rosterlab/firecrawl/production`, a generated HMAC signing secret,
and a separate generated private access code. The import relay mints a
player-scoped, two-hour authorization only when that private code is supplied.

```sh
aws cloudformation deploy \
  --template-file fantasy-backend/bootstrap-template.yaml \
  --stack-name rosterlab-fantasy-import-bootstrap \
  --capabilities CAPABILITY_NAMED_IAM
```

Then in the AWS console:

1. Open **Secrets Manager**.
2. Open **rosterlab/firecrawl/production**.
3. Choose **Retrieve secret value**, then **Edit**.
4. Store this JSON using the key copied from the Firecrawl dashboard:

   ```json
   { "apiKey": "fc-your-key" }
   ```

5. Save the new version.

Do not put the key in a GitHub variable, Lambda environment variable,
`config.js`, or a repository file.

Open **rosterlab/research-access/production** in Secrets Manager and retrieve
its generated value. Enter that value in RosterLab's **Research access code**
field whenever importing a league. The code is sent only to the stateless import
relay, is never sent to ESPN or Firecrawl, and is cleared from the form after
the request. Treat it like a password and rotate the secret if it is exposed.

Apply the updated `permissions-policy.json` to the
`GitHubActionsDeployPersonalSite` role. The production workflow enables
Firecrawl when the bootstrap roles and current API-key secret are ready. To
explicitly disable research, add this GitHub Actions repository variable:

```text
ROSTERLAB_FIRECRAWL_ENABLED=false
```

The deployment workflow then builds `fantasy-insights/template.yaml`, deploys
`rosterlab-fantasy-insights-production`, reads its `SourceEndpoint` output, and
writes that HTTPS URL into the no-cache runtime `fantasy/config.js`. If
`ROSTERLAB_SOURCE_ENDPOINT` already points to a licensed provider, it remains a
secondary endpoint and both snapshots are merged by ESPN player ID.

## Local verification

No Firecrawl key or live network request is needed:

```sh
node scripts/fantasy-insights.test.js
node scripts/fantasy-source-client.test.js
node scripts/fantasy-trade-engine.test.js
```

The tests use fixed article fixtures and mocked AWS/Firecrawl boundaries.
