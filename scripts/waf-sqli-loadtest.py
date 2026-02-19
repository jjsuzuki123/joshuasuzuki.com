#!/usr/bin/env python3
"""
WAF load test: sends SQL injection-style payloads to the admin login endpoint.
Use only on your own infrastructure to verify AWS WAF rules (SQL injection, rate limits).
Requires: pip install requests
"""

import argparse
import random
import string
import sys
import time

try:
    import requests
except ImportError:
    print("Install requests: pip install requests", file=sys.stderr)
    sys.exit(1)

# Your API base (from admin.js)
API_BASE = "https://nk1byjfld0.execute-api.us-east-1.amazonaws.com"
LOGIN_URL = f"{API_BASE}/admin/login"

# Common SQL injection payloads (body + query) to trigger WAF rules
SQLI_PAYLOADS = [
    "' OR '1'='1",
    "1' OR '1'='1' --",
    "admin'--",
    "' OR 1=1--",
    "1; DROP TABLE users--",
    "1' UNION SELECT * FROM users--",
    "' OR ''='",
    "1 AND 1=1",
    "1' AND '1'='1",
    "'; WAITFOR DELAY '0:0:5'--",
    "1' ORDER BY 1--",
    "1' UNION SELECT NULL,NULL,NULL--",
    "1 AND (SELECT * FROM (SELECT(SLEEP(5)))a)",
    "1' OR SLEEP(5)--",
    "1\" OR \"1\"=\"1",
    "1' OR '1'='1' /*",
    "1; SELECT pg_sleep(5)--",
    "1' OR 1=1#",
    "1 OR 1=1",
    "1' OR 'x'='x",
]


def cache_bust_params():
    """Unique query params and headers so every request bypasses caches."""
    return {
        "_": str(time.time_ns()),
        "cb": "".join(random.choices(string.ascii_letters + string.digits, k=12)),
    }


def cache_bust_headers():
    """Headers to prevent caching."""
    return {
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    }


def send_sqli_request(session, payload, use_query=False, password=None, cache_bust=True):
    """
    Send one request with a SQLi payload. If password is set, send it in body
    so the app returns 200 (WAF still sees SQLi in query/extra field). Cache-bust
    so each request hits origin.
    """
    cb_params = cache_bust_params() if cache_bust else {}
    h = {
        "Content-Type": "application/json",
        **(cache_bust_headers() if cache_bust else {}),
    }
    if password:
        # Circumvent 401: send valid password, put SQLi where WAF still inspects it
        body = {"password": password}
        if use_query:
            params = {**cb_params, "q": payload}
            r = session.post(LOGIN_URL, json=body, params=params, headers=h, timeout=15)
        else:
            body["_"] = payload  # extra JSON field with SQLi so WAF still sees it
            params = cb_params
            r = session.post(LOGIN_URL, json=body, params=params, headers=h, timeout=15)
    else:
        params = {**cb_params, "q": payload} if use_query else cb_params
        body = {"password": payload} if not use_query else {"password": "x"}
        r = session.post(LOGIN_URL, json=body, params=params, headers=h, timeout=15)
    return r


def run_test(count=1, delay=0, use_query=False, password=None, cache_bust=True, verbose=True):
    """Send multiple SQLi payloads and report status codes."""
    session = requests.Session()
    results = {"ok": 0, "blocked": 0, "other": {}}
    blocked_codes = {403, 429}  # WAF block / rate limit

    for i in range(count):
        payload = SQLI_PAYLOADS[i % len(SQLI_PAYLOADS)]
        try:
            r = send_sqli_request(
                session, payload, use_query=use_query, password=password, cache_bust=cache_bust
            )
            sc = r.status_code
            if sc == 200:
                results["ok"] += 1
            elif sc in blocked_codes:
                results["blocked"] += 1
            else:
                results["other"][sc] = results["other"].get(sc, 0) + 1
            if verbose:
                print(f"  [{i+1}/{count}] {sc}  payload: {payload[:40]!r}...")
        except requests.RequestException as e:
            if verbose:
                print(f"  [{i+1}/{count}] ERROR: {e}")
            results["other"]["error"] = results["other"].get("error", 0) + 1
        if delay and i < count - 1:
            time.sleep(delay)

    return results


def main():
    p = argparse.ArgumentParser(description="WAF SQL injection load test (admin login)")
    p.add_argument("-n", "--count", type=int, default=10, help="Number of requests (default 10)")
    p.add_argument("-d", "--delay", type=float, default=0, help="Delay between requests (seconds)")
    p.add_argument("-q", "--query", action="store_true", help="Put payload in query string instead of body")
    p.add_argument(
        "-p", "--password",
        metavar="PASS",
        help="Admin password: send valid login to avoid 401, SQLi in query/extra field so WAF still triggers",
    )
    p.add_argument(
        "--no-cache-bust",
        action="store_true",
        help="Disable cache-busting (default: unique URL + no-cache headers per request)",
    )
    p.add_argument("-v", "--verbose", action="store_true", default=True, help="Print each response (default on)")
    p.add_argument("--quiet", action="store_true", help="Only print summary")
    args = p.parse_args()
    if args.quiet:
        args.verbose = False

    print(f"Target: {LOGIN_URL}")
    print(f"Requests: {args.count}  Delay: {args.delay}s  Payload in: {'query' if args.query else 'body'}")
    print(f"Circumvent 401: {'yes (password set)' if args.password else 'no'}")
    print(f"Cache bust: {'no' if args.no_cache_bust else 'yes'}")
    print()

    results = run_test(
        count=args.count,
        delay=args.delay,
        use_query=args.query,
        password=args.password,
        cache_bust=not args.no_cache_bust,
        verbose=args.verbose,
    )

    print()
    print("Summary:")
    print(f"  200 (passed through): {results['ok']}")
    print(f"  403/429 (blocked):   {results['blocked']}")
    for k, v in results["other"].items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
