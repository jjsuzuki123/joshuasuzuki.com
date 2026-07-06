# RosterLab ESPN import relay

ESPN does not offer OAuth or a supported fantasy API. Private leagues require
the `espn_s2` and `SWID` values from an active ESPN browser session.

This relay accepts those values for one request, calls a fixed ESPN fantasy
baseball endpoint, and returns the league payload to RosterLab. It does not
store credentials or league data.

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
execution role, and a seven-day log group.

```sh
sam build --template-file fantasy-backend/template.yaml
sam package \
  --s3-bucket josh-personal-site-1 \
  --s3-prefix _deploy/rosterlab \
  --output-template-file fantasy-backend/packaged.yaml
sam deploy \
  --template-file fantasy-backend/packaged.yaml \
  --stack-name rosterlab-fantasy-import-production \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset
```

After deployment, write the `ImportEndpoint` stack output to
`fantasy/config.js`. The site deployment workflow performs these steps before
uploading the static site.

Before the first deployment, apply the repository's updated
`permissions-policy.json` to the `GitHubActionsDeployPersonalSite` role. The
policy limits backend deployment access to the RosterLab stack, function, role,
API, and log group.

At low traffic, Lambda and API Gateway normally remain inside their free
tiers. Outside the free tier, HTTP API requests cost about $1 per million plus
Lambda execution and data transfer.
