#!/usr/bin/env bash
# One-time VPS setup for SiteRamp on a fresh Ubuntu 24.04 box (Hetzner CX22 or
# similar, 2 GB+ RAM). Run as root. Idempotent-ish; safe to re-run.
#
#   1. Point your app subdomain's DNS A record at the server first.
#   2. scp -r the app directory to /opt/siteramp/app (or git clone your repo).
#   3. APP_DOMAIN=app.yourdomain.com bash scripts/deploy-vps.sh
#
# What it does: installs Node 22 + Caddy, installs deps + Chromium, creates a
# systemd service, and serves HTTPS via Caddy with automatic certificates.
set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:?Set APP_DOMAIN=app.yourdomain.com}"
APP_DIR="${APP_DIR:-/opt/siteramp/app}"
APP_USER="siteramp"

echo "== packages"
apt-get update -qq
apt-get install -y -qq curl git sqlite3 debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
fi

echo "== app user + dirs"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
[[ -f "$APP_DIR/package.json" ]] || { echo "Put the app at $APP_DIR first (git clone or scp)."; exit 1; }

echo "== dependencies + browser"
cd "$APP_DIR"
sudo -u "$APP_USER" -H npm ci --omit=dev 2>/dev/null || npm ci --omit=dev
npx playwright install-deps chromium
sudo -u "$APP_USER" -H npx playwright install chromium

echo "== env file"
if [[ ! -f "$APP_DIR/.env" ]]; then
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
BASE_URL=https://$APP_DOMAIN
DATA_DIR=$APP_DIR/data
SESSION_SECRET=$(openssl rand -hex 32)
SUPPORT_EMAIL=support@example.com
BILLING_MODE=disabled
ALLOW_UNBILLED_PRODUCTION=yes
EOF
  echo "!! Wrote $APP_DIR/.env with billing DISABLED."
  echo "!! Before charging money: set BILLING_MODE=stripe + keys, remove ALLOW_UNBILLED_PRODUCTION, set SUPPORT_EMAIL."
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "== systemd service"
cat > /etc/systemd/system/siteramp.service <<EOF
[Unit]
Description=SiteRamp
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$(command -v npx) tsx src/server.ts
Restart=always
RestartSec=3
MemoryMax=1500M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$APP_DIR/data

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now siteramp

echo "== caddy (auto-HTTPS)"
cat > /etc/caddy/Caddyfile <<EOF
$APP_DOMAIN {
  reverse_proxy 127.0.0.1:3000
  encode gzip
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
  }
}
EOF
systemctl reload caddy

echo "== backups (cron)"
( crontab -l 2>/dev/null | grep -v siteramp-backup ; echo "15 3 * * * cd $APP_DIR && DATA_DIR=$APP_DIR/data bash scripts/backup.sh >> /var/log/siteramp-backup.log 2>&1" ) | crontab -

echo
echo "Done. Check: systemctl status siteramp ; curl -s https://$APP_DOMAIN/healthz"
