#!/usr/bin/env bash
set -euo pipefail

# ====== Config (edit if needed) ======
S3_BUCKET="josh-personal-site-1"
CF_DISTRIBUTION_ID="E3LDS3FK17E3JF"
AWS_PROFILE="${AWS_PROFILE:-default}"   # optionally set AWS_PROFILE env var
AWS_REGION="${AWS_REGION:-us-east-1}"

# ====== Safety checks ======
if [[ ! -f "index.html" ]]; then
  echo "ERROR: index.html not found. Run this script from your site repo root."
  exit 1
fi

echo "Deploying to s3://${S3_BUCKET} (region: ${AWS_REGION}, profile: ${AWS_PROFILE})"

# Sync everything (delete removed files)
aws s3 sync . "s3://${S3_BUCKET}" \
  --delete \
  --exclude ".git/*" \
  --exclude ".github/*" \
  --exclude ".DS_Store" \
  --exclude "deploy.sh" \
  --exclude ".env" \
  --exclude ".env.*" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}"

# Optional: ensure HTML isn't cached too aggressively (recommended)
# This sets index.html and any html files to no-cache.
# If you prefer to manage caching solely in CloudFront behaviors, you can comment these out.
aws s3 cp "s3://${S3_BUCKET}/index.html" "s3://${S3_BUCKET}/index.html" \
  --metadata-directive REPLACE \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html; charset=utf-8" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}"

# If you have other HTML pages, you can add explicit commands like:
# aws s3 cp "s3://${S3_BUCKET}/resume/index.html" "s3://${S3_BUCKET}/resume/index.html" \
#   --metadata-directive REPLACE \
#   --cache-control "no-cache, no-store, must-revalidate" \
#   --content-type "text/html; charset=utf-8" \
#   --profile "${AWS_PROFILE}" \
#   --region "${AWS_REGION}"

echo "Creating CloudFront invalidation..."
aws cloudfront create-invalidation \
  --distribution-id "${CF_DISTRIBUTION_ID}" \
  --paths "/*" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}" >/dev/null

echo "Done ✅  https://www.joshuasuzuki.com"
