#!/usr/bin/env bash
set -euo pipefail

S3_BUCKET="josh-personal-site-1"
CF_DISTRIBUTION_ID="E3LDS3FK17E3JF"
FANTASY_IMPORT_STACK="rosterlab-fantasy-import-production"
AWS_PROFILE="${AWS_PROFILE:-default}"
AWS_REGION="${AWS_REGION:-us-east-1}"
SOURCE_ENDPOINT="${SOURCE_ENDPOINT:-}"

if [[ ! -f "index.html" ]]; then
  echo "ERROR: index.html not found. Run from repo root."
  exit 1
fi

FANTASY_CONFIG_FILE="$(mktemp)"
trap 'rm -f "${FANTASY_CONFIG_FILE}"' EXIT
cp "fantasy/config.js" "${FANTASY_CONFIG_FILE}"
if IMPORT_ENDPOINT="$(aws cloudformation describe-stacks \
    --stack-name "${FANTASY_IMPORT_STACK}" \
    --query "Stacks[0].Outputs[?OutputKey=='ImportEndpoint'].OutputValue | [0]" \
    --output text \
    --profile "${AWS_PROFILE}" \
    --region "${AWS_REGION}" 2>/dev/null)" &&
    [[ "${IMPORT_ENDPOINT}" == https://* ]]; then
  IMPORT_ENDPOINT="${IMPORT_ENDPOINT}" \
    SOURCE_ENDPOINT="${SOURCE_ENDPOINT}" \
    node "scripts/write-fantasy-config.js" "${FANTASY_CONFIG_FILE}"
else
  echo "Fantasy backend is not ready; deploying the static app without private import."
  IMPORT_ENDPOINT="" \
    SOURCE_ENDPOINT="${SOURCE_ENDPOINT}" \
    node "scripts/write-fantasy-config.js" "${FANTASY_CONFIG_FILE}"
fi

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
  --exclude "extensions/*" \
  --exclude "fantasy-backend/*" \
  --exclude "fantasy/config.js" \
  --exclude "_deploy/*" \
  --exclude "scripts/*" \
  --exclude "permissions-policy.json" \
  --exclude "permissions-policy-expanded.json" \
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

aws s3 cp "s3://${S3_BUCKET}/fantasy/football/index.html" "s3://${S3_BUCKET}/fantasy/football/index.html" \
  --metadata-directive REPLACE \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html; charset=utf-8" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}"

for key in \
  "fantasy/connector/index.html" \
  "fantasy/connector/privacy.html"; do
  if aws s3api head-object --bucket "${S3_BUCKET}" --key "${key}" \
    --profile "${AWS_PROFILE}" --region "${AWS_REGION}" >/dev/null 2>&1; then
    aws s3 cp "s3://${S3_BUCKET}/${key}" "s3://${S3_BUCKET}/${key}" \
      --metadata-directive REPLACE \
      --cache-control "no-cache, no-store, must-revalidate" \
      --content-type "text/html; charset=utf-8" \
      --profile "${AWS_PROFILE}" \
      --region "${AWS_REGION}"
  fi
done

for key in "sunset" "sunset/"; do
  aws s3api put-object \
    --bucket "${S3_BUCKET}" \
    --key "${key}" \
    --body "sunset/index.html" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --content-type "text/html; charset=utf-8" \
    --profile "${AWS_PROFILE}" \
    --region "${AWS_REGION}" >/dev/null
done

for key in "fantasy" "fantasy/"; do
  aws s3api put-object \
    --bucket "${S3_BUCKET}" \
    --key "${key}" \
    --body "fantasy/index.html" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --content-type "text/html; charset=utf-8" \
    --profile "${AWS_PROFILE}" \
    --region "${AWS_REGION}" >/dev/null
done

for key in "fantasy/football" "fantasy/football/"; do
  aws s3api put-object \
    --bucket "${S3_BUCKET}" \
    --key "${key}" \
    --body "fantasy/football/index.html" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --content-type "text/html; charset=utf-8" \
    --profile "${AWS_PROFILE}" \
    --region "${AWS_REGION}" >/dev/null
done

aws cloudfront create-invalidation \
  --distribution-id "${CF_DISTRIBUTION_ID}" \
  --paths "/*" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}" >/dev/null

echo "Done ✅  https://www.joshuasuzuki.com"
