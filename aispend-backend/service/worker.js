"use strict";

const crypto = require("node:crypto");
const {
  buildCompanyPayload,
  buildHeadcountSearchRequest,
  buildWebSearchRequest,
  normalizeHeadcountResults,
  normalizeWebResults,
  parseQueueMessage,
} = require("./core.js");
const { lookupCompanyScale } = require("./directory.js");
const { collectGithubSignals } = require("./github.js");

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
// Search-only request, no scrapes: one credit per returned result.
const ESTIMATED_CREDITS_PER_ENRICHMENT = 8;
const MAX_FIRECRAWL_RESPONSE_BYTES = 5_000_000;
const READY_TTL_SECONDS = 60 * 24 * 60 * 60;
const RICH_VALID_SECONDS = 14 * 24 * 60 * 60;
const EMPTY_VALID_SECONDS = 24 * 60 * 60;
const RICH_RESEARCH_INTERVAL_SECONDS = 24 * 60 * 60;
const EMPTY_RESEARCH_INTERVAL_SECONDS = 6 * 60 * 60;

let injectedDependencies = null;
let defaultDependencies = null;
const cachedSecrets = new Map();

function secretGithubToken(secretValue) {
  const value = String(secretValue || "").trim();
  if (!value) return null;
  let token = value;
  try {
    const parsed = JSON.parse(value);
    token = String(parsed?.token || parsed?.apiKey || "").trim();
  } catch (_error) {
    // Raw token string.
  }
  return token.length >= 20 && !/\s/.test(token) ? token : null;
}

function secretFirecrawlKey(secretValue) {
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
  const timeout = setTimeout(() => controller.abort(), 30_000);
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
      const error = new Error(
        `Firecrawl request failed with ${response.status}.`
      );
      error.statusCode = response.status;
      throw error;
    }
    const parsed = JSON.parse(text);
    if (!parsed?.success) {
      throw new Error("Firecrawl returned an invalid response.");
    }
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
      const cached = cachedSecrets.get(secretName);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      const output = await secrets.send(
        new GetSecretValueCommand({ SecretId: secretName })
      );
      const value = output.SecretString || "";
      cachedSecrets.set(secretName, {
        value,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      return value;
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
            ":code": { S: String(code || "ENRICHMENT_FAILED").slice(0, 80) },
            ":state": { S: state },
            ":zero": { N: "0" },
            ":token": { S: leaseToken },
          },
        })
      );
    },
    searchWeb: firecrawlSearch,
    collectGithub: (options) =>
      collectGithubSignals({ ...options, fetchImpl: fetch }),
  };
  return defaultDependencies;
}

function dayBudgetKey(now) {
  return `budget:${now.toISOString().slice(0, 10)}`;
}

async function optionalSecret(dependencies, secretName, parser) {
  if (!secretName) return null;
  try {
    return parser(await dependencies.getSecret(secretName));
  } catch (_error) {
    return null;
  }
}

async function enrichCompany(
  company,
  dependencies,
  now = new Date(),
  queueToken = crypto.randomUUID()
) {
  const tableName = process.env.COMPANY_TABLE_NAME;
  if (!tableName) throw new Error("Company enrichment is not configured.");

  const nowEpoch = Math.floor(now.getTime() / 1000);
  const leaseToken = crypto.randomUUID();
  const acquired = await dependencies.acquireLease({
    tableName,
    cacheKey: company.cacheKey,
    nowEpoch,
    leaseUntil: nowEpoch + 8 * 60,
    leaseToken,
    queueToken,
    ttl: nowEpoch + READY_TTL_SECONDS,
  });
  if (!acquired) return { skipped: "lease" };

  try {
    const githubToken = await optionalSecret(
      dependencies,
      process.env.GITHUB_SECRET_NAME,
      secretGithubToken
    );
    const github = await dependencies.collectGithub({
      domain: company.domain,
      companyName: company.name,
      token: githubToken,
      now,
    });

    let webReadings = [];
    let webResearch = "disabled";
    let creditsUsed = 0;
    const webEnabled =
      String(process.env.WEB_RESEARCH_ENABLED || "true") === "true";
    const maximumDailyCredits = Math.max(
      0,
      Number(process.env.MAX_DAILY_FIRECRAWL_CREDITS) || 0
    );
    if (webEnabled && maximumDailyCredits > 0) {
      const firecrawlKey = await optionalSecret(
        dependencies,
        process.env.FIRECRAWL_SECRET_NAME,
        secretFirecrawlKey
      );
      if (!firecrawlKey) {
        webResearch = "missing-key";
      } else {
        const budgetReserved = await dependencies.reserveBudget({
          tableName,
          budgetKey: dayBudgetKey(now),
          cost: ESTIMATED_CREDITS_PER_ENRICHMENT,
          maximum: maximumDailyCredits,
          ttl: nowEpoch + 2 * 24 * 60 * 60,
        });
        if (!budgetReserved) {
          webResearch = "budget";
        } else {
          try {
            const companyName =
              company.name || github.orgs?.[0]?.name || null;
            const toolResponse = await dependencies.searchWeb({
              apiKey: firecrawlKey,
              request: buildWebSearchRequest({
                domain: company.domain,
                companyName,
              }),
            });
            webReadings.push(...normalizeWebResults({ response: toolResponse, now }));
            let sizeResponse = null;
            try {
              sizeResponse = await dependencies.searchWeb({
                apiKey: firecrawlKey,
                request: buildHeadcountSearchRequest({
                  domain: company.domain,
                  companyName,
                }),
              });
              webReadings.push(
                ...normalizeHeadcountResults({ response: sizeResponse, now })
              );
            } catch (_error) {
              // Headcount search is additive; tool mentions still count.
            }
            creditsUsed =
              Number(toolResponse.creditsUsed || toolResponse.data?.creditsUsed || 0) +
                Number(sizeResponse?.creditsUsed || sizeResponse?.data?.creditsUsed || 0) ||
              ESTIMATED_CREDITS_PER_ENRICHMENT;
            webResearch = "ok";
          } catch (_error) {
            creditsUsed = ESTIMATED_CREDITS_PER_ENRICHMENT;
            webResearch = "error";
          }
        }
      }
    }

    const payload = buildCompanyPayload({
      domain: company.domain,
      companyName: company.name || github.orgs?.[0]?.name,
      github,
      webReadings,
      coverage: {
        ...github.coverage,
        webResearch,
        notes: github.notes,
      },
      now,
      scale: lookupCompanyScale(company.domain),
    });
    const hasSignal =
      payload.coverage.githubOrgResolved ||
      payload.readings.some((reading) => reading.value > 0);
    const validForSeconds = hasSignal ? RICH_VALID_SECONDS : EMPTY_VALID_SECONDS;
    await dependencies.saveResearch({
      tableName,
      cacheKey: company.cacheKey,
      payload,
      updatedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + validForSeconds * 1000).toISOString(),
      researchAfter:
        nowEpoch +
        (hasSignal
          ? RICH_RESEARCH_INTERVAL_SECONDS
          : EMPTY_RESEARCH_INTERVAL_SECONDS),
      ttl: nowEpoch + READY_TTL_SECONDS,
      creditsUsed,
      leaseToken,
    });
    return {
      enriched: true,
      readings: payload.readings.length,
      orgs: payload.company.githubOrgs.length,
    };
  } catch (error) {
    const permanent = [400, 401, 402, 403].includes(error?.statusCode);
    await dependencies.markFailure({
      tableName,
      cacheKey: company.cacheKey,
      researchAfter: permanent ? nowEpoch + 60 * 60 : nowEpoch + 15 * 60,
      ttl: nowEpoch + READY_TTL_SECONDS,
      code:
        error.code ||
        (Number.isFinite(error.statusCode)
          ? `ENRICHMENT_${error.statusCode}`
          : "ENRICHMENT_FAILED"),
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
    const message = parseQueueMessage(record);
    if (!message) continue;
    try {
      await enrichCompany(
        message.company,
        dependencies,
        new Date(),
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
  cachedSecrets.clear();
}

module.exports = {
  ESTIMATED_CREDITS_PER_ENRICHMENT,
  enrichCompany,
  handler,
  secretFirecrawlKey,
  secretGithubToken,
  setDependenciesForTest,
};
