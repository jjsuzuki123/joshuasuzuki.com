# deploy-all

Only run when the human explicitly asks to deploy production.

Prereq: `./scripts/verify.sh` is green. Prefer letting
`.github/workflows/deploy.yml` on `main` deploy after verify, instead of
this command.

run:
./scripts/verify.sh && gh workflow run deploy.yml

This command will be available in chat with /deploy-all

