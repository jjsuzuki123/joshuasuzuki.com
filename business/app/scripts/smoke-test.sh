#!/usr/bin/env bash
# End-to-end smoke test against a running local server.
# Usage: BASE=http://127.0.0.1:3400 bash scripts/smoke-test.sh
# Requires: curl, python3. Starts a tiny fixture site on :3499 to scan.
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3400}"
JAR="$(mktemp)"
FIXTURE_PORT=3499
EMAIL="smoke-$(date +%s)@example.com"
PASS="smoke-test-password-1"

cleanup() {
  [[ -n "${FIXTURE_PID:-}" ]] && kill "$FIXTURE_PID" 2>/dev/null || true
  rm -f "$JAR" /tmp/siteramp-fixture.py
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$1"; }

step "start fixture site on :$FIXTURE_PORT"
cat > /tmp/siteramp-fixture.py <<'PY'
import http.server, sys
BAD = b"""<!doctype html><html><head><meta charset="utf-8"></head>
<body><img src="/x.png"><input type="text">
<div style="color:#9a9a9a;background:#fff;font-size:12px">low contrast text</div>
<a href="/two">two</a></body></html>"""
GOOD = b"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fine</title></head>
<body><main><h1>Fine page</h1><p><a href="/">home</a></p></main></body></html>"""
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = BAD if self.path == "/" else (GOOD if self.path == "/two" else b"nope")
        code = 200 if self.path in ("/", "/two") else 404
        self.send_response(code); self.send_header("content-type", "text/html"); self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
python3 /tmp/siteramp-fixture.py "$FIXTURE_PORT" &
FIXTURE_PID=$!
sleep 1

step "health check"
curl -sf "$BASE/healthz" | grep -q '"ok":true'

step "get CSRF cookie"
curl -sf -c "$JAR" -o /dev/null "$BASE/signup"
CSRF=$(awk '$6=="siteramp_csrf" {print $7}' "$JAR")
[[ -n "$CSRF" ]]

step "signup $EMAIL"
curl -sf -b "$JAR" -c "$JAR" -o /dev/null -w "%{http_code}" \
  --data-urlencode "email=$EMAIL" --data-urlencode "password=$PASS" --data-urlencode "_csrf=$CSRF" \
  "$BASE/signup" | grep -q 302

step "add fixture site"
curl -sf -b "$JAR" -c "$JAR" -o /dev/null \
  --data-urlencode "url=http://127.0.0.1:$FIXTURE_PORT/" --data-urlencode "name=Smoke Fixture" --data-urlencode "_csrf=$CSRF" \
  "$BASE/sites"

step "trigger scan"
SITE_PATH=$(curl -sf -b "$JAR" "$BASE/dashboard" | grep -o '/sites/[0-9]*' | head -1)
curl -sf -b "$JAR" -o /dev/null --data-urlencode "_csrf=$CSRF" "$BASE$SITE_PATH/scan"

step "wait for scan to finish (max 120s)"
SCAN_PATH=$(curl -sf -b "$JAR" "$BASE$SITE_PATH" | grep -o '/scans/[0-9]*' | head -1)
for i in $(seq 1 60); do
  STATUS=$(curl -sf -b "$JAR" "$BASE$SCAN_PATH/status" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
  [[ "$STATUS" == "done" || "$STATUS" == "failed" ]] && break
  sleep 2
done
echo "final status: $STATUS"
[[ "$STATUS" == "done" ]]

step "report page shows findings"
REPORT=$(curl -sf -b "$JAR" "$BASE$SCAN_PATH")
echo "$REPORT" | grep -qi "accessibility report"
echo "$REPORT" | grep -qi "missing text alternatives"

step "download PDF"
curl -sf -b "$JAR" -o /tmp/siteramp-smoke.pdf "$BASE$SCAN_PATH/pdf"
head -c5 /tmp/siteramp-smoke.pdf | grep -q "%PDF-"
echo "PDF bytes: $(wc -c < /tmp/siteramp-smoke.pdf)"

step "create + verify share link"
LOCATION=$(curl -sf -b "$JAR" -o /dev/null -w '%{redirect_url}' --data-urlencode "_csrf=$CSRF" "$BASE$SCAN_PATH/share")
TOKEN="${LOCATION##*share=}"
curl -sf "$BASE/r/$TOKEN" | grep -q "Website Accessibility Report"

echo
echo "SMOKE TEST PASSED ✔"
