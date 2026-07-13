#!/usr/bin/env bash
#
# Manual deploy helper for the RSVP sniper backend. The GitHub Actions workflow
# does the same steps automatically once the bootstrap stack exists; use this
# for the one-time bootstrap, to populate the config secret, or to deploy from a
# workstation.
#
# Usage:
#   ./deploy-rsvp.sh bootstrap   # one-time: IAM roles + ECR repo (admin creds)
#   ./deploy-rsvp.sh secret      # write Resy creds + admin password into the secret
#   ./deploy-rsvp.sh deploy      # build+push the sniper image and deploy the stack
#   ./deploy-rsvp.sh all         # secret + deploy
#
# Environment:
#   AWS_PROFILE (default: default), AWS_REGION (default: us-east-1)
#   ENVIRONMENT (default: production)
#   SAM_ARTIFACT_BUCKET (default: rosterlab-deploy-artifacts-<acct>-us-east-1)
#   For `secret`: RESY_EMAIL, RESY_PASSWORD, RSVP_ADMIN_PASSWORD (required),
#                 RESY_AUTH_TOKEN, RESY_PROXY_URL, RESY_API_KEY (optional)
#   For `deploy`: NOTIFICATION_EMAIL, NOTIFICATION_SMS (optional)

set -euo pipefail

cmd="${1:-}"
AWS_PROFILE="${AWS_PROFILE:-default}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-production}"
STACK="rsvp-sniper-${ENVIRONMENT}"
BOOTSTRAP_STACK="rsvp-sniper-bootstrap-${ENVIRONMENT}"
ECR_REPO="rsvp-sniper-${ENVIRONMENT}"
SECRET_NAME="rsvp-sniper-${ENVIRONMENT}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${here}"

aws_() { aws --profile "${AWS_PROFILE}" --region "${AWS_REGION}" "$@"; }

account_id() { aws_ sts get-caller-identity --query Account --output text; }

artifact_bucket() {
  echo "${SAM_ARTIFACT_BUCKET:-rosterlab-deploy-artifacts-$(account_id)-us-east-1}"
}

do_bootstrap() {
  echo "Deploying bootstrap stack ${BOOTSTRAP_STACK} (creates IAM roles + ECR repo)..."
  aws_ cloudformation deploy \
    --template-file bootstrap-template.yaml \
    --stack-name "${BOOTSTRAP_STACK}" \
    --parameter-overrides "Environment=${ENVIRONMENT}" \
    --capabilities CAPABILITY_NAMED_IAM
  aws_ cloudformation describe-stacks --stack-name "${BOOTSTRAP_STACK}" \
    --query "Stacks[0].Outputs" --output table
}

do_secret() {
  : "${RSVP_ADMIN_PASSWORD:?set RSVP_ADMIN_PASSWORD}"
  echo "Merging credentials into secret ${SECRET_NAME} (preserving generated jwtSecret)..."
  local current
  current="$(aws_ secretsmanager get-secret-value --secret-id "${SECRET_NAME}" \
    --query SecretString --output text)"
  # Merge new values over the existing JSON; jwtSecret and any unset fields are preserved.
  local merged
  merged="$(RESY_EMAIL="${RESY_EMAIL:-}" \
    RESY_PASSWORD="${RESY_PASSWORD:-}" \
    RESY_AUTH_TOKEN="${RESY_AUTH_TOKEN:-}" \
    RESY_PROXY_URL="${RESY_PROXY_URL:-}" \
    RESY_API_KEY="${RESY_API_KEY:-}" \
    RSVP_ADMIN_PASSWORD="${RSVP_ADMIN_PASSWORD}" \
    node -e '
      const cur = JSON.parse(process.argv[1] || "{}");
      const set = (k, v) => { if (v) cur[k] = v; };
      set("resyEmail", process.env.RESY_EMAIL);
      set("resyPassword", process.env.RESY_PASSWORD);
      set("resyAuthToken", process.env.RESY_AUTH_TOKEN);
      set("proxyUrl", process.env.RESY_PROXY_URL);
      set("resyApiKey", process.env.RESY_API_KEY);
      cur.adminPassword = process.env.RSVP_ADMIN_PASSWORD;
      process.stdout.write(JSON.stringify(cur));
    ' "${current}")"
  aws_ secretsmanager put-secret-value --secret-id "${SECRET_NAME}" \
    --secret-string "${merged}" >/dev/null
  echo "Secret updated."
}

do_deploy() {
  local acct registry repo_uri tag
  acct="$(account_id)"
  registry="${acct}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  repo_uri="${registry}/${ECR_REPO}"
  tag="$(git rev-parse --short=12 HEAD 2>/dev/null || date +%s)"

  echo "Building and pushing sniper image ${repo_uri}:${tag}..."
  docker run --privileged --rm tonistiigi/binfmt --install arm64 >/dev/null 2>&1 || true
  docker buildx create --use --name rsvpbuilder >/dev/null 2>&1 || docker buildx use rsvpbuilder
  aws_ ecr get-login-password | docker login --username AWS --password-stdin "${registry}"
  docker buildx build \
    --platform linux/arm64 \
    --provenance=false \
    --build-arg CURL_IMPERSONATE_ARCH=aarch64 \
    -f sniper/Dockerfile \
    -t "${repo_uri}:${tag}" \
    --push \
    .

  echo "Installing API dependencies..."
  npm ci --omit=dev

  local outputs
  outputs="$(aws_ cloudformation describe-stacks --stack-name "${BOOTSTRAP_STACK}" \
    --query "Stacks[0].Outputs" --output json)"
  get_out() { O="${outputs}" node -e 'const o=JSON.parse(process.env.O);const f=o.find(x=>x.OutputKey===process.argv[1]);process.stdout.write(f?f.OutputValue:"")' "$1"; }
  local api_role sniper_role sched_role
  api_role="$(get_out RequestsApiRoleArn)"
  sniper_role="$(get_out SniperRoleArn)"
  sched_role="$(get_out SchedulerInvokeRoleArn)"

  echo "Packaging and deploying ${STACK}..."
  sam package \
    --template-file template.yaml \
    --s3-bucket "$(artifact_bucket)" \
    --s3-prefix "rsvp-sniper" \
    --output-template-file packaged.yaml \
    --region "${AWS_REGION}"
  sam deploy \
    --template-file packaged.yaml \
    --stack-name "${STACK}" \
    --capabilities CAPABILITY_IAM \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset \
    --region "${AWS_REGION}" \
    --parameter-overrides \
      "Environment=${ENVIRONMENT}" \
      "SniperImageUri=${repo_uri}:${tag}" \
      "RequestsApiRoleArn=${api_role}" \
      "SniperRoleArn=${sniper_role}" \
      "SchedulerInvokeRoleArn=${sched_role}" \
      "NotificationEmail=${NOTIFICATION_EMAIL:-}" \
      "NotificationSms=${NOTIFICATION_SMS:-}"

  aws_ cloudformation describe-stacks --stack-name "${STACK}" \
    --query "Stacks[0].Outputs" --output table
}

case "${cmd}" in
  bootstrap) do_bootstrap ;;
  secret) do_secret ;;
  deploy) do_deploy ;;
  all) do_secret; do_deploy ;;
  *)
    echo "Usage: $0 {bootstrap|secret|deploy|all}" >&2
    exit 1
    ;;
esac
