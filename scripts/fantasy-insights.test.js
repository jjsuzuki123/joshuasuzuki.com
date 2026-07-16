"use strict";

const assert = require("node:assert/strict");
const {
  buildSearchRequest,
  buildSnapshot,
  normalizePlayer,
  normalizeResearchResults,
  parseDomains,
  parseResearchRequest,
  safeArticleUrl,
  verifyResearchToken,
} = require("../fantasy-insights/service/core.js");
const insightsApi = require("../fantasy-insights/service/api.js");
const insightsWorker = require("../fantasy-insights/service/worker.js");
const {
  createResearchToken,
} = require("../fantasy-backend/import-league/index.js");

const now = new Date("2026-07-16T02:00:00.000Z");
const allowedDomains = parseDomains(
  "espn.com,sports.yahoo.com,mlb.com,nbcsports.com,foo-.com"
);
assert.equal(allowedDomains.includes("foo-.com"), false);
const clay = normalizePlayer({
  id: "605280",
  externalIds: { espn: "605280" },
  name: "Clay Holmes",
  mlbTeam: "NYM",
  ownerTeamId: "4",
  priority: 88,
  status: "IL",
});
assert.ok(clay);
assert.match(clay.cacheKey, /^player:v2:605280:/);
assert.equal(
  safeArticleUrl(
    "https://www.espn.com/mlb/story/_/id/123/clay-holmes-update#section",
    allowedDomains
  ),
  "https://www.espn.com/mlb/story/_/id/123/clay-holmes-update"
);
assert.equal(
  safeArticleUrl("https://espn.com.evil.example/steal", allowedDomains),
  null
);
assert.equal(
  safeArticleUrl("http://espn.com/insecure", allowedDomains),
  null
);
assert.equal(
  safeArticleUrl("https://user:pass@espn.com/private", allowedDomains),
  null
);

const parsedRequest = parseResearchRequest({
  schemaVersion: 1,
  league: { id: "10", season: 2026, mode: "espn" },
  players: [
    {
      id: "605280",
      externalIds: { espn: "605280" },
      name: "Clay Holmes",
      mlbTeam: "NYM",
      ownerTeamId: "4",
      priority: 88,
    },
    {
      id: "bad",
      externalIds: { espn: "not-numeric" },
      name: "Bad Player",
      mlbTeam: "NYM",
    },
  ],
});
assert.equal(parsedRequest.players.length, 1);
assert.equal(parsedRequest.players[0].name, "Clay Holmes");
assert.equal(
  parseResearchRequest({
    schemaVersion: 1,
    league: {},
    players: [],
  }),
  null
);
assert.equal(
  parseResearchRequest({
    schemaVersion: 1,
    league: { id: "large", season: 2026, mode: "espn" },
    players: Array.from({ length: 301 }, (_value, index) => ({
      id: String(index + 1),
      externalIds: { espn: String(index + 1) },
      name: `Player ${index + 1}`,
      mlbTeam: "FA",
    })),
  }).players.length,
  301
);
assert.equal(
  parseResearchRequest({
    schemaVersion: 1,
    league: { id: "too-large", season: 2026, mode: "espn" },
    players: Array.from({ length: 501 }, (_value, index) => ({
      id: String(index + 1),
      externalIds: { espn: String(index + 1) },
      name: `Player ${index + 1}`,
      mlbTeam: "FA",
    })),
  }),
  null
);

const searchRequest = buildSearchRequest(clay, allowedDomains);
assert.match(searchRequest.query, /Clay Holmes/);
assert.deepEqual(searchRequest.includeDomains, allowedDomains);
assert.equal(searchRequest.tbs, "sbd:1,qdr:w");
assert.equal(searchRequest.scrapeOptions.skipTlsVerification, false);
assert.equal(searchRequest.scrapeOptions.onlyMainContent, true);
assert.deepEqual(searchRequest.scrapeOptions.formats, [{ type: "markdown" }]);
assert.equal(JSON.stringify(searchRequest).includes("fc-"), false);

function result({
  domain,
  title,
  markdown,
  description = "",
  publishedTime = "2026-07-15T18:00:00.000Z",
}) {
  return {
    title,
    description,
    url: `https://${domain}/articles/clay-holmes`,
    markdown,
    metadata: {
      title,
      sourceURL: `https://${domain}/articles/clay-holmes`,
      url: `https://${domain}/articles/clay-holmes`,
      publishedTime,
      statusCode: 200,
    },
  };
}

const corroboratedResponse = {
  success: true,
  data: {
    web: [
      result({
        domain: "www.espn.com",
        title: "Clay Holmes moved to the 60-day IL",
        markdown:
          "The Mets transferred Clay Holmes to the 60-day injured list after his fibula injury.",
      }),
      result({
        domain: "sports.yahoo.com",
        title: "Mets provide Clay Holmes injury update",
        markdown:
          "Clay Holmes remains on the 60-day injured list while building toward a rehab assignment.",
      }),
    ],
  },
};
const corroborated = normalizeResearchResults({
  response: corroboratedResponse,
  player: clay,
  allowedDomains,
  officialDomains: ["mlb.com"],
  now,
});
assert.equal(corroborated.qualitative.length, 2);
assert.equal(
  corroborated.qualitative.every((item) => item.modelEligible),
  false
);
assert.equal(
  corroborated.qualitative.every((item) => item.status === ""),
  true
);
assert.equal(
  corroborated.qualitative.every((item) => item.ilDays === null),
  true
);
assert.equal(
  corroborated.qualitative.every(
    (item) => item.reportType === "injury" && item.corroborated
  ),
  true
);
assert.equal(
  corroborated.qualitative.every((item) => item.evidenceQuote.includes("Clay Holmes")),
  true
);
assert.equal(corroborated.sources.length, 2);
assert.equal(
  corroborated.sources.find((source) => source.id === "web-espn").access,
  "user-provided"
);

const uncorroborated = normalizeResearchResults({
  response: {
    success: true,
    data: {
      web: [
        result({
          domain: "www.espn.com",
          title: "Clay Holmes rumor",
          markdown:
            "Clay Holmes could be placed on the 60-day injured list, according to one speculative report.",
        }),
      ],
    },
  },
  player: clay,
  allowedDomains,
  officialDomains: ["mlb.com"],
  now,
});
assert.equal(uncorroborated.qualitative[0].modelEligible, false);
assert.equal(uncorroborated.qualitative[0].status, "");
assert.equal(uncorroborated.qualitative[0].impact, 0);

const official = normalizeResearchResults({
  response: {
    success: true,
    data: {
      web: [
        result({
          domain: "www.mlb.com",
          title: "Mets activate Clay Holmes",
          markdown:
            "The Mets activated Clay Holmes from the injured list before Thursday's game.",
        }),
      ],
    },
  },
  player: clay,
  allowedDomains,
  officialDomains: ["mlb.com"],
  now,
});
assert.equal(official.qualitative[0].modelEligible, false);
assert.equal(official.qualitative[0].status, "");
assert.equal(official.qualitative[0].reportType, "transaction");
assert.equal(official.sources[0].access, "official");

const adversarialClaims = normalizeResearchResults({
  response: {
    success: true,
    data: {
      web: [
        result({
          domain: "www.mlb.com",
          title: "Clay Holmes was not placed on the IL",
          markdown:
            "Clay Holmes was not placed on the 60-day injured list after testing.",
        }),
        result({
          domain: "www.espn.com",
          title: "Clay Holmes discusses teammate",
          markdown:
            "Clay Holmes said teammate Pete Alonso was placed on the 60-day injured list.",
        }),
        result({
          domain: "www.mlb.com",
          title: "Clay Holmes activated",
          markdown:
            "The Mets activated Clay Holmes from the 60-day injured list on Thursday.",
        }),
      ],
    },
  },
  player: clay,
  allowedDomains,
  officialDomains: ["mlb.com"],
  now,
});
assert.equal(
  adversarialClaims.qualitative.every(
    (item) =>
      item.modelEligible === false && item.status === "" && item.impact === 0
  ),
  true
);

const samePublisher = normalizeResearchResults({
  response: {
    success: true,
    data: {
      web: [
        result({
          domain: "www.espn.com",
          title: "Clay Holmes report one",
          markdown: "Clay Holmes remains on the injured list.",
        }),
        result({
          domain: "africa.espn.com",
          title: "Clay Holmes report two",
          markdown: "Clay Holmes remains on the injured list.",
        }),
      ],
    },
  },
  player: clay,
  allowedDomains,
  officialDomains: [],
  now,
});
assert.equal(
  samePublisher.qualitative.every((item) => item.corroborated === false),
  true
);

const rejectedRedirect = normalizeResearchResults({
  response: {
    success: true,
    data: {
      web: [
        {
          ...result({
            domain: "www.espn.com",
            title: "Clay Holmes update",
            markdown: "Clay Holmes remains on the injured list.",
          }),
          metadata: { url: "https://evil.example/player" },
        },
      ],
    },
  },
  player: clay,
  allowedDomains,
  officialDomains: [],
  now,
});
assert.equal(rejectedRedirect.qualitative.length, 0);

const snapshot = buildSnapshot(
  [
    {
      player: clay,
      payload: corroborated,
    },
  ],
  {
    provider: "firecrawl",
    requested: 1,
    cached: 1,
    queued: 0,
    status: "current",
  },
  now
);
assert.equal(snapshot.schemaVersion, 1);
assert.equal(snapshot.players[0].externalIds.espn, "605280");
assert.equal(snapshot.sources.length, 2);

const largeSnapshot = buildSnapshot(
  Array.from({ length: 500 }, (_value, index) => ({
    player: {
      id: String(index + 1),
      espnId: String(index + 1),
    },
    payload: {
      sources: corroborated.sources,
      qualitative: Array.from({ length: 5 }, () => ({
        sourceId: "web-espn",
        type: "report",
        summary: "S".repeat(240),
        evidenceQuote: "Q".repeat(500),
        sourceUrl: `https://www.espn.com/mlb/story/${index + 1}`,
        asOf: now.toISOString(),
        modelEligible: false,
      })),
    },
  })),
  { requested: 500, cached: 500 },
  now
);
assert.ok(Buffer.byteLength(JSON.stringify(largeSnapshot)) <= 1_550_000);
assert.equal(largeSnapshot.research.truncated, true);

function apiEvent(body, origin = "https://joshuasuzuki.com") {
  return {
    headers: { origin },
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify(body),
  };
}

const requestBody = {
  schemaVersion: 1,
  league: { id: "10", season: 2026, mode: "espn" },
  categories: [],
  players: [
    {
      id: "605280",
      externalIds: { espn: "605280" },
      name: "Clay Holmes",
      mlbTeam: "NYM",
      ownerTeamId: "4",
      priority: 88,
      status: "IL",
    },
  ],
};
const signingSecret = "test-signing-secret-with-enough-entropy";
const researchToken = createResearchToken({
  secret: signingSecret,
  leagueId: "10",
  season: 2026,
  players: [clay.authKey],
  now,
});
const authorizedRequestBody = { ...requestBody, researchToken };
const pete = normalizePlayer({
  id: "32001",
  externalIds: { espn: "32001" },
  name: "Pete Alonso",
  mlbTeam: "NYM",
  ownerTeamId: "4",
  priority: 90,
});
assert.equal(
  verifyResearchToken(
    researchToken,
    parseResearchRequest(authorizedRequestBody),
    signingSecret,
    now
  ),
  true
);
assert.equal(
  verifyResearchToken(
    `${researchToken.split(".")[0]}.${
      researchToken.split(".")[1][0] === "A" ? "B" : "A"
    }${researchToken.split(".")[1].slice(1)}`,
    parseResearchRequest(authorizedRequestBody),
    signingSecret,
    now
  ),
  false
);

async function run() {
  process.env.ALLOWED_ORIGINS =
    "https://joshuasuzuki.com,https://www.joshuasuzuki.com";
  process.env.INSIGHTS_TABLE_NAME = "test-insights";
  process.env.RESEARCH_QUEUE_URL = "https://sqs.test/research";
  process.env.RESEARCH_SIGNING_SECRET_NAME = "test/research-signing";

  let queuedMessages = [];
  insightsApi.setDependenciesForTest({
    now: () => now,
    async batchGet() {
      return [];
    },
    async commitClaims() {
      return true;
    },
    async getSigningSecret() {
      return signingSecret;
    },
    async enqueue({ messages }) {
      queuedMessages = messages;
    },
  });
  const readOnlyResponse = await insightsApi.handler(apiEvent(requestBody));
  assert.equal(readOnlyResponse.statusCode, 200);
  assert.equal(JSON.parse(readOnlyResponse.body).research.status, "read-only");
  assert.equal(queuedMessages.length, 0);

  const queuedResponse = await insightsApi.handler(
    apiEvent(authorizedRequestBody)
  );
  assert.equal(queuedResponse.statusCode, 200);
  const queuedBody = JSON.parse(queuedResponse.body);
  assert.equal(queuedBody.research.status, "queued");
  assert.equal(queuedBody.research.queued, 1);
  assert.equal(queuedMessages[0].player.espnId, "605280");
  assert.equal(JSON.stringify(queuedMessages).includes("fc-"), false);

  const twoPlayerBody = {
    ...requestBody,
    players: [
      ...requestBody.players,
      {
        id: pete.id,
        externalIds: { espn: pete.espnId },
        name: pete.name,
        mlbTeam: pete.mlbTeam,
        ownerTeamId: pete.ownerTeamId,
        priority: pete.priority,
      },
    ],
  };
  twoPlayerBody.researchToken = createResearchToken({
    secret: signingSecret,
    leagueId: "10",
    season: 2026,
    players: [clay.authKey, pete.authKey],
    now,
  });
  const claimedKeys = [];
  insightsApi.setDependenciesForTest({
    now: () => now,
    async batchGet() {
      return [
        {
          pk: { S: clay.cacheKey },
          researchAfter: {
            N: String(Math.floor(now.getTime() / 1000) + 3600),
          },
          state: { S: "queued" },
        },
      ];
    },
    async getSigningSecret() {
      return signingSecret;
    },
    async commitClaims({ claims }) {
      claimedKeys.push(...claims.map(({ player }) => player.cacheKey));
      return true;
    },
    async enqueue() {},
  });
  const progressionResponse = await insightsApi.handler(
    apiEvent(twoPlayerBody)
  );
  assert.equal(progressionResponse.statusCode, 200);
  assert.deepEqual(claimedKeys, [pete.cacheKey]);
  assert.equal(JSON.parse(progressionResponse.body).research.pending, 2);

  let expiredClaimed = false;
  let releasedClaims = [];
  insightsApi.setDependenciesForTest({
    now: () => now,
    async batchGet() {
      return [
        {
          pk: { S: clay.cacheKey },
          researchAfter: {
            N: String(Math.floor(now.getTime() / 1000) - 1),
          },
          state: { S: "queued" },
        },
      ];
    },
    async getSigningSecret() {
      return signingSecret;
    },
    async commitClaims() {
      expiredClaimed = true;
      return true;
    },
    async enqueue({ messages }) {
      return messages;
    },
    async releaseClaims({ claims }) {
      releasedClaims = claims;
    },
  });
  const compensatedResponse = await insightsApi.handler(
    apiEvent(authorizedRequestBody)
  );
  assert.equal(compensatedResponse.statusCode, 200);
  assert.equal(expiredClaimed, true);
  assert.equal(releasedClaims.length, 1);
  assert.equal(
    JSON.parse(compensatedResponse.body).research.pending,
    0
  );

  const forbidden = await insightsApi.handler(
    apiEvent(requestBody, "https://evil.example")
  );
  assert.equal(forbidden.statusCode, 403);

  insightsApi.setDependenciesForTest({
    now: () => now,
    async batchGet() {
      return [
        {
          pk: { S: clay.cacheKey },
          payload: { S: JSON.stringify(corroborated) },
          validUntil: { S: "2026-07-19T02:00:00.000Z" },
          updatedAt: { S: "2026-07-16T02:00:00.000Z" },
          researchAfter: { N: String(Math.floor(now.getTime() / 1000) + 3600) },
          state: { S: "ready" },
        },
      ];
    },
    async getSigningSecret() {
      return signingSecret;
    },
    async commitClaims() {
      throw new Error("Current cached evidence must not be requeued.");
    },
    async enqueue() {},
  });
  const cachedResponse = await insightsApi.handler(
    apiEvent(authorizedRequestBody)
  );
  assert.equal(cachedResponse.statusCode, 200);
  const cachedBody = JSON.parse(cachedResponse.body);
  assert.equal(cachedBody.research.cached, 1);
  assert.equal(cachedBody.players.length, 1);
  assert.equal(cachedBody.players[0].qualitative.length, 2);

  insightsApi.setDependenciesForTest({
    now: () => now,
    async batchGet() {
      return [
        {
          pk: { S: clay.cacheKey },
          payload: { S: JSON.stringify({ sources: [], qualitative: [] }) },
          validUntil: {
            S: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
          },
          updatedAt: { S: now.toISOString() },
          researchAfter: {
            N: String(Math.floor(now.getTime() / 1000) + 6 * 60 * 60),
          },
          state: { S: "ready" },
        },
      ];
    },
    async getSigningSecret() {
      return signingSecret;
    },
    async commitClaims() {
      throw new Error("A current negative-cache record must not be requeued.");
    },
    async enqueue() {
      throw new Error("A current negative-cache record must not be enqueued.");
    },
  });
  const negativeCacheResponse = await insightsApi.handler(
    apiEvent(authorizedRequestBody)
  );
  assert.equal(negativeCacheResponse.statusCode, 200);
  assert.equal(JSON.parse(negativeCacheResponse.body).research.queued, 0);

  process.env.INSIGHTS_TABLE_NAME = "test-insights";
  process.env.FIRECRAWL_SECRET_NAME = "test/firecrawl";
  process.env.FIRECRAWL_ALLOWED_DOMAINS =
    "espn.com,sports.yahoo.com,mlb.com";
  process.env.OFFICIAL_SOURCE_DOMAINS = "mlb.com";
  process.env.MAX_DAILY_FIRECRAWL_CREDITS = "350";

  let savedResearch = null;
  let searchArguments = null;
  insightsWorker.setDependenciesForTest({
    async acquireLease() {
      return true;
    },
    async reserveBudget() {
      return true;
    },
    async getSecret() {
      return JSON.stringify({ apiKey: "fc-test-key" });
    },
    async search(arguments_) {
      searchArguments = arguments_;
      return { ...corroboratedResponse, creditsUsed: 7 };
    },
    async saveResearch(value) {
      savedResearch = value;
    },
    async markFailure() {
      throw new Error("markFailure should not run");
    },
  });
  const workerResponse = await insightsWorker.handler({
    Records: [
      {
        messageId: "one",
        body: JSON.stringify({
          schemaVersion: 1,
          player: clay,
          queueToken: "33333333-3333-4333-8333-333333333333",
        }),
      },
    ],
  });
  assert.deepEqual(workerResponse.batchItemFailures, []);
  assert.equal(searchArguments.apiKey, "fc-test-key");
  assert.deepEqual(
    searchArguments.request.includeDomains,
    parseDomains(process.env.FIRECRAWL_ALLOWED_DOMAINS)
  );
  assert.equal(
    searchArguments.request.scrapeOptions.skipTlsVerification,
    false
  );
  assert.equal(searchArguments.request.scrapeOptions.proxy, "basic");
  assert.deepEqual(searchArguments.request.scrapeOptions.parsers, []);
  assert.equal(savedResearch.payload.qualitative.length, 2);
  assert.equal(
    savedResearch.payload.qualitative.every(
      (item) => item.modelEligible === false
    ),
    true
  );
  assert.equal(savedResearch.creditsUsed, 7);
  assert.match(savedResearch.leaseToken, /^[0-9a-f-]{36}$/);

  let budgetFailure = null;
  insightsWorker.setDependenciesForTest({
    async acquireLease() {
      return true;
    },
    async getSecret() {
      return "fc-test-key";
    },
    async reserveBudget() {
      return false;
    },
    async markFailure(value) {
      budgetFailure = value;
    },
    async search() {
      throw new Error("search must not run after budget denial");
    },
  });
  const budgetResult = await insightsWorker.researchPlayer(
    clay,
    {
      async acquireLease() {
        return true;
      },
      async getSecret() {
        return "fc-test-key";
      },
      async reserveBudget() {
        return false;
      },
      async markFailure(value) {
        budgetFailure = value;
      },
    },
    now
  );
  assert.equal(budgetResult.skipped, "budget");
  assert.equal(budgetFailure.code, "DAILY_BUDGET_REACHED");
  assert.equal(budgetFailure.state, "blocked");

  let transientFailure = null;
  await assert.rejects(
    () =>
      insightsWorker.researchPlayer(
        clay,
        {
          async acquireLease() {
            return true;
          },
          async getSecret() {
            return "fc-test-key";
          },
          async reserveBudget() {
            return true;
          },
          async search() {
            const error = new Error("temporary");
            error.statusCode = 500;
            throw error;
          },
          async markFailure(value) {
            transientFailure = value;
          },
        },
        now
      ),
    /temporary/
  );
  assert.equal(transientFailure.state, "queued");
  assert.equal(
    transientFailure.researchAfter,
    Math.floor(now.getTime() / 1000) + 15 * 60
  );
  assert.match(transientFailure.leaseToken, /^[0-9a-f-]{36}$/);

  assert.equal(insightsWorker.secretApiKey('{"apiKey":"fc-valid"}'), "fc-valid");
  assert.equal(insightsWorker.secretApiKey('{"apiKey":"wrong"}'), null);

  console.log("Fantasy Firecrawl insights tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
