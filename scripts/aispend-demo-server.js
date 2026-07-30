"use strict";

// Local same-origin demo: static /aispend assets + mocked lookup/suggest APIs.
// Usage: node scripts/aispend-demo-server.js [port]

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { suggestCompanies, resolveCompanyQuery } = require(
  "../aispend-backend/service/directory.js"
);

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.argv[2]) || 8787;
const ACCESS_CODE = String(process.env.AISPEND_DEMO_CODE || "demo-access").trim();
const pending = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function send(response, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body)
    ? body
    : JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(payload);
}

function demoSnapshot(domain, companyName) {
  const org = domain.split(".")[0];
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    domain,
    company: {
      domain,
      name: companyName || org[0].toUpperCase() + org.slice(1),
      githubOrgs: [
        {
          login: org,
          name: companyName || org,
          url: `https://github.com/${org}`,
          publicRepos: 86,
          publicMembers: 28,
          followers: 4100,
          createdAt: "2015-01-01T00:00:00Z",
        },
      ],
    },
    coverage: {
      githubOrgResolved: true,
      githubAuthenticated: true,
      codeSearch: true,
      commitSearch: true,
      prSearch: true,
      webResearch: "ok",
      notes: [],
    },
    readings: [
      {
        id: `github.${org}.claudeMdFiles`,
        vendor: "claude-code",
        metric: "CLAUDE.md files in public repos",
        value: 14,
        unit: "count",
        source: "github",
        url: `https://github.com/search?q=org%3A${org}+filename%3ACLAUDE.md&type=code`,
        detail: "GitHub code search",
        observedAt: now,
      },
      {
        id: `github.${org}.claudeCoauthoredCommits`,
        vendor: "claude-code",
        metric: "Commits co-authored by Claude",
        value: 260,
        unit: "count",
        source: "github",
        url: `https://github.com/search?q=org%3A${org}+Co-authored-by%3A+Claude&type=commits`,
        detail: "GitHub commit search",
        observedAt: now,
      },
      {
        id: `github.${org}.cursorRulesDir`,
        vendor: "cursor",
        metric: ".cursor/rules directories",
        value: 7,
        unit: "count",
        source: "github",
        url: `https://github.com/search?q=org%3A${org}+path%3A.cursor%2Frules&type=code`,
        detail: "GitHub code search",
        observedAt: now,
      },
      {
        id: `github.${org}.devinPrs`,
        vendor: "devin",
        metric: "Pull requests by Devin",
        value: 40,
        unit: "count",
        source: "github",
        url: `https://github.com/${org}`,
        detail: "GitHub pull search",
        observedAt: now,
      },
      {
        id: "web.jobs.claude-code.0",
        vendor: "claude-code",
        metric: "Hiring / careers mention",
        value: 1,
        unit: "mention",
        source: "web",
        url: `https://${domain}/careers`,
        detail: `${companyName || org} is hiring engineers experienced with Claude Code`,
        observedAt: now,
      },
      {
        id: "web.headcount.engineers",
        vendor: "company",
        metric: "Reported engineers (web)",
        value: 90,
        unit: "engineers",
        source: "web",
        url: `https://${domain}/about`,
        detail: "About 90 software engineers on the product org",
        observedAt: now,
      },
    ],
    collectedAt: now,
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function demoConfigSource() {
  return `(function configureSpendscope(root) {
  "use strict";

  root.SpendscopeConfig = Object.freeze({
    apiEndpoint: ${JSON.stringify(`/v1/aispend/company`)},
    suggestEndpoint: ${JSON.stringify(`/v1/aispend/suggest`)},
    gated: true,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
`;
}

async function handleApi(request, response, url) {
  if (request.method === "OPTIONS") {
    return send(response, 204, "", {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Spendscope-Key",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
    });
  }
  if (request.method !== "POST") {
    return send(response, 405, { error: "Only POST is supported.", code: "METHOD_NOT_ALLOWED" });
  }
  const code = String(request.headers["x-spendscope-key"] || "");
  if (code !== ACCESS_CODE) {
    return send(response, 401, {
      error: "A valid access code is required.",
      code: "ACCESS_REQUIRED",
      gate: true,
    });
  }
  const body = await readBody(request);
  if (url.pathname.endsWith("/suggest")) {
    return send(response, 200, {
      schemaVersion: 1,
      query: body.query,
      suggestions: suggestCompanies(body.query || "", 8),
    });
  }
  const resolved = resolveCompanyQuery(body.query || body.domain || body.company || "");
  if (!resolved) {
    return send(response, 400, {
      error: "Enter a company name or domain.",
      code: "INVALID_QUERY",
    });
  }
  if (!resolved.domain) {
    return send(response, 200, {
      schemaVersion: 1,
      status: "unresolved",
      query: resolved.query,
      suggestions: resolved.suggestions || [],
      snapshot: null,
      meta: { cached: false, queued: false, pending: false },
    });
  }
  const key = resolved.domain;
  const started = pending.get(key);
  if (!started) {
    pending.set(key, Date.now());
    return send(response, 200, {
      schemaVersion: 1,
      status: "queued",
      query: resolved.query,
      domain: resolved.domain,
      companyName: resolved.companyName,
      source: resolved.source,
      suggestions: resolved.suggestions || [],
      meta: { cached: false, queued: true, pending: true },
      snapshot: null,
    });
  }
  if (Date.now() - started < 3500) {
    return send(response, 200, {
      schemaVersion: 1,
      status: "queued",
      query: resolved.query,
      domain: resolved.domain,
      companyName: resolved.companyName,
      meta: { cached: false, queued: false, pending: true },
      snapshot: null,
    });
  }
  return send(response, 200, {
    schemaVersion: 1,
    status: "current",
    query: resolved.query,
    domain: resolved.domain,
    companyName: resolved.companyName,
    source: resolved.source,
    meta: { cached: true, queued: false, pending: false },
    snapshot: demoSnapshot(resolved.domain, resolved.companyName),
  });
}

function serveStatic(url, response) {
  let relative = decodeURIComponent(url.pathname);
  if (relative === "/" || relative === "/aispend" || relative === "/aispend/") {
    relative = "/aispend/index.html";
  }
  if (relative === "/aispend/config.js") {
    return send(response, 200, demoConfigSource(), {
      "Content-Type": MIME[".js"],
    });
  }
  const filePath = path.normalize(path.join(ROOT, relative.replace(/^\/+/, "")));
  if (!filePath.startsWith(ROOT)) {
    return send(response, 403, "Forbidden", { "Content-Type": "text/plain" });
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return send(response, 404, "Not found", { "Content-Type": "text/plain" });
  }
  const ext = path.extname(filePath);
  send(response, 200, fs.readFileSync(filePath), {
    "Content-Type": MIME[ext] || "application/octet-stream",
  });
}
http
  .createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
      if (url.pathname.startsWith("/v1/aispend/")) {
        await handleApi(request, response, url);
        return;
      }
      serveStatic(url, response);
    } catch (_error) {
      send(response, 500, { error: "Demo server error." });
    }
  })
  .listen(PORT, "127.0.0.1", () => {
    process.stdout.write(
      `Spendscope demo on http://127.0.0.1:${PORT}/aispend/ (code: ${ACCESS_CODE})\n`
    );
  });
