# deploy-all

run:
gh workflow run deploy.yml && aws cloudfront create-invalidation --distribution-id E3LDS3FK17E3JF --paths "/*"

This command will be available in chat with /deploy-all
