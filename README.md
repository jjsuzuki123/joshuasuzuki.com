# joshuasuzuki.com

Personal website and RosterLab fantasy baseball analyzer built with vanilla
HTML, CSS, and JavaScript.

## Local development

No install step for the static site. Use any local static server, or open
files directly in a browser.

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`, `/fantasy/`, `/fantasy/football/`, or
`/sunset/`.

**Gotcha:** the ESPN connector extension matches production RosterLab URLs
only. It does not activate on localhost. See
`extensions/rosterlab-espn/README.md`.

### Verify

Requires Node 22+. No AWS credentials.

```sh
./scripts/verify.sh
# or
npm test
```

GitHub Actions runs the same script on every pull request
(`.github/workflows/ci.yml`). Production deploy is separate
(`.github/workflows/deploy.yml`) and only assumes the AWS role after
verify + `sam validate` succeed.

If deploy fails with `AssumeRoleWithWebIdentity`, apply
`trust-policy.json` to IAM role `GitHubActionsDeployPersonalSite`. The
`sub` claim must be `repo:joshsuzuki-ae/joshuasuzuki.com:ref:refs/heads/main`.

Mark **CI / verify** as a required status check on `main` (Settings →
Branches). The GitHub API from this environment cannot set branch
protection.

## Architecture
- Static site hosted on S3
- Served via CloudFront
- Custom domain: joshuasuzuki.com
- Backend APIs via AWS API Gateway + Lambdas (contact form + admin)
- Optional Manifest V3 browser connector for private ESPN fantasy leagues
- RosterLab private ESPN imports via a stateless API Gateway + Lambda relay
- Cache-backed, cited Firecrawl research for current baseball player news

## Projects
- `/fantasy/`: RosterLab fantasy baseball trade analysis
- `/fantasy/football/`: Redraft football trade calculator
- `/sunset/`: Afterglow sunset quality forecast
