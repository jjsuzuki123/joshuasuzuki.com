"use strict";

const crypto = require("node:crypto");
const {
  MAX_REQUEST_BYTES,
  SCHEMA_VERSION,
  parseCachedPayload,
  parseCompanyRequest,
  cleanText,
} = require("./core.js");

let injectedDependencies = null;
let defaultDependencies = null;

function allowedOrigins() {
  return new Set(
    String(process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

function response(statusCode, origin, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      Vary: "Origin",
    },
    body: JSON.stringify(body),
  };
}

function eventOrigin(event) {
  return cleanText(
    event?.headers?.origin ||
      event?.headers?.Origin ||
      event?.requestContext?.http?.headers?.origin,
    300
  );
}

function eventMethod(event) {
  return String(
    event?.requestContext?.http?.method || event?.httpMethod || ""
  ).toUpperCase();
}

function eventBody(event) {
  const raw = event?.isBase64Encoded
    ? Buffer.from(String(event.body || ""), "base64").toString("utf8")
    : String(event?.body || "");
  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
    const error = new Error("Request too large.");
    error.code = "REQUEST_TOO_LARGE";
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const error = new Error("Request body must be valid JSON.");
    error.code = "INVALID_REQUEST";
    throw error;
  }
}

async function createDefaultDependencies() {
  if (defaultDependencies) return defaultDependencies;
  const {
    DynamoDBClient,
    GetItemCommand,
    TransactWriteItemsCommand,
  } = require("@aws-sdk/client-dynamodb");
  const { SendMessageCommand, SQSClient } = require("@aws-sdk/client-sqs");
  const dynamo = new DynamoDBClient({});
  const sqs = new SQSClient({});
  defaultDependencies = {
    async getItem({ tableName, key }) {
      const output = await dynamo.send(
        new GetItemCommand({
          TableName: tableName,
          Key: { pk: { S: key } },
          ProjectionExpression:
            "pk, payload, validUntil, updatedAt, researchAfter, leaseUntil, queueToken, lastError, #state",
          ExpressionAttributeNames: { "#state": "state" },
        })
      );
      return output.Item || null;
    },
    // One transaction: consume one unit of the daily enrichment budget and
    // claim the company row so only one enrichment can be in flight.
    async commitClaim({
      tableName,
      cacheKey,
      queueToken,
      budgetKey,
      maximum,
      nowEpoch,
      claimUntil,
      ttl,
      budgetTtl,
    }) {
      try {
        await dynamo.send(
          new TransactWriteItemsCommand({
            ClientRequestToken: crypto.randomUUID(),
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: { S: budgetKey } },
                  UpdateExpression:
                    "SET expiresAt = :ttl, #state = :state ADD enrichments :one",
                  ConditionExpression:
                    "attribute_not_exists(enrichments) OR enrichments <= :remaining",
                  ExpressionAttributeNames: { "#state": "state" },
                  ExpressionAttributeValues: {
                    ":ttl": { N: String(budgetTtl) },
                    ":state": { S: "budget" },
                    ":one": { N: "1" },
                    ":remaining": { N: String(maximum - 1) },
                  },
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: { S: cacheKey } },
                  UpdateExpression:
                    "SET researchAfter = :claim, expiresAt = :ttl, queueToken = :token, #state = :queued REMOVE leaseToken, leaseUntil",
                  ConditionExpression:
                    "(#state = :researching AND leaseUntil <= :now) OR ((attribute_not_exists(researchAfter) OR researchAfter <= :now) AND (attribute_not_exists(#state) OR #state <> :researching))",
                  ExpressionAttributeNames: { "#state": "state" },
                  ExpressionAttributeValues: {
                    ":claim": { N: String(claimUntil) },
                    ":ttl": { N: String(ttl) },
                    ":now": { N: String(nowEpoch) },
                    ":queued": { S: "queued" },
                    ":researching": { S: "researching" },
                    ":token": { S: queueToken },
                  },
                },
              },
            ],
          })
        );
        return { committed: true };
      } catch (error) {
        if (error?.name === "TransactionCanceledException") {
          const reasons = Array.isArray(error.CancellationReasons)
            ? error.CancellationReasons
            : [];
          return {
            committed: false,
            budgetExhausted: reasons[0]?.Code === "ConditionalCheckFailed",
          };
        }
        if (error?.name === "ConditionalCheckFailedException") {
          return { committed: false };
        }
        throw error;
      }
    },
    async enqueue({ queueUrl, message }) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await sqs.send(
            new SendMessageCommand({
              QueueUrl: queueUrl,
              MessageBody: JSON.stringify(message),
              DelaySeconds: 2,
            })
          );
          return true;
        } catch (_error) {
          if (attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, 50 * 2 ** attempt + Math.random() * 25)
            );
          }
        }
      }
      return false;
    },
    async releaseClaim({ tableName, cacheKey, queueToken, budgetKey, nowEpoch }) {
      try {
        await dynamo.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: { S: budgetKey } },
                  UpdateExpression: "ADD enrichments :decrement",
                  ConditionExpression: "enrichments >= :one",
                  ExpressionAttributeValues: {
                    ":decrement": { N: "-1" },
                    ":one": { N: "1" },
                  },
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: { S: cacheKey } },
                  UpdateExpression:
                    "SET researchAfter = :now, #state = :state REMOVE queueToken",
                  ConditionExpression:
                    "queueToken = :token AND #state = :queued",
                  ExpressionAttributeNames: { "#state": "state" },
                  ExpressionAttributeValues: {
                    ":now": { N: String(nowEpoch) },
                    ":state": { S: "enqueue-failed" },
                    ":queued": { S: "queued" },
                    ":token": { S: queueToken },
                  },
                },
              },
            ],
          })
        );
      } catch (error) {
        if (
          ![
            "TransactionCanceledException",
            "ConditionalCheckFailedException",
          ].includes(error?.name)
        ) {
          throw error;
        }
      }
    },
  };
  return defaultDependencies;
}

function itemIsPending(item, nowEpoch) {
  const state = item?.state?.S;
  if (state === "queued") {
    return Number(item?.researchAfter?.N) > nowEpoch;
  }
  if (state === "researching") {
    return Number(item?.leaseUntil?.N) > nowEpoch;
  }
  return false;
}

function dayEnrichBudgetKey(now) {
  return `enrichbudget:${now.toISOString().slice(0, 10)}`;
}

async function handler(event) {
  const origin = eventOrigin(event);
  if (!allowedOrigins().has(origin)) {
    return response(403, "null", {
      error: "Origin is not allowed.",
      code: "ORIGIN_NOT_ALLOWED",
    });
  }
  const method = eventMethod(event);
  if (method === "OPTIONS") return response(204, origin, {});
  if (method !== "POST") {
    return response(405, origin, {
      error: "Only POST is supported.",
      code: "METHOD_NOT_ALLOWED",
    });
  }

  let parsed;
  try {
    parsed = parseCompanyRequest(eventBody(event));
  } catch (error) {
    return response(error.code === "REQUEST_TOO_LARGE" ? 413 : 400, origin, {
      error: error.message,
      code: error.code || "INVALID_REQUEST",
    });
  }
  if (!parsed) {
    return response(400, origin, {
      error: "Enter a valid company domain, like acme.com.",
      code: "INVALID_DOMAIN",
    });
  }

  const tableName = process.env.COMPANY_TABLE_NAME;
  const queueUrl = process.env.ENRICH_QUEUE_URL;
  const maxDailyEnrichments = Math.max(
    0,
    Number(process.env.MAX_DAILY_ENRICHMENTS) || 0
  );
  if (!tableName || !queueUrl || maxDailyEnrichments === 0) {
    return response(503, origin, {
      error: "Company enrichment is not configured.",
      code: "ENRICHMENT_NOT_CONFIGURED",
    });
  }

  try {
    const dependencies =
      injectedDependencies || (await createDefaultDependencies());
    const now =
      typeof dependencies.now === "function" ? dependencies.now() : new Date();
    const nowEpoch = Math.floor(now.getTime() / 1000);
    const item = await dependencies.getItem({
      tableName,
      key: parsed.cacheKey,
    });

    const validUntil = Date.parse(item?.validUntil?.S || "");
    const fresh =
      Number.isFinite(validUntil) && validUntil > now.getTime()
        ? parseCachedPayload(item?.payload?.S)
        : null;
    const alreadyPending = itemIsPending(item, nowEpoch);
    const researchAfter = Number(item?.researchAfter?.N) || 0;

    const wantsEnrichment =
      !alreadyPending &&
      (!fresh || (parsed.refresh && researchAfter <= nowEpoch));

    let queued = false;
    let budgetExhausted = false;
    if (wantsEnrichment) {
      const queueToken = crypto.randomUUID();
      const claim = await dependencies.commitClaim({
        tableName,
        cacheKey: parsed.cacheKey,
        queueToken,
        budgetKey: dayEnrichBudgetKey(now),
        maximum: maxDailyEnrichments,
        nowEpoch,
        claimUntil: nowEpoch + 60 * 60,
        ttl: nowEpoch + 60 * 24 * 60 * 60,
        budgetTtl: nowEpoch + 2 * 24 * 60 * 60,
      });
      budgetExhausted = claim.budgetExhausted === true;
      if (claim.committed) {
        const sent = await dependencies.enqueue({
          queueUrl,
          message: {
            schemaVersion: SCHEMA_VERSION,
            requestedAt: now.toISOString(),
            company: { domain: parsed.domain, cacheKey: parsed.cacheKey },
            queueToken,
          },
        });
        if (sent) {
          queued = true;
        } else {
          await dependencies.releaseClaim({
            tableName,
            cacheKey: parsed.cacheKey,
            queueToken,
            budgetKey: dayEnrichBudgetKey(now),
            nowEpoch,
          });
        }
      }
    }

    const pending = alreadyPending || queued;
    const status = pending
      ? fresh
        ? "refreshing"
        : "queued"
      : fresh
        ? "current"
        : budgetExhausted
          ? "blocked"
          : item?.state?.S === "blocked"
            ? "blocked"
            : "none";
    return response(200, origin, {
      schemaVersion: SCHEMA_VERSION,
      domain: parsed.domain,
      status,
      meta: {
        cached: Boolean(fresh),
        queued,
        pending,
        budgetExhausted,
        state: item?.state?.S || null,
        lastError: item?.lastError?.S || null,
        updatedAt: item?.updatedAt?.S || null,
        nextRefreshAfter: researchAfter > 0
          ? new Date(researchAfter * 1000).toISOString()
          : null,
      },
      snapshot: fresh,
      generatedAt: now.toISOString(),
    });
  } catch (_error) {
    return response(502, origin, {
      error: "Company enrichment is temporarily unavailable.",
      code: "ENRICHMENT_UNAVAILABLE",
    });
  }
}

function setDependenciesForTest(value) {
  injectedDependencies = value;
}

module.exports = {
  handler,
  setDependenciesForTest,
};
