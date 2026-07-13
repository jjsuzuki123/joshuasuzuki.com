#!/usr/bin/env bash
# Nightly SQLite backup with 30-day retention. Run via cron (see RUNBOOK.md):
#   15 3 * * * cd /opt/siteramp/app && bash scripts/backup.sh >> /var/log/siteramp-backup.log 2>&1
set -euo pipefail

DATA_DIR="${DATA_DIR:-./data}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
DB="$DATA_DIR/siteramp.db"
STAMP="$(date +%Y%m%d-%H%M%S)"

[[ -f "$DB" ]] || { echo "No database at $DB — nothing to back up."; exit 0; }
mkdir -p "$BACKUP_DIR"

# .backup takes a consistent snapshot even while the app is running (WAL mode).
sqlite3 "$DB" ".backup '$BACKUP_DIR/siteramp-$STAMP.db'"
gzip "$BACKUP_DIR/siteramp-$STAMP.db"

# Copy uploaded logos alongside (small, cheap).
if [[ -d "$DATA_DIR/logos" ]]; then
  tar -czf "$BACKUP_DIR/logos-$STAMP.tar.gz" -C "$DATA_DIR" logos
fi

# Retention: delete backups older than 30 days.
find "$BACKUP_DIR" -name '*.gz' -mtime +30 -delete

echo "[$(date -Is)] backup ok: siteramp-$STAMP.db.gz ($(du -h "$BACKUP_DIR/siteramp-$STAMP.db.gz" | cut -f1))"
