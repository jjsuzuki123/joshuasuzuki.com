"use strict";

const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
} = require("@aws-sdk/client-dynamodb");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
} = require("@aws-sdk/client-scheduler");

const model = require("./request-model.js");

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.REQUESTS_TABLE;
const SECRET_NAME = process.env.CONFIG_SECRET_NAME;
const SCHEDULE_GROUP = process.env.SCHEDULE_GROUP;
const SNIPER_FUNCTION_ARN = process.env.SNIPER_FUNCTION_ARN;
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN;

const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const DEFAULT_ORIGIN = "https://www.joshuasuzuki.com";

const db = new DynamoDBClient({ region: REGION });
const secrets = new SecretsManagerClient({ region: REGION });
const scheduler = new SchedulerClient({ region: REGION });

let cachedSecret = null;
let cachedSecretAt = 0;
const SECRET_TTL_MS = 5 * 60 * 1000;

async function loadConfig() {
  const now = Date.now();
  if (cachedSecret && now - cachedSecretAt < SECRET_TTL_MS) {
    return cachedSecret;
  }
  const res = await secrets.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME })
  );
  cachedSecret = JSON.parse(res.SecretString || "{}");
  cachedSecretAt = now;
  return cachedSecret;
}

exports.handler = async (event) => {
  const origin = requestOrigin(event);
  const method =
    event?.requestContext?.http?.method || event?.httpMethod || "GET";
  const rawPath =
    event?.requestContext?.http?.path || event?.rawPath || event?.path || "";
  const path = rawPath.replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") {
    return respond(204, null, origin);
  }

  try {
    if (!TABLE || !SECRET_NAME) {
      console.error("Server misconfigured: missing env");
      return respond(500, { message: "Server misconfigured" }, origin);
    }

    if (method === "POST" && path === "/rsvp/login") {
      return await handleLogin(event, origin);
    }

    // Everything past this point requires a valid session token.
    const auth = await requireAuth(event);
    if (!auth.ok) {
      return respond(401, { message: "Unauthorized" }, origin);
    }

    if (method === "GET" && path === "/rsvp/restaurants") {
      return respond(200, { restaurants: model.listRestaurants() }, origin);
    }
    if (method === "GET" && path === "/rsvp/requests") {
      return await handleListRequests(origin);
    }
    if (method === "POST" && path === "/rsvp/requests") {
      return await handleCreateRequest(event, origin);
    }
    if (method === "DELETE" && path.startsWith("/rsvp/requests/")) {
      const id = decodeURIComponent(path.slice("/rsvp/requests/".length));
      return await handleDeleteRequest(id, origin);
    }

    return respond(404, { message: "Not found" }, origin);
  } catch (err) {
    console.error("requests-api error", err?.name || "Error", err?.message);
    return respond(500, { message: "Unexpected error" }, origin);
  }
};

// ---- Handlers --------------------------------------------------------------

async function handleLogin(event, origin) {
  const body = parseBody(event);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || password.length > 256) {
    return respond(401, { message: "Unauthorized" }, origin);
  }
  const config = await loadConfig();
  if (!config.adminPassword || !config.jwtSecret) {
    console.error("Config secret missing adminPassword/jwtSecret");
    return respond(500, { message: "Server misconfigured" }, origin);
  }
  if (!constantTimeEqual(password, config.adminPassword)) {
    return respond(401, { message: "Unauthorized" }, origin);
  }
  const token = jwt.sign({ role: "rsvp" }, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: TOKEN_TTL_SECONDS,
  });
  return respond(200, { token }, origin);
}

async function handleListRequests(origin) {
  const result = await db.send(new ScanCommand({ TableName: TABLE, Limit: 200 }));
  const items = (result.Items || [])
    .map((item) => {
      try {
        return JSON.parse(item.payload?.S || "{}");
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.releaseEpochMs || 0) - (b.releaseEpochMs || 0));
  return respond(200, { items }, origin);
}

async function handleCreateRequest(event, origin) {
  const body = parseBody(event);
  const validation = model.validateRequestBody(body);
  if (validation.error) {
    return respond(400, { message: validation.error }, origin);
  }

  const id = crypto.randomUUID();
  const built = model.buildRecord(validation.value, { id, nowMs: Date.now() });
  if (built.error) {
    return respond(400, { message: built.error }, origin);
  }
  const { record, wakeEpochMs, ttl } = built;

  // Create the one-time wake schedule first; only persist the request if the
  // schedule is created, so we never show a "scheduled" snipe that can't fire.
  try {
    await scheduler.send(
      new CreateScheduleCommand({
        Name: record.scheduleName,
        GroupName: SCHEDULE_GROUP,
        ScheduleExpression: `at(${model.toSchedulerTime(wakeEpochMs)})`,
        ScheduleExpressionTimezone: "UTC",
        FlexibleTimeWindow: { Mode: "OFF" },
        ActionAfterCompletion: "DELETE",
        Target: {
          Arn: SNIPER_FUNCTION_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
          Input: JSON.stringify({ requestId: id }),
          RetryPolicy: { MaximumRetryAttempts: 0 },
        },
      })
    );
  } catch (err) {
    console.error("Failed to create schedule", err?.name, err?.message);
    return respond(502, { message: "Could not schedule the snipe." }, origin);
  }

  await db.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: {
        id: { S: id },
        payload: { S: JSON.stringify(record) },
        ttl: { N: String(ttl) },
      },
    })
  );

  return respond(201, { item: record }, origin);
}

async function handleDeleteRequest(id, origin) {
  if (!id || id.length > 128) {
    return respond(400, { message: "Invalid id" }, origin);
  }
  // Best-effort schedule cleanup (may already be gone after firing).
  try {
    await scheduler.send(
      new DeleteScheduleCommand({ Name: `req-${id}`, GroupName: SCHEDULE_GROUP })
    );
  } catch (err) {
    if (err?.name !== "ResourceNotFoundException") {
      console.warn("Schedule delete warning", err?.name);
    }
  }
  await db.send(
    new DeleteItemCommand({ TableName: TABLE, Key: { id: { S: id } } })
  );
  return respond(204, null, origin);
}

// ---- Auth helpers ----------------------------------------------------------

async function requireAuth(event) {
  const authHeader =
    event?.headers?.Authorization || event?.headers?.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return { ok: false };
  try {
    const config = await loadConfig();
    if (!config.jwtSecret) return { ok: false };
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (payload.role !== "rsvp") return { ok: false };
    return { ok: true, payload };
  } catch (err) {
    return { ok: false };
  }
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(a || "", "utf8");
  const bufB = Buffer.from(b || "", "utf8");
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufB, bufB);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---- Small utilities -------------------------------------------------------

function parseBody(event) {
  const raw =
    typeof event?.body === "string"
      ? event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body
      : "";
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function requestOrigin(event) {
  return event?.headers?.origin || event?.headers?.Origin || "";
}

function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function corsHeaders(origin) {
  const allowList = allowedOrigins();
  const allow = allowList.includes(origin) ? origin : DEFAULT_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PATCH,DELETE",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function respond(statusCode, body, origin) {
  return {
    statusCode,
    headers: corsHeaders(origin),
    body: body === null ? "" : JSON.stringify(body),
  };
}
