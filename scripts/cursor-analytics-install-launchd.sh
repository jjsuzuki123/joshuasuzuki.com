#!/usr/bin/env bash
# Install a macOS launchd job that refreshes the Cursor analytics canvas daily.
#
# What it does:
#   1. Stores your admin-scoped Cursor API key in ~/.config/cursor-analytics/env
#      (chmod 600) if not already present.
#   2. Installs ~/Library/LaunchAgents/com.jjsuzuki.cursor-analytics-refresh.plist
#      to run scripts/cursor-analytics-refresh.mjs every day at 07:30 local time
#      (and once at login if the scheduled run was missed).
#   3. Kicks off an immediate refresh so the canvas is fresh right away.
#
# Usage (from the repo root on your Mac):
#   ./scripts/cursor-analytics-install-launchd.sh
#   CURSOR_ADMIN_KEY=crsr_... ./scripts/cursor-analytics-install-launchd.sh   # non-interactive
#
# Logs: ~/Library/Logs/cursor-analytics-refresh.log
# Uninstall: launchctl bootout gui/$UID/com.jjsuzuki.cursor-analytics-refresh \
#   && rm ~/Library/LaunchAgents/com.jjsuzuki.cursor-analytics-refresh.plist
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This installer targets macOS launchd. On other systems, add a cron entry like:"
  echo "  30 7 * * * cd $(pwd) && node scripts/cursor-analytics-refresh.mjs >> ~/cursor-analytics-refresh.log 2>&1"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.jjsuzuki.cursor-analytics-refresh"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
ENV_DIR="$HOME/.config/cursor-analytics"
ENV_FILE="$ENV_DIR/env"
LOG_FILE="$HOME/Library/Logs/cursor-analytics-refresh.log"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: node not found on PATH. Install Node.js >= 18 first." >&2
  exit 1
fi

# --- 1. API key ------------------------------------------------------------
mkdir -p "$ENV_DIR"
if [[ -f "$ENV_FILE" ]] && grep -q "CURSOR_ADMIN_KEY=" "$ENV_FILE"; then
  echo "Using existing key in $ENV_FILE"
else
  KEY="${CURSOR_ADMIN_KEY:-}"
  if [[ -z "$KEY" ]]; then
    echo "Paste your ADMIN-SCOPED team API key (admin:* scope, from cursor.com/dashboard -> API Keys)."
    echo "Note: user-scoped keys (Cloud Agents) will NOT work for the Analytics API."
    read -r -s -p "API key: " KEY
    echo
  fi
  if [[ -z "$KEY" ]]; then
    echo "ERROR: no key provided." >&2
    exit 1
  fi
  umask 177
  printf 'CURSOR_ADMIN_KEY=%s\n' "$KEY" > "$ENV_FILE"
  umask 022
  echo "Wrote $ENV_FILE (chmod 600)"
fi
chmod 600 "$ENV_FILE"

# --- 2. launchd plist -------------------------------------------------------
mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG_FILE")"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd '${REPO_ROOT}' &amp;&amp; '${NODE_BIN}' scripts/cursor-analytics-refresh.mjs</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>7</integer>
    <key>Minute</key>
    <integer>30</integer>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$UID/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
echo "Installed launchd job ${LABEL} (daily 07:30 + at login)."

# --- 3. First refresh -------------------------------------------------------
echo "Running first refresh now..."
launchctl kickstart "gui/$UID/${LABEL}" 2>/dev/null || (cd "$REPO_ROOT" && "$NODE_BIN" scripts/cursor-analytics-refresh.mjs)
echo "Done. Tail logs with: tail -f '$LOG_FILE'"
