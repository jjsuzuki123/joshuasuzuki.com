cat > deploy.sh <<'BASH'
#!/usr/bin/env bash
set -euo pipefail

S3_BUCKET="josh-personal-site-1"
CF_DISTRIBUTION_ID="E3LDS3FK17E3JF"
AWS_PROFILE="${AWS_PROFILE:-default}"
AWS_REGION="${AWS_REGION:-us-east-1}"

if [[ ! -f "index.html" ]]; then
  echo "ERROR: index.html not found. Run from repo root."
  exit 1
fi

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

aws cloudfront create-invalidation \
  --distribution-id "${CF_DISTRIBUTION_ID}" \
  --paths "/*" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}" >/dev/null

echo "Done ✅  https://www.joshuasuzuki.com"
BASH

chmod +x deploy.sh
