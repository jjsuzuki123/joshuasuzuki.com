#!/usr/bin/env bash
# Fetches production /resume/ and logs status + body to .cursor/debug.log (NDJSON)
set -euo pipefail
LOG="/Users/jjsuzuki/personal-site/.cursor/debug.log"
URL="https://www.joshuasuzuki.com/resume/"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
STATUS=$(curl -s -o "$TMP" -w "%{http_code}" "$URL")
# Base64-encode first 800 bytes so XML fits in JSON
BODY_B64=$(head -c 800 "$TMP" | base64)
mkdir -p "$(dirname "$LOG")"
printf '%s\n' "{\"location\":\"debug-resume-fetch.sh\",\"message\":\"Resume URL fetch\",\"data\":{\"status\":$STATUS,\"bodyBase64\":\"$BODY_B64\"},\"timestamp\":$(date +%s)000,\"hypothesisId\":\"A\"}" >> "$LOG"
echo "Logged to $LOG (status=$STATUS)"
