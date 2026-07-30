# Agent guide

Vanilla HTML/CSS/JS personal site plus RosterLab (browser apps, SAM
Lambdas, Chrome extension). Package manager is **npm**. Do not add
Make, mise, pnpm, or a framework unless a human asks.

## Verify before you ship

```sh
./scripts/verify.sh
# or
npm test
```

No AWS credentials required. PR CI runs this script
(`.github/workflows/ci.yml`). Do not merge with a red **CI / verify**
check.

## Deploy

Production sync is `.github/workflows/deploy.yml` (S3 + CloudFront +
optional SAM stacks). Local `./deploy.sh` and `.cursor/commands/deploy-all.md`
hit production. **Do not deploy or invalidate CloudFront unless the
human explicitly asks.**

## Layout

| Path | What |
|------|------|
| `/`, `/resume/`, `/admin/` | Marketing / admin UI |
| `fantasy/` | RosterLab baseball + football calculator |
| `sunset/` | Afterglow forecast |
| `fantasy-backend/` | ESPN import relay (SAM) |
| `fantasy-insights/` | Firecrawl research service (SAM) |
| `extensions/rosterlab-espn/` | MV3 connector (production origins only) |
| `admin-backend/` | Admin login/messages Lambdas |
| `scripts/` | Tests, verify, config writers |

## Rules of the road

- Keep ESPN session values (`espn_s2`, `SWID`) out of logs, storage, and
  commits. The import relay must stay stateless.
- Do not put Firecrawl keys, JWT secrets, or research access codes in
  the repo, `config.js`, or GitHub variables.
- Prefer small PRs. Fill `.github/PULL_REQUEST_TEMPLATE.md`. A human
  reviews before merge; do not rubber-stamp agent output.
- New tests belong in `scripts/*.test.js` or
  `extensions/rosterlab-espn/tests/` and must be wired through
  `scripts/verify.sh`.

## Factory posture

Skills, automations, auto-merge, and extra cloud agents are deferred
until verify stays green on PRs. See `SOFTWARE_FACTORY_PLAN.md` if
present locally (it is intentionally untracked).
