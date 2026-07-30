"use strict";

const assert = require("node:assert/strict");
const {
  buildCompanyPayload,
  buildHeadcountSearchRequest,
  buildWebSearchRequest,
  classifyVendorMentions,
  companyCacheKey,
  extractHeadcountFromText,
  normalizeCompanyDomain,
  normalizeHeadcountResults,
  normalizeWebResults,
  parseCachedPayload,
  parseCompanyRequest,
  parseLookupRequest,
  parseQueueMessage,
  parseSuggestRequest,
  sanitizeCitationUrl,
} = require("../aispend-backend/service/core.js");
const {
  resolveCompanyQuery,
  suggestCompanies,
} = require("../aispend-backend/service/directory.js");
const { collectGithubSignals } = require("../aispend-backend/service/github.js");
const aispendApi = require("../aispend-backend/service/api.js");
const aispendWorker = require("../aispend-backend/service/worker.js");

const NOW = new Date("2026-07-21T00:00:00.000Z");
const QUEUE_TOKEN = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

/* ---------- core: domain normalization ---------- */

assert.equal(normalizeCompanyDomain("acme.com"), "acme.com");
assert.equal(normalizeCompanyDomain("  WWW.Acme.COM "), "acme.com");
assert.equal(normalizeCompanyDomain("https://www.stripe.com/jobs?x=1#a"), "stripe.com");
assert.equal(normalizeCompanyDomain("app.foo.co.uk"), "foo.co.uk");
assert.equal(normalizeCompanyDomain("deep.sub.acme.io"), "acme.io");
assert.equal(normalizeCompanyDomain("acme.com."), "acme.com");
assert.equal(normalizeCompanyDomain("xn--fsq.com"), "xn--fsq.com");
assert.equal(normalizeCompanyDomain("localhost"), null);
assert.equal(normalizeCompanyDomain("192.168.1.1"), null);
assert.equal(normalizeCompanyDomain("-bad-.com"), null);
assert.equal(normalizeCompanyDomain("user@acme.com"), null);
assert.equal(normalizeCompanyDomain("acme.com:8080"), null);
assert.equal(normalizeCompanyDomain(""), null);
assert.equal(normalizeCompanyDomain("a".repeat(300) + ".com"), null);

assert.deepEqual(parseCompanyRequest({ schemaVersion: 1, domain: "Acme.com" }), {
  domain: "acme.com",
  companyName: null,
  cacheKey: "company:v1:acme.com",
  refresh: false,
});
assert.equal(parseCompanyRequest({ schemaVersion: 2, domain: "acme.com" }), null);
assert.equal(parseCompanyRequest({ schemaVersion: 1, domain: "nope" }), null);
assert.equal(
  parseCompanyRequest({ schemaVersion: 1, domain: "acme.com", refresh: true }).refresh,
  true
);

/* ---------- core: citation URLs ---------- */

assert.equal(
  sanitizeCitationUrl("https://example.com/post?id=1#section"),
  "https://example.com/post?id=1"
);
assert.equal(sanitizeCitationUrl("http://example.com/insecure"), null);
assert.equal(sanitizeCitationUrl("https://user:pass@example.com/x"), null);
assert.equal(sanitizeCitationUrl("https://example.com:8443/x"), null);
assert.equal(sanitizeCitationUrl("not a url"), null);

/* ---------- core: vendor mention classification ---------- */

assert.deepEqual(
  classifyVendorMentions("Acme adopts Claude Code for all engineers"),
  ["claude-code"]
);
assert.deepEqual(
  classifyVendorMentions("Why we chose Cursor as our AI code editor"),
  ["cursor"]
);
assert.deepEqual(classifyVendorMentions("Moving the cursor position in vim"), []);
assert.deepEqual(classifyVendorMentions("GitHub Copilot Enterprise rollout"), [
  "github-copilot",
]);
assert.deepEqual(classifyVendorMentions("Cognition's Devin joins the team"), [
  "devin",
]);
assert.deepEqual(classifyVendorMentions("Deploying OpenAI Codex agents"), [
  "openai",
]);
assert.deepEqual(classifyVendorMentions("Anthropic partnership announced"), [
  "claude-code",
]);
assert.deepEqual(classifyVendorMentions("nothing relevant here"), []);

/* ---------- core: web search request + result normalization ---------- */

const webRequest = buildWebSearchRequest({ domain: "acme.com", companyName: "Acme" });
assert.match(webRequest.query, /"acme\.com" OR "Acme"/);
assert.match(webRequest.query, /Claude Code/);
assert.equal(webRequest.limit, 5);
assert.equal(webRequest.tbs, "qdr:y");
assert.equal(webRequest.scrapeOptions, undefined);
const webRequestNoName = buildWebSearchRequest({ domain: "acme.com", companyName: "" });
assert.equal(webRequestNoName.query.startsWith('("acme.com") '), true);
const webRequestSameName = buildWebSearchRequest({
  domain: "acme.com",
  companyName: "acme.com",
});
assert.equal(webRequestSameName.query.includes('"acme.com" OR'), false);

const webReadings = normalizeWebResults({
  response: {
    success: true,
    data: {
      web: [
        {
          url: "https://news.example/acme-claude",
          title: "Acme adopts Claude Code",
          description: "Rolling out to 500 engineers",
        },
        { url: "http://insecure.example/x", title: "Claude Code post" },
        {
          url: "https://blog.example/cursor",
          title: "Why we chose Cursor as our AI code editor",
          description: "",
        },
        { url: "https://plain.example/vim", title: "Moving the cursor in vim" },
        {
          url: "https://news.example/acme-claude",
          title: "Acme adopts Claude Code",
          description: "duplicate URL",
        },
      ],
    },
  },
  now: NOW,
});
assert.equal(webReadings.length, 2);
assert.equal(webReadings[0].vendor, "claude-code");
assert.equal(webReadings[0].source, "web");
assert.equal(webReadings[1].vendor, "cursor");

const jobReadings = normalizeWebResults({
  response: {
    success: true,
    data: {
      web: [
        {
          url: "https://jobs.example/acme-cursor",
          title: "Acme is hiring Staff Engineers",
          description: "Experience with Cursor as our AI code editor required",
        },
      ],
    },
  },
  now: NOW,
});
assert.equal(jobReadings[0].id.startsWith("web.jobs."), true);

assert.deepEqual(extractHeadcountFromText("Join our 120 software engineers"), {
  value: 120,
  kind: "engineers",
});
assert.deepEqual(extractHeadcountFromText("2,400 employees worldwide"), {
  value: 2400,
  kind: "employees",
});
assert.equal(extractHeadcountFromText("no numbers here"), null);
const headcountReadings = normalizeHeadcountResults({
  response: {
    success: true,
    data: {
      web: [
        {
          url: "https://acme.com/about",
          title: "About Acme",
          description: "We are 80 engineers building payments infrastructure",
        },
      ],
    },
  },
  now: NOW,
});
assert.equal(headcountReadings[0].id, "web.headcount.engineers");
assert.equal(headcountReadings[0].vendor, "company");
assert.equal(headcountReadings[0].value, 80);

const headcountRequest = buildHeadcountSearchRequest({
  domain: "acme.com",
  companyName: "Acme",
});
assert.match(headcountRequest.query, /"Acme"/);
assert.match(headcountRequest.query, /engineers/);

assert.equal(resolveCompanyQuery("Stripe").domain, "stripe.com");
assert.equal(resolveCompanyQuery("stripe.com").source, "domain");
assert.equal(resolveCompanyQuery("DefinitelyNotARealCoXYZ").source, "unresolved");
assert.ok(suggestCompanies("stri").some((entry) => entry.domain === "stripe.com"));
assert.deepEqual(parseLookupRequest({ schemaVersion: 1, query: "Vercel" }).domain, "vercel.com");
assert.equal(parseLookupRequest({ schemaVersion: 1, query: "nope-unknown-zz" }).unresolved, true);
assert.ok(parseSuggestRequest({ query: "notion" }).suggestions.length > 0);
assert.equal(parseSuggestRequest({ query: "" }), null);

/* ---------- core: queue message parsing ---------- */

const validMessage = {
  schemaVersion: 1,
  company: { domain: "acme.com", cacheKey: companyCacheKey("acme.com") },
  queueToken: QUEUE_TOKEN,
};
assert.deepEqual(parseQueueMessage({ body: JSON.stringify(validMessage) }), {
  company: { domain: "acme.com", cacheKey: "company:v1:acme.com", name: "" },
  queueToken: QUEUE_TOKEN,
});
assert.equal(
  parseQueueMessage({
    body: JSON.stringify({ ...validMessage, queueToken: "nope" }),
  }),
  null
);
assert.equal(
  parseQueueMessage({
    body: JSON.stringify({
      ...validMessage,
      company: { domain: "acme.com", cacheKey: "company:v1:other.com" },
    }),
  }),
  null
);
assert.equal(parseQueueMessage({ body: "not json" }), null);

/* ---------- core: payload build + parse roundtrip ---------- */

const githubFixture = {
  orgs: [
    {
      login: "acme",
      name: "Acme Inc",
      url: "https://github.com/acme",
      publicRepos: 120,
      publicMembers: 40,
      followers: 800,
      createdAt: "2015-01-01T00:00:00Z",
    },
  ],
  readings: [
    {
      id: "github.acme.claudeMdFiles",
      vendor: "claude-code",
      metric: "CLAUDE.md files in public repos",
      value: 18,
      unit: "count",
      source: "github",
      url: "https://github.com/search?q=org%3Aacme+filename%3ACLAUDE.md&type=code",
      detail: "GitHub search",
      observedAt: NOW.toISOString(),
    },
    {
      id: "bad.vendor",
      vendor: "unknown-vendor",
      metric: "dropped",
      value: 3,
      source: "github",
    },
  ],
  coverage: {
    githubOrgResolved: true,
    githubAuthenticated: true,
    codeSearch: true,
    commitSearch: true,
    prSearch: true,
  },
  notes: ["note one"],
};
const payload = buildCompanyPayload({
  domain: "acme.com",
  github: githubFixture,
  webReadings,
  coverage: { ...githubFixture.coverage, webResearch: "ok", notes: githubFixture.notes },
  now: NOW,
});
assert.equal(payload.schemaVersion, 1);
assert.equal(payload.company.name, "Acme Inc");
assert.equal(payload.company.githubOrgs.length, 1);
assert.equal(payload.readings.length, 3); // invalid vendor reading dropped
assert.equal(payload.coverage.webResearch, "ok");
assert.deepEqual(parseCachedPayload(JSON.stringify(payload)), payload);
assert.equal(parseCachedPayload("{}"), null);
assert.equal(parseCachedPayload("not json"), null);

// The shared score engine must consume exactly what the service stores.
const { scoreCompany } = require("../aispend/score-engine.js");
const crossCheck = scoreCompany(payload, { now: NOW });
assert.equal(crossCheck.domain, "acme.com");
assert.equal(crossCheck.headcount.estimate, 120);
assert.ok(
  crossCheck.vendors.find((vendor) => vendor.id === "claude-code").adoptionScore > 0
);
assert.ok(crossCheck.totalMonthly.mid > 0);
assert.equal(crossCheck.confidence, 0.9);

/* ---------- github collector ---------- */

function jsonResponse(status, body, headers = {}) {
  const map = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => map.get(String(name).toLowerCase()) ?? null },
    text: async () => JSON.stringify(body),
  };
}

function githubStub({ rateLimitSearch = false } = {}) {
  const seen = { urls: [], authHeaders: [] };
  async function fetchImpl(url, options) {
    seen.urls.push(url);
    seen.authHeaders.push(options?.headers?.Authorization || null);
    const parsed = new URL(url);
    const path = parsed.pathname;
    const query = parsed.searchParams.get("q") || "";
    if (path === "/search/users") {
      if (rateLimitSearch) return jsonResponse(403, { message: "rate limited" });
      return jsonResponse(200, {
        items: [{ login: "acme" }, { login: "acme-labs" }, { login: "unrelated" }],
      });
    }
    if (path === "/orgs/acme") {
      return jsonResponse(200, {
        login: "acme",
        type: "Organization",
        name: "Acme Inc",
        blog: "https://acme.com",
        email: null,
        is_verified: true,
        public_repos: 120,
        followers: 800,
        created_at: "2015-01-01T00:00:00Z",
      });
    }
    if (path === "/orgs/acme-labs") {
      return jsonResponse(200, {
        login: "acme-labs",
        type: "Organization",
        name: "Acme Labs",
        blog: "https://acmelabs.example",
        email: null,
        public_repos: 10,
        followers: 5,
        created_at: "2019-01-01T00:00:00Z",
      });
    }
    if (path === "/orgs/unrelated") {
      return jsonResponse(200, {
        login: "unrelated",
        type: "Organization",
        blog: "https://elsewhere.example",
        public_repos: 3,
        followers: 1,
        created_at: "2020-01-01T00:00:00Z",
      });
    }
    if (path === "/orgs/acme/public_members") {
      return jsonResponse(200, [{ login: "dev1" }], {
        link: '<https://api.github.com/organizations/1/public_members?per_page=1&page=40>; rel="last"',
      });
    }
    if (path === "/search/code") {
      if (query.includes("filename:CLAUDE.md")) {
        return jsonResponse(200, { total_count: 18 });
      }
      if (query.includes("path:.cursor/rules")) {
        return jsonResponse(200, { total_count: 9 });
      }
      return jsonResponse(200, { total_count: 0 });
    }
    if (path === "/search/commits") {
      if (query.includes("co-authored-by: claude")) {
        return jsonResponse(200, { total_count: 420 });
      }
      return jsonResponse(200, { total_count: 0 });
    }
    if (path === "/search/issues") {
      if (query.includes("author:app/devin-ai-integration")) {
        return jsonResponse(200, { total_count: 130 });
      }
      if (query.includes("author:app/chatgpt-codex-connector")) {
        return jsonResponse(422, { message: "unknown app" });
      }
      return jsonResponse(200, { total_count: 0 });
    }
    return jsonResponse(404, { message: "not found" });
  }
  return { fetchImpl, seen };
}

async function testGithubCollector() {
  const authenticated = githubStub();
  const result = await collectGithubSignals({
    domain: "acme.com",
    token: "ghp_abcdefghij1234567890",
    fetchImpl: authenticated.fetchImpl,
    now: NOW,
  });
  assert.equal(result.orgs.length, 1);
  assert.equal(result.orgs[0].login, "acme");
  assert.equal(result.orgs[0].publicMembers, 40);
  assert.equal(result.coverage.githubOrgResolved, true);
  assert.equal(result.coverage.codeSearch, true);
  assert.equal(result.coverage.commitSearch, true);
  assert.equal(result.coverage.prSearch, true);
  const byId = new Map(result.readings.map((entry) => [entry.id, entry]));
  assert.equal(byId.get("github.acme.claudeMdFiles").value, 18);
  assert.equal(byId.get("github.acme.cursorRulesDir").value, 9);
  assert.equal(byId.get("github.acme.claudeCoauthoredCommits").value, 420);
  assert.equal(byId.get("github.acme.devinPrs").value, 130);
  assert.equal(byId.get("github.acme.codexConnectorPrs").value, 0); // 422 counts as zero
  assert.ok(
    authenticated.seen.authHeaders.every(
      (header) => header === "Bearer ghp_abcdefghij1234567890"
    )
  );
  assert.ok(result.calls <= 40);

  const anonymous = githubStub();
  const anonymousResult = await collectGithubSignals({
    domain: "acme.com",
    token: null,
    fetchImpl: anonymous.fetchImpl,
    now: NOW,
  });
  assert.equal(anonymousResult.coverage.githubAuthenticated, false);
  assert.equal(anonymousResult.coverage.codeSearch, false);
  assert.equal(anonymousResult.coverage.commitSearch, false);
  assert.equal(anonymousResult.coverage.prSearch, true);
  assert.equal(
    anonymousResult.readings.some((entry) => entry.id.endsWith("claudeMdFiles")),
    false
  );
  assert.ok(
    anonymousResult.notes.some((note) => note.includes("no GitHub token"))
  );
  assert.ok(
    anonymous.seen.urls.every((url) => !url.includes("/search/code"))
  );

  const limited = githubStub({ rateLimitSearch: true });
  const limitedResult = await collectGithubSignals({
    domain: "acme.com",
    token: "ghp_abcdefghij1234567890",
    fetchImpl: limited.fetchImpl,
    now: NOW,
  });
  assert.equal(limitedResult.orgs.length, 0);
  assert.equal(limitedResult.coverage.githubOrgResolved, false);
  assert.ok(limitedResult.notes.some((note) => note.includes("rate limit")));
}

/* ---------- worker ---------- */

function workerDeps(overrides = {}) {
  const calls = {
    saveResearch: [],
    markFailure: [],
    reserveBudget: [],
    searchWeb: [],
    acquireLease: [],
  };
  return {
    calls,
    acquireLease: async (args) => {
      calls.acquireLease.push(args);
      return true;
    },
    reserveBudget: async (args) => {
      calls.reserveBudget.push(args);
      return true;
    },
    getSecret: async (name) =>
      name.includes("github")
        ? JSON.stringify({ token: "ghp_abcdefghij1234567890" })
        : "fc-test-key",
    saveResearch: async (args) => {
      calls.saveResearch.push(args);
    },
    markFailure: async (args) => {
      calls.markFailure.push(args);
    },
    searchWeb: async (args) => {
      calls.searchWeb.push(args);
      return {
        success: true,
        data: {
          web: [
            {
              url: "https://news.example/acme-claude",
              title: "Acme adopts Claude Code",
              description: "Rollout announcement",
            },
          ],
        },
      };
    },
    collectGithub: async () => ({
      orgs: githubFixture.orgs,
      readings: [githubFixture.readings[0]],
      coverage: githubFixture.coverage,
      notes: [],
      calls: 12,
    }),
    ...overrides,
  };
}

const company = { domain: "acme.com", cacheKey: companyCacheKey("acme.com") };

async function testWorker() {
  process.env.COMPANY_TABLE_NAME = "aispend-test";
  process.env.GITHUB_SECRET_NAME = "aispend/github/test";
  process.env.FIRECRAWL_SECRET_NAME = "aispend/firecrawl/test";
  process.env.WEB_RESEARCH_ENABLED = "true";
  process.env.MAX_DAILY_FIRECRAWL_CREDITS = "100";

  const happy = workerDeps();
  const happyResult = await aispendWorker.enrichCompany(
    company,
    happy,
    NOW,
    QUEUE_TOKEN
  );
  assert.equal(happyResult.enriched, true);
  assert.equal(happy.calls.saveResearch.length, 1);
  const saved = happy.calls.saveResearch[0];
  assert.equal(saved.cacheKey, "company:v1:acme.com");
  assert.equal(saved.creditsUsed, 8);
  assert.equal(happy.calls.searchWeb.length, 2);
  assert.equal(
    saved.validUntil,
    new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
  );
  assert.equal(saved.payload.coverage.webResearch, "ok");
  assert.ok(
    saved.payload.readings.some((entry) => entry.source === "web"),
    "web readings should be stored"
  );
  assert.ok(
    saved.payload.readings.some(
      (entry) => entry.id === "github.acme.claudeMdFiles"
    )
  );
  assert.equal(happy.calls.reserveBudget[0].cost, 8);

  const budgetDenied = workerDeps({
    reserveBudget: async () => false,
  });
  await aispendWorker.enrichCompany(company, budgetDenied, NOW, QUEUE_TOKEN);
  assert.equal(budgetDenied.calls.searchWeb.length, 0);
  assert.equal(
    budgetDenied.calls.saveResearch[0].payload.coverage.webResearch,
    "budget"
  );
  assert.equal(budgetDenied.calls.saveResearch[0].creditsUsed, 0);

  const noFirecrawl = workerDeps({
    getSecret: async (name) => {
      if (name.includes("github")) {
        return JSON.stringify({ token: "ghp_abcdefghij1234567890" });
      }
      throw new Error("secret missing");
    },
  });
  await aispendWorker.enrichCompany(company, noFirecrawl, NOW, QUEUE_TOKEN);
  assert.equal(
    noFirecrawl.calls.saveResearch[0].payload.coverage.webResearch,
    "missing-key"
  );

  process.env.WEB_RESEARCH_ENABLED = "false";
  const webDisabled = workerDeps();
  await aispendWorker.enrichCompany(company, webDisabled, NOW, QUEUE_TOKEN);
  assert.equal(webDisabled.calls.searchWeb.length, 0);
  assert.equal(
    webDisabled.calls.saveResearch[0].payload.coverage.webResearch,
    "disabled"
  );
  process.env.WEB_RESEARCH_ENABLED = "true";

  const leaseLost = workerDeps({ acquireLease: async () => false });
  const leaseResult = await aispendWorker.enrichCompany(
    company,
    leaseLost,
    NOW,
    QUEUE_TOKEN
  );
  assert.deepEqual(leaseResult, { skipped: "lease" });
  assert.equal(leaseLost.calls.saveResearch.length, 0);

  const githubBroken = workerDeps({
    collectGithub: async () => {
      throw new Error("network down");
    },
  });
  await assert.rejects(() =>
    aispendWorker.enrichCompany(company, githubBroken, NOW, QUEUE_TOKEN)
  );
  assert.equal(githubBroken.calls.markFailure.length, 1);
  assert.equal(githubBroken.calls.markFailure[0].state, "queued");

  // Full handler path with an SQS record and injected dependencies.
  const viaHandler = workerDeps();
  aispendWorker.setDependenciesForTest(viaHandler);
  const batch = await aispendWorker.handler({
    Records: [
      { messageId: "m1", body: JSON.stringify(validMessage) },
      { messageId: "m2", body: "garbage" },
    ],
  });
  assert.deepEqual(batch, { batchItemFailures: [] });
  assert.equal(viaHandler.calls.saveResearch.length, 1);
  aispendWorker.setDependenciesForTest(null);

  assert.equal(
    aispendWorker.secretGithubToken(JSON.stringify({ token: "ghp_abcdefghij1234567890" })),
    "ghp_abcdefghij1234567890"
  );
  assert.equal(aispendWorker.secretGithubToken("short"), null);
  assert.equal(aispendWorker.secretGithubToken(""), null);
  assert.equal(aispendWorker.secretFirecrawlKey("fc-abc"), "fc-abc");
  assert.equal(aispendWorker.secretFirecrawlKey("nope"), null);
}

/* ---------- api ---------- */

function apiEvent(
  body,
  origin = "https://joshuasuzuki.com",
  method = "POST",
  path = "/v1/aispend/company",
  extraHeaders = {}
) {
  return {
    headers: { origin, ...extraHeaders },
    rawPath: path,
    requestContext: { http: { method, path } },
    body: typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function apiDeps(overrides = {}) {
  const calls = { getItem: [], commitClaim: [], enqueue: [], releaseClaim: [] };
  return {
    calls,
    now: () => NOW,
    getItem: async (args) => {
      calls.getItem.push(args);
      return null;
    },
    commitClaim: async (args) => {
      calls.commitClaim.push(args);
      return { committed: true };
    },
    enqueue: async (args) => {
      calls.enqueue.push(args);
      return true;
    },
    releaseClaim: async (args) => {
      calls.releaseClaim.push(args);
    },
    ...overrides,
  };
}

function freshItem({ researchAfterEpoch, state = "ready" }) {
  return {
    pk: { S: companyCacheKey("acme.com") },
    payload: { S: JSON.stringify(payload) },
    validUntil: { S: "2026-08-01T00:00:00.000Z" },
    updatedAt: { S: "2026-07-20T00:00:00.000Z" },
    researchAfter: { N: String(researchAfterEpoch) },
    state: { S: state },
  };
}

async function testApi() {
  process.env.ALLOWED_ORIGINS =
    "https://joshuasuzuki.com,https://www.joshuasuzuki.com,https://scope.joshuasuzuki.com";
  process.env.COMPANY_TABLE_NAME = "aispend-test";
  process.env.ENRICH_QUEUE_URL = "https://sqs.test/queue";
  process.env.MAX_DAILY_ENRICHMENTS = "50";
  delete process.env.ACCESS_CODE;

  const nowEpoch = Math.floor(NOW.getTime() / 1000);

  const badOrigin = await aispendApi.handler(
    apiEvent({ schemaVersion: 1, domain: "acme.com" }, "https://evil.example")
  );
  assert.equal(badOrigin.statusCode, 403);

  const hiddenOrigin = await aispendApi.handler(
    apiEvent(
      { schemaVersion: 1, query: "DefinitelyNotARealCoXYZ" },
      "https://scope.joshuasuzuki.com"
    )
  );
  assert.equal(hiddenOrigin.statusCode, 200);
  assert.equal(JSON.parse(hiddenOrigin.body).status, "unresolved");

  const options = await aispendApi.handler(
    apiEvent({}, "https://joshuasuzuki.com", "OPTIONS")
  );
  assert.equal(options.statusCode, 204);

  const wrongMethod = await aispendApi.handler(
    apiEvent({}, "https://joshuasuzuki.com", "GET")
  );
  assert.equal(wrongMethod.statusCode, 405);

  const invalidQuery = await aispendApi.handler(
    apiEvent({ schemaVersion: 1, query: "" })
  );
  assert.equal(invalidQuery.statusCode, 400);
  assert.equal(JSON.parse(invalidQuery.body).code, "INVALID_QUERY");

  const unresolved = await aispendApi.handler(
    apiEvent({ schemaVersion: 1, query: "DefinitelyNotARealCoXYZ" })
  );
  assert.equal(unresolved.statusCode, 200);
  assert.equal(JSON.parse(unresolved.body).status, "unresolved");

  process.env.ACCESS_CODE = "secret-gate";
  const gated = await aispendApi.handler(
    apiEvent({ schemaVersion: 1, query: "Stripe" })
  );
  assert.equal(gated.statusCode, 401);
  assert.equal(JSON.parse(gated.body).code, "ACCESS_REQUIRED");
  const gateDeps = apiDeps();
  aispendApi.setDependenciesForTest(gateDeps);
  const unlocked = await aispendApi.handler(
    apiEvent(
      { schemaVersion: 1, query: "Stripe" },
      "https://joshuasuzuki.com",
      "POST",
      "/v1/aispend/company",
      { "x-spendscope-key": "secret-gate" }
    )
  );
  assert.equal(unlocked.statusCode, 200);
  assert.equal(JSON.parse(unlocked.body).domain, "stripe.com");
  assert.equal(gateDeps.calls.enqueue[0].message.company.name, "Stripe");
  aispendApi.setDependenciesForTest(null);
  const suggest = await aispendApi.handler(
    apiEvent(
      { query: "stri" },
      "https://joshuasuzuki.com",
      "POST",
      "/v1/aispend/suggest",
      { "x-spendscope-key": "secret-gate" }
    )
  );
  assert.equal(suggest.statusCode, 200);
  assert.ok(JSON.parse(suggest.body).suggestions.length > 0);
  delete process.env.ACCESS_CODE;

  const tooLarge = await aispendApi.handler(
    apiEvent(JSON.stringify({ domain: "x".repeat(20000) }))
  );
  assert.equal(tooLarge.statusCode, 413);

  // Cache hit: fresh payload, future researchAfter, no enrichment queued.
  const cacheHit = apiDeps({
    getItem: async () => freshItem({ researchAfterEpoch: nowEpoch + 3600 }),
  });
  aispendApi.setDependenciesForTest(cacheHit);
  const current = await aispendApi.handler(
    apiEvent({ schemaVersion: 1, domain: "acme.com" })
  );
  assert.equal(current.statusCode, 200);
  const currentBody = JSON.parse(current.body);
  assert.equal(currentBody.status, "current");
  assert.equal(currentBody.meta.cached, true);
  assert.equal(currentBody.snapshot.domain, "acme.com");
  assert.equal(cacheHit.calls.commitClaim.length, 0);

  // Refresh request ignored while researchAfter is still in the future.
  aispendApi.setDependenciesForTest(cacheHit);
  const refreshDenied = await aispendApi.handler(
    apiEvent({ schemaVersion: 1, domain: "acme.com", refresh: true })
  );
  assert.equal(JSON.parse(refreshDenied.body).status, "current");
  assert.equal(cacheHit.calls.commitClaim.length, 0);

  // Unknown domain: claim + enqueue, response is queued with no snapshot.
  const firstScan = apiDeps();
  aispendApi.setDependenciesForTest(firstScan);
  const queued = await aispendApi.handler(
    apiEvent({ schemaVersion: 1, domain: "acme.com" })
  );
  const queuedBody = JSON.parse(queued.body);
  assert.equal(queuedBody.status, "queued");
  assert.equal(queuedBody.meta.queued, true);
  assert.equal(queuedBody.snapshot, null);
  assert.equal(firstScan.calls.commitClaim.length, 1);
  assert.equal(firstScan.calls.commitClaim[0].maximum, 50);
  assert.equal(firstScan.calls.enqueue.length, 1);
  const message = firstScan.calls.enqueue[0].message;
  assert.equal(message.schemaVersion, 1);
  assert.equal(message.company.cacheKey, "company:v1:acme.com");
  assert.match(message.queueToken, /^[0-9a-f-]{36}$/);

  // Stale payload + refresh: queues and reports refreshing with snapshot.
  const staleRefresh = apiDeps({
    getItem: async () => freshItem({ researchAfterEpoch: nowEpoch - 60 }),
  });
  aispendApi.setDependenciesForTest(staleRefresh);
  const refreshing = await aispendApi.handler(
    apiEvent({ schemaVersion: 1, domain: "acme.com", refresh: true })
  );
  const refreshingBody = JSON.parse(refreshing.body);
  assert.equal(refreshingBody.status, "refreshing");
  assert.equal(refreshingBody.snapshot.domain, "acme.com");
  assert.equal(staleRefresh.calls.commitClaim.length, 1);

  // Already pending: no duplicate claim.
  const pendingDeps = apiDeps({
    getItem: async () => ({
      pk: { S: companyCacheKey("acme.com") },
      state: { S: "queued" },
      researchAfter: { N: String(nowEpoch + 1800) },
    }),
  });
  aispendApi.setDependenciesForTest(pendingDeps);
  const pending = await aispendApi.handler(
    apiEvent({ schemaVersion: 1, domain: "acme.com" })
  );
  const pendingBody = JSON.parse(pending.body);
  assert.equal(pendingBody.status, "queued");
  assert.equal(pendingBody.meta.pending, true);
  assert.equal(pendingDeps.calls.commitClaim.length, 0);

  // Daily budget exhausted.
  const budgetDeps = apiDeps({
    commitClaim: async () => ({ committed: false, budgetExhausted: true }),
  });
  aispendApi.setDependenciesForTest(budgetDeps);
  const blocked = await aispendApi.handler(
    apiEvent({ schemaVersion: 1, domain: "acme.com" })
  );
  const blockedBody = JSON.parse(blocked.body);
  assert.equal(blockedBody.status, "blocked");
  assert.equal(blockedBody.meta.budgetExhausted, true);
  assert.equal(budgetDeps.calls.enqueue.length, 0);

  // Enqueue failure releases the claim.
  const enqueueFail = apiDeps({ enqueue: async () => false });
  aispendApi.setDependenciesForTest(enqueueFail);
  const failed = await aispendApi.handler(
    apiEvent({ schemaVersion: 1, domain: "acme.com" })
  );
  const failedBody = JSON.parse(failed.body);
  assert.equal(failedBody.status, "none");
  assert.equal(enqueueFail.calls.releaseClaim.length, 1);

  aispendApi.setDependenciesForTest(null);
}

/* ---------- run ---------- */

(async () => {
  await testGithubCollector();
  await testWorker();
  await testApi();
  console.log("aispend-service tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
