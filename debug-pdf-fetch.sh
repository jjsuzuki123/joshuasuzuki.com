#!/usr/bin/env bash
# Fetches production PDF URL and logs status, headers, and body start to debug.log (NDJSON)
set -euo pipefail
LOG="/Users/jjsuzuki/personal-site/.cursor/debug.log"
URL="https://www.joshuasuzuki.com/Josh-Suzuki-Resume.pdf"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
HEADERS=$(mktemp)
trap 'rm -f "$HEADERS"' EXIT

STATUS=$(curl -s -o "$TMP" -w "%{http_code}" -D "$HEADERS" "$URL")
CONTENT_TYPE=$(grep -i "^Content-Type:" "$HEADERS" 2>/dev/null | head -1 | tr -d '\r' || echo "none")
BODY_B64=$(head -c 200 "$TMP" | base64)
BODY_LEN=$(wc -c < "$TMP" | tr -d ' ')

mkdir -p "$(dirname "$LOG")"
# Escaped content-type for JSON
CT_ESC=$(echo "$CONTENT_TYPE" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '%s\n' "{\"location\":\"debug-pdf-fetch.sh\",\"message\":\"PDF URL fetch\",\"data\":{\"status\":$STATUS,\"contentType\":\"$CT_ESC\",\"bodyLength\":$BODY_LEN,\"bodyStartBase64\":\"$BODY_B64\"},\"timestamp\":$(date +%s)000,\"hypothesisId\":\"A\"}" >> "$LOG"
echo "Logged to $LOG (status=$STATUS, contentType=$CONTENT_TYPE, bodyLen=$BODY_LEN)"
