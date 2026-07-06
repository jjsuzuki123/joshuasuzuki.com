#!/usr/bin/env bash
set -euo pipefail

S3_BUCKET="josh-personal-site-1"
CF_DISTRIBUTION_ID="E3LDS3FK17E3JF"
FANTASY_IMPORT_STACK="rosterlab-fantasy-import-production"
AWS_PROFILE="${AWS_PROFILE:-default}"
AWS_REGION="${AWS_REGION:-us-east-1}"

if [[ ! -f "index.html" ]]; then
  echo "ERROR: index.html not found. Run from repo root."
  exit 1
fi

FANTASY_CONFIG_FILE="$(mktemp)"
trap 'rm -f "${FANTASY_CONFIG_FILE}"' EXIT
IMPORT_ENDPOINT="$(aws cloudformation describe-stacks \
  --stack-name "${FANTASY_IMPORT_STACK}" \
  --query "Stacks[0].Outputs[?OutputKey=='ImportEndpoint'].OutputValue | [0]" \
  --output text \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}")"
IMPORT_ENDPOINT="${IMPORT_ENDPOINT}" node "scripts/write-fantasy-config.js" "${FANTASY_CONFIG_FILE}"

aws s3 sync . "s3://${S3_BUCKET}" \
  --delete \
  --exclude ".git/*" \
  --exclude ".github/*" \
  --exclude ".cursor/*" \
  --exclude ".aws-sam/*" \
  --exclude ".DS_Store" \
  --exclude "deploy.sh" \
  --exclude "debug-pdf-fetch.sh" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "*.zip" \
  --exclude "admin-backend/*" \
  --exclude "fantasy-backend/*" \
  --exclude "fantasy/config.js" \
  --exclude "_deploy/*" \
  --exclude "scripts/*" \
  --exclude "permissions-policy.json" \
  --exclude "trust-policy.json" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}"

aws s3 cp "${FANTASY_CONFIG_FILE}" "s3://${S3_BUCKET}/fantasy/config.js" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "application/javascript; charset=utf-8" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}"

aws s3 cp "s3://${S3_BUCKET}/index.html" "s3://${S3_BUCKET}/index.html" \
  --metadata-directive REPLACE \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html; charset=utf-8" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}"

aws s3 cp "s3://${S3_BUCKET}/resume/index.html" "s3://${S3_BUCKET}/resume/index.html" \
  --metadata-directive REPLACE \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html; charset=utf-8" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}"

aws s3 cp "s3://${S3_BUCKET}/admin/index.html" "s3://${S3_BUCKET}/admin/index.html" \
  --metadata-directive REPLACE \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html; charset=utf-8" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}"

aws s3 cp "s3://${S3_BUCKET}/sunset/index.html" "s3://${S3_BUCKET}/sunset/index.html" \
  --metadata-directive REPLACE \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html; charset=utf-8" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}"

aws s3 cp "s3://${S3_BUCKET}/fantasy/index.html" "s3://${S3_BUCKET}/fantasy/index.html" \
  --metadata-directive REPLACE \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html; charset=utf-8" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}"

aws cloudfront create-invalidation \
  --distribution-id "${CF_DISTRIBUTION_ID}" \
  --paths "/*" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}" >/dev/null

echo "Done ✅  https://www.joshuasuzuki.com"