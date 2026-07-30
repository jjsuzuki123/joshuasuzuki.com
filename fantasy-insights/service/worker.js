"use strict";

const crypto = require("node:crypto");
const {
  buildSearchRequest,
  normalizePlayer,
  normalizeResearchResults,
  parseDomains,
} = require("./core.js");

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const ESTIMATED_CREDITS_PER_PLAYER = 7;
const MAX_FIRECRAWL_RESPONSE_BYTES = 5_000_000;
const RESEARCH_INTERVAL_SECONDS = 6 * 60 * 60;
const READY_TTL_SECONDS = 7 * 24 * 60 * 60;

let injectedDependencies = null;
let defaultDependencies = null;
let cachedSecret = null;

function parseMessage(record) {
  let body;
  try {
    body = JSON.parse(String(record?.body || ""));
  } catch (_error) {
    return null;
  }
  const raw = body?.player;
  const player = normalizePlayer({
    id: raw?.id,
    externalIds: { espn: raw?.espnId },
    name: raw?.name,
    mlbTeam: raw?.mlbTeam,
    ownerTeamId: raw?.ownerTeamId,
    activeRoster: raw?.activeRoster,
    priority: raw?.priority,
    status: raw?.status,
  });
  if (
    Number(body?.schemaVersion) !== 1 ||
    !player ||
    raw?.cacheKey !== player.cacheKey ||
    !/^[0-9a-f-]{36}$/.test(String(body?.queueToken || ""))
  ) {
    return null;
  }
  return {
    player,
    queueToken: String(body.queueToken),
  };
}

function secretApiKey(secretValue) {
  const value = String(secretValue || "").trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    const apiKey = String(parsed?.apiKey || "").trim();
    return apiKey.startsWith("fc-") ? apiKey : null;
  } catch (_error) {
    return value.startsWith("fc-") ? value : null;
  }
}

async function readTextWithLimit(response, maximumBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumBytes) {
      throw new Error("Firecrawl response exceeded the size limit.");
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel("Response too large");
      throw new Error("Firecrawl response exceeded the size limit.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function firecrawlSearch({ apiKey, request }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await fetch(FIRECRAWL_SEARCH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      redirect: "error",
      signal: controller.signal,
    });
    const contentLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_FIRECRAWL_RESPONSE_BYTES
    ) {
      throw new Error("Firecrawl response exceeded the size limit.");
    }
    const text = await readTextWithLimit(
      response,
      MAX_FIRECRAWL_RESPONSE_BYTES
    );
    if (!response.ok) {
      const error = new Error(`Firecrawl request failed with ${response.status}.`);
      error.statusCode = response.status;
      throw error;
    }
    const parsed = JSON.parse(text);
    if (!parsed?.success) throw new Error("Firecrawl returned an invalid response.");
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function createDefaultDependencies() {
  if (defaultDependencies) return defaultDependencies;
  const {
    DynamoDBClient,
    UpdateItemCommand,
  } = require("@aws-sdk/client-dynamodb");
  const {
    GetSecretValueCommand,
    SecretsManagerClient,
  } = require("@aws-sdk/client-secrets-manager");
  const dynamo = new DynamoDBClient({});
  const secrets = new SecretsManagerClient({});
  defaultDependencies = {
    async acquireLease({
      tableName,
      cacheKey,
      nowEpoch,
      leaseUntil,
      leaseToken,
      queueToken,
      ttl,
    }) {
      try {
        await dynamo.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { pk: { S: cacheKey } },
            UpdateExpression:
              "SET leaseUntil = :lease, leaseToken = :token, #state = :researching, expiresAt = :ttl",
            ConditionExpression:
              "queueToken = :queue AND (#state = :queued OR (#state = :researching AND leaseUntil < :now))",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: {
              ":lease": { N: String(leaseUntil) },
              ":token": { S: leaseToken },
              ":queue": { S: queueToken },
              ":now": { N: String(nowEpoch) },
              ":queued": { S: "queued" },
              ":researching": { S: "researching" },
              ":ttl": { N: String(ttl) },
            },
          })
        );
        return true;
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    },
    async reserveBudget({ tableName, budgetKey, cost, maximum, ttl }) {
      const remaining = maximum - cost;
      if (remaining < 0) return false;
      try {
        await dynamo.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { pk: { S: budgetKey } },
            UpdateExpression:
              "SET expiresAt = :ttl, #state = :state ADD creditsUsed :cost",
            ConditionExpression:
              "attribute_not_exists(creditsUsed) OR creditsUsed <= :remaining",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: {
              ":cost": { N: String(cost) },
              ":remaining": { N: String(remaining) },
              ":ttl": { N: String(ttl) },
              ":state": { S: "budget" },
            },
          })
        );
        return true;
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    },
    async getSecret(secretName) {
      if (cachedSecret && cachedSecret.expiresAt > Date.now()) {
        return cachedSecret.value;
      }
      const output = await secrets.send(
        new GetSecretValueCommand({ SecretId: secretName })
      );
      cachedSecret = {
        value: output.SecretString || "",
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
      return cachedSecret.value;
    },
    clearSecretCache() {
      cachedSecret = null;
    },
    async saveResearch({
      tableName,
      cacheKey,
      payload,
      updatedAt,
      validUntil,
      researchAfter,
      ttl,
      creditsUsed,
      leaseToken,
    }) {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: tableName,
          Key: { pk: { S: cacheKey } },
          UpdateExpression:
            "SET payload = :payload, updatedAt = :updated, validUntil = :valid, researchAfter = :next, expiresAt = :ttl, creditsUsed = :credits, #state = :state REMOVE lastError, leaseUntil, leaseToken, queueToken",
          ConditionExpression: "leaseToken = :token",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":payload": { S: JSON.stringify(payload) },
            ":updated": { S: updatedAt },
            ":valid": { S: validUntil },
            ":next": { N: String(researchAfter) },
            ":ttl": { N: String(ttl) },
            ":credits": { N: String(creditsUsed) },
            ":state": { S: "ready" },
            ":token": { S: leaseToken },
          },
        })
      );
    },
    async markFailure({
      tableName,
      cacheKey,
      researchAfter,
      ttl,
      code,
      leaseToken,
      state,
    }) {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: tableName,
          Key: { pk: { S: cacheKey } },
          UpdateExpression:
            "SET researchAfter = :next, expiresAt = :ttl, lastError = :code, #state = :state, leaseUntil = :zero REMOVE leaseToken",
          ConditionExpression: "leaseToken = :token",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":next": { N: String(researchAfter) },
            ":ttl": { N: String(ttl) },
            ":code": { S: String(code || "RESEARCH_FAILED").slice(0, 80) },
            ":state": { S: state },
            ":zero": { N: "0" },
            ":token": { S: leaseToken },
          },
        })
      );
    },
    search: firecrawlSearch,
  };
  return defaultDependencies;
}

function dayBudgetKey(now) {
  return `budget:${now.toISOString().slice(0, 10)}`;
}

async function researchPlayer(
  player,
  dependencies,
  now = new Date(),
  queueToken = crypto.randomUUID()
) {
  const tableName = process.env.INSIGHTS_TABLE_NAME;
  const secretName = process.env.FIRECRAWL_SECRET_NAME;
  const allowedDomains = parseDomains(process.env.FIRECRAWL_ALLOWED_DOMAINS);
  const officialDomains = parseDomains(process.env.OFFICIAL_SOURCE_DOMAINS);
  const maximumDailyCredits = Math.max(
    0,
    Number(process.env.MAX_DAILY_FIRECRAWL_CREDITS) || 0
  );
  if (
    !tableName ||
    !secretName ||
    allowedDomains.length === 0 ||
    maximumDailyCredits === 0
  ) {
    throw new Error("Firecrawl research is not configured.");
  }

  const nowEpoch = Math.floor(now.getTime() / 1000);
  const leaseToken = crypto.randomUUID();
  const acquired = await dependencies.acquireLease({
    tableName,
    cacheKey: player.cacheKey,
    nowEpoch,
    leaseUntil: nowEpoch + 5 * 60,
    leaseToken,
    queueToken,
    ttl: nowEpoch + READY_TTL_SECONDS,
  });
  if (!acquired) return { skipped: "lease" };

  let apiKey;
  try {
    apiKey = secretApiKey(await dependencies.getSecret(secretName));
  } catch (error) {
    await dependencies.markFailure({
      tableName,
      cacheKey: player.cacheKey,
      ttl: nowEpoch + READY_TTL_SECONDS,
      code: "FIRECRAWL_SECRET_UNAVAILABLE",
      leaseToken,
      state: "queued",
      researchAfter: nowEpoch + 15 * 60,
    });
    throw error;
  }
  if (!apiKey) {
    await dependencies.markFailure({
      tableName,
      cacheKey: player.cacheKey,
      researchAfter: nowEpoch + 15 * 60,
      ttl: nowEpoch + READY_TTL_SECONDS,
      code: "FIRECRAWL_KEY_MISSING",
      leaseToken,
      state: "blocked",
    });
    return { skipped: "configuration" };
  }

  const budgetReserved = await dependencies.reserveBudget({
    tableName,
    budgetKey: dayBudgetKey(now),
    cost: ESTIMATED_CREDITS_PER_PLAYER,
    maximum: maximumDailyCredits,
    ttl: nowEpoch + 2 * 24 * 60 * 60,
  });
  if (!budgetReserved) {
    await dependencies.markFailure({
      tableName,
      cacheKey: player.cacheKey,
      researchAfter: nowEpoch + 60 * 60,
      ttl: nowEpoch + READY_TTL_SECONDS,
      code: "DAILY_BUDGET_REACHED",
      leaseToken,
      state: "blocked",
    });
    return { skipped: "budget" };
  }

  try {
    const request = buildSearchRequest(player, allowedDomains);
    let response;
    try {
      response = await dependencies.search({ apiKey, request });
    } catch (error) {
      if (
        [401, 403].includes(error?.statusCode) &&
        typeof dependencies.clearSecretCache === "function"
      ) {
        dependencies.clearSecretCache();
        const refreshedKey = secretApiKey(
          await dependencies.getSecret(secretName)
        );
        if (refreshedKey) {
          apiKey = refreshedKey;
          response = await dependencies.search({ apiKey, request });
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    const creditsUsed =
      Number(response.creditsUsed || response.data?.creditsUsed) ||
      ESTIMATED_CREDITS_PER_PLAYER;
    if (creditsUsed > ESTIMATED_CREDITS_PER_PLAYER) {
      const error = new Error("Firecrawl exceeded the reserved credit amount.");
      error.code = "FIRECRAWL_CREDIT_OVERRUN";
      error.statusCode = 402;
      throw error;
    }
    const normalized = normalizeResearchResults({
      response,
      player,
      allowedDomains,
      officialDomains,
      now,
    });
    const hasEvidence = normalized.qualitative.length > 0;
    const validForSeconds = hasEvidence ? 3 * 24 * 60 * 60 : 6 * 60 * 60;
    await dependencies.saveResearch({
      tableName,
      cacheKey: player.cacheKey,
      payload: normalized,
      updatedAt: now.toISOString(),
      validUntil: new Date(
        now.getTime() + validForSeconds * 1000
      ).toISOString(),
      researchAfter: nowEpoch + RESEARCH_INTERVAL_SECONDS,
      ttl: nowEpoch + READY_TTL_SECONDS,
      creditsUsed,
      leaseToken,
    });
    return {
      researched: true,
      articles: normalized.qualitative.length,
    };
  } catch (error) {
    const permanent = [400, 401, 402, 403].includes(error?.statusCode);
    await dependencies.markFailure({
      tableName,
      cacheKey: player.cacheKey,
      researchAfter: permanent ? nowEpoch + 60 * 60 : nowEpoch + 15 * 60,
      ttl: nowEpoch + READY_TTL_SECONDS,
      code:
        error.code ||
        (Number.isFinite(error.statusCode)
          ? `FIRECRAWL_${error.statusCode}`
          : "RESEARCH_FAILED"),
      leaseToken,
      state: permanent ? "blocked" : "queued",
    });
    if (permanent) return { skipped: "permanent-failure" };
    throw error;
  }
}

async function handler(event) {
  const dependencies =
    injectedDependencies || (await createDefaultDependencies());
  const failures = [];
  for (const record of Array.isArray(event?.Records) ? event.Records : []) {
    const message = parseMessage(record);
    if (!message) continue;
    try {
      const now =
        typeof dependencies.now === "function" ? dependencies.now() : new Date();
      await researchPlayer(
        message.player,
        dependencies,
        now,
        message.queueToken
      );
    } catch (_error) {
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}

function setDependenciesForTest(value) {
  injectedDependencies = value;
}

module.exports = {
  handler,
  researchPlayer,
  secretApiKey,
  setDependenciesForTest,
};
