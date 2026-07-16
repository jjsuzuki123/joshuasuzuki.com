"use strict";

const crypto = require("node:crypto");
const {
  buildSnapshot,
  cleanText,
  parseResearchRequest,
  researchTokenClaims,
} = require("./core.js");

const MAX_REQUEST_BYTES = 500_000;
const MAX_QUEUE_PER_REQUEST = 25;

let injectedDependencies = null;
let defaultDependencies = null;
let cachedSigningSecret = null;

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
    BatchGetItemCommand,
    DynamoDBClient,
    TransactWriteItemsCommand,
  } = require("@aws-sdk/client-dynamodb");
  const {
    GetSecretValueCommand,
    SecretsManagerClient,
  } = require("@aws-sdk/client-secrets-manager");
  const { SendMessageBatchCommand, SQSClient } = require("@aws-sdk/client-sqs");
  const dynamo = new DynamoDBClient({});
  const secrets = new SecretsManagerClient({});
  const sqs = new SQSClient({});
  defaultDependencies = {
    async batchGet({ tableName, keys }) {
      if (keys.length === 0) return [];
      let pending = keys.map((key) => ({ pk: { S: key } }));
      const items = [];
      for (let attempt = 0; attempt < 3 && pending.length > 0; attempt += 1) {
        const output = await dynamo.send(
          new BatchGetItemCommand({
            RequestItems: {
              [tableName]: {
                Keys: pending,
                ProjectionExpression:
                  "pk, payload, validUntil, updatedAt, researchAfter, leaseUntil, queueToken, #state",
                ExpressionAttributeNames: { "#state": "state" },
              },
            },
          })
        );
        items.push(...(output.Responses?.[tableName] || []));
        pending = output.UnprocessedKeys?.[tableName]?.Keys || [];
        if (pending.length > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, 25 * 2 ** attempt + Math.random() * 25)
          );
        }
      }
      if (pending.length > 0) {
        throw new Error("Unable to read all cached research records.");
      }
      return items;
    },
    async commitClaims({
      tableName,
      claims,
      jti,
      maximum,
      tokenExpiresAt,
      nowEpoch,
      claimUntil,
      ttl,
    }) {
      if (claims.length === 0 || claims.length > maximum) return false;
      try {
        await dynamo.send(
          new TransactWriteItemsCommand({
            ClientRequestToken: crypto.randomUUID(),
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: { S: `token:${jti}` } },
                  UpdateExpression:
                    "SET expiresAt = :ttl, #state = :state ADD queuedPlayers :count",
                  ConditionExpression:
                    "attribute_not_exists(queuedPlayers) OR queuedPlayers <= :remaining",
                  ExpressionAttributeNames: { "#state": "state" },
                  ExpressionAttributeValues: {
                    ":ttl": { N: String(tokenExpiresAt) },
                    ":state": { S: "token-quota" },
                    ":count": { N: String(claims.length) },
                    ":remaining": {
                      N: String(maximum - claims.length),
                    },
                  },
                },
              },
              ...claims.map(({ player, queueToken }) => ({
                Update: {
                  TableName: tableName,
                  Key: { pk: { S: player.cacheKey } },
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
              })),
            ],
          })
        );
        return true;
      } catch (error) {
        if (
          ["TransactionCanceledException", "ConditionalCheckFailedException"].includes(
            error?.name
          )
        ) {
          return false;
        }
        throw error;
      }
    },
    async getSigningSecret(secretName) {
      if (
        cachedSigningSecret &&
        cachedSigningSecret.expiresAt > Date.now()
      ) {
        return cachedSigningSecret.value;
      }
      const output = await secrets.send(
        new GetSecretValueCommand({ SecretId: secretName })
      );
      const value = output.SecretString || "";
      cachedSigningSecret = {
        value,
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
      return value;
    },
    async enqueue({ queueUrl, messages }) {
      const failed = [];
      for (let index = 0; index < messages.length; index += 10) {
        let pending = messages.slice(index, index + 10).map((message, offset) => ({
          id: String(index + offset),
          message,
        }));
        for (let attempt = 0; attempt < 3 && pending.length > 0; attempt += 1) {
          try {
            const output = await sqs.send(
              new SendMessageBatchCommand({
                QueueUrl: queueUrl,
                Entries: pending.map(({ id, message }) => ({
                  Id: id,
                  MessageBody: JSON.stringify(message),
                  DelaySeconds: 5,
                })),
              })
            );
            const failedIds = new Set(
              (output.Failed || []).map((entry) => entry.Id)
            );
            pending = pending.filter(({ id }) => failedIds.has(id));
          } catch (_error) {
            // Retry the unknown batch. Queue tokens make duplicate deliveries inert.
          }
          if (pending.length > 0 && attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, 50 * 2 ** attempt + Math.random() * 25)
            );
          }
        }
        failed.push(...pending.map(({ message }) => message));
      }
      return failed;
    },
    async releaseClaims({ tableName, claims, jti, nowEpoch }) {
      await Promise.all(
        claims.map(async ({ player, queueToken }) => {
          try {
            await dynamo.send(
              new TransactWriteItemsCommand({
                TransactItems: [
                  {
                    Update: {
                      TableName: tableName,
                      Key: { pk: { S: `token:${jti}` } },
                      UpdateExpression: "ADD queuedPlayers :decrement",
                      ConditionExpression: "queuedPlayers >= :one",
                      ExpressionAttributeValues: {
                        ":decrement": { N: "-1" },
                        ":one": { N: "1" },
                      },
                    },
                  },
                  {
                    Update: {
                      TableName: tableName,
                      Key: { pk: { S: player.cacheKey } },
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
        })
      );
    },
  };
  return defaultDependencies;
}

function parseCacheItem(item, playersByKey, now) {
  const key = item?.pk?.S;
  const player = playersByKey.get(key);
  if (!player) return null;
  const validUntil = Date.parse(item?.validUntil?.S || "");
  if (!Number.isFinite(validUntil) || validUntil <= now.getTime()) return null;
  try {
    const payload = JSON.parse(item?.payload?.S || "");
    if (!payload || !Array.isArray(payload.qualitative)) return null;
    return {
      player,
      payload,
      updatedAt: item?.updatedAt?.S || null,
      validUntil,
      researchAfter: Number(item?.researchAfter?.N) || 0,
      state: item?.state?.S || "",
    };
  } catch (_error) {
    return null;
  }
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
    parsed = parseResearchRequest(eventBody(event));
  } catch (error) {
    return response(error.code === "REQUEST_TOO_LARGE" ? 413 : 400, origin, {
      error: error.message,
      code: error.code || "INVALID_REQUEST",
    });
  }
  if (!parsed) {
    return response(400, origin, {
      error: "The research request has no valid ESPN players.",
      code: "INVALID_REQUEST",
    });
  }

  const tableName = process.env.INSIGHTS_TABLE_NAME;
  const queueUrl = process.env.RESEARCH_QUEUE_URL;
  if (!tableName || !queueUrl) {
    return response(503, origin, {
      error: "Player research is not configured.",
      code: "RESEARCH_NOT_CONFIGURED",
    });
  }

  try {
    const dependencies =
      injectedDependencies || (await createDefaultDependencies());
    const playersByKey = new Map(
      parsed.players.map((player) => [player.cacheKey, player])
    );
    const now =
      typeof dependencies.now === "function"
        ? dependencies.now()
        : new Date();
    const rawItems = [];
    for (let index = 0; index < parsed.players.length; index += 100) {
      rawItems.push(
        ...(await dependencies.batchGet({
          tableName,
          keys: parsed.players
            .slice(index, index + 100)
            .map((player) => player.cacheKey),
        }))
      );
    }
    const cached = rawItems
      .map((item) => parseCacheItem(item, playersByKey, now))
      .filter(Boolean);
    const playerOrder = new Map(
      parsed.players.map((player, index) => [player.cacheKey, index])
    );
    cached.sort(
      (left, right) =>
        (playerOrder.get(left.player.cacheKey) ?? Number.MAX_SAFE_INTEGER) -
        (playerOrder.get(right.player.cacheKey) ?? Number.MAX_SAFE_INTEGER)
    );
    const cacheByKey = new Map(
      cached.map((record) => [record.player.cacheKey, record])
    );
    const rawByKey = new Map(
      rawItems
        .filter((item) => item?.pk?.S)
        .map((item) => [item.pk.S, item])
    );
    const nowEpoch = Math.floor(now.getTime() / 1000);
    const alreadyPending = parsed.players.filter((player) =>
      itemIsPending(rawByKey.get(player.cacheKey), nowEpoch)
    ).length;
    let claims = null;
    if (parsed.researchToken && process.env.RESEARCH_SIGNING_SECRET_NAME) {
      try {
        const signingSecret = await dependencies.getSigningSecret(
          process.env.RESEARCH_SIGNING_SECRET_NAME
        );
        claims = researchTokenClaims(
          parsed.researchToken,
          parsed,
          signingSecret,
          now
        );
      } catch (_error) {
        claims = null;
      }
    }
    const authorized = Boolean(claims);
    let queuedClaims = [];
    if (authorized) {
      const candidates = [];
      const schedulingPlayers = [...parsed.players].sort((left, right) => {
        const leftItem = rawByKey.get(left.cacheKey);
        const rightItem = rawByKey.get(right.cacheKey);
        if (Boolean(leftItem) !== Boolean(rightItem)) {
          return leftItem ? 1 : -1;
        }
        return (
          (Number(leftItem?.researchAfter?.N) || 0) -
          (Number(rightItem?.researchAfter?.N) || 0)
        );
      });
      for (const player of schedulingPlayers) {
        if (candidates.length >= Math.max(0, MAX_QUEUE_PER_REQUEST - alreadyPending)) {
          break;
        }
        if (itemIsPending(rawByKey.get(player.cacheKey), nowEpoch)) {
          continue;
        }
        const record = cacheByKey.get(player.cacheKey);
        if (record && record.researchAfter > nowEpoch) continue;
        candidates.push(player);
      }
      const proposedClaims = candidates.map((player) => ({
        player,
        queueToken: crypto.randomUUID(),
      }));
      const committed =
        proposedClaims.length > 0 &&
        (await dependencies.commitClaims({
          tableName,
          claims: proposedClaims,
          jti: claims.jti,
          maximum: claims.maxPlayers,
          tokenExpiresAt: claims.expiresAt,
          nowEpoch,
          claimUntil: nowEpoch + 60 * 60,
          ttl: nowEpoch + 7 * 24 * 60 * 60,
        }));
      if (committed) queuedClaims = proposedClaims;
    }
    if (queuedClaims.length > 0) {
      const failed =
        (await dependencies.enqueue({
        queueUrl,
        messages: queuedClaims.map(({ player, queueToken }) => ({
          schemaVersion: 1,
          requestedAt: now.toISOString(),
          player,
          queueToken,
        })),
        })) || [];
      if (failed.length > 0) {
        await dependencies.releaseClaims({
          tableName,
          claims: failed.map((message) => ({
            player: message.player,
            queueToken: message.queueToken,
          })),
          jti: claims.jti,
          nowEpoch,
        });
        const failedTokens = new Set(
          failed.map((message) => message.queueToken)
        );
        queuedClaims = queuedClaims.filter(
          (claim) => !failedTokens.has(claim.queueToken)
        );
      }
    }
    const pending = alreadyPending + queuedClaims.length;
    return response(
      200,
      origin,
      buildSnapshot(
        cached,
        {
          provider: "firecrawl",
          requested: parsed.players.length,
          cached: cached.length,
          queued: queuedClaims.length,
          pending,
          authorized,
          status:
            pending > 0
              ? cached.length > 0
                ? "refreshing"
                : "queued"
              : !authorized && cached.length < parsed.players.length
                ? "read-only"
                : cached.length < parsed.players.length
                  ? "partial"
                  : "current",
        },
        now
      )
    );
  } catch (_error) {
    return response(502, origin, {
      error: "Player research is temporarily unavailable.",
      code: "RESEARCH_UNAVAILABLE",
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
