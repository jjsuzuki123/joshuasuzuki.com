# RosterLab ESPN import relay

ESPN does not offer OAuth or a supported fantasy API. Private leagues require
the `espn_s2` and `SWID` values from an active ESPN browser session.

This relay accepts those values for one request, calls a fixed ESPN fantasy
baseball endpoint, and returns the league payload to RosterLab. It does not
store credentials or league data. ESPN may continue accepting the same session
values after the request, so users must still treat them like passwords.

The relay imports the injury designation already present in the league payload,
but it does not crawl ESPN, Yahoo, or other news pages. Recent player news and
return timelines belong behind RosterLab's separate `fantasy-insights/`
service. That service uses a server-held Firecrawl key, an explicit publisher
allowlist, citations, and corroboration rules; ESPN session values never cross
into it.

## Security controls

- Only configured RosterLab origins can call the function from a browser.
- The destination host and URL shape are fixed in code.
- IDs, cookie values, request size, and response size are validated.
- Cookie values containing control characters or separators are rejected.
- API Gateway throttles requests and Lambda reserved concurrency limits spend.
- API and Lambda responses disable caching.
- The function never logs request bodies, ESPN payloads, or session values.
- CloudWatch retains error-only logs for seven days.

The browser clears session fields after every request and never writes them to
local storage. Users should still treat both values like passwords.

## Deploy

The SAM stack creates an HTTP API, one arm64 Lambda function, a least-privilege
seven-day function and API log groups, and CloudWatch error alarms.

An AWS administrator must run the bootstrap stack once. It creates the
log-only Lambda execution role and a private, encrypted, versioned artifact
bucket. The day-to-day GitHub role can pass that fixed role to Lambda but cannot
create or modify IAM roles. Artifacts are retained so CloudFormation can always
roll back to a previously deployed function package. Updating the same
bootstrap stack also creates separate narrowly scoped Firecrawl API/worker
roles, an empty Firecrawl-key secret, and a generated request-signing secret; it
does not enable or deploy web research.

```sh
aws cloudformation deploy \
  --template-file fantasy-backend/bootstrap-template.yaml \
  --stack-name rosterlab-fantasy-import-bootstrap \
  --capabilities CAPABILITY_NAMED_IAM
```

Then update the IAM permissions policy on `GitHubActionsDeployPersonalSite` to
cover the new stacks. The policy is managed directly in IAM and intentionally
not stored in this public repository.

```sh
sam build --template-file fantasy-backend/template.yaml
sam package \
  --s3-bucket rosterlab-deploy-artifacts-545095759709-us-east-1 \
  --s3-prefix rosterlab \
  --output-template-file fantasy-backend/packaged.yaml
sam deploy \
  --template-file fantasy-backend/packaged.yaml \
  --stack-name rosterlab-fantasy-import-production \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset
```

After deployment, write the `ImportEndpoint` stack output to
`fantasy/config.js`. The site deployment workflow performs these steps before
uploading the static site.

At low traffic, Lambda and API Gateway normally remain inside their free
tiers. Outside the free tier, HTTP API requests cost about $1 per million plus
Lambda execution and data transfer.
