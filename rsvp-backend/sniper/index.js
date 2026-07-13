"use strict";

const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

const { createResyClient } = require("../resy-client.js");
const { runSnipe } = require("./snipe-core.js");

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.REQUESTS_TABLE;
const SECRET_NAME = process.env.CONFIG_SECRET_NAME;
const TOPIC_ARN = process.env.NOTIFICATIONS_TOPIC_ARN;

const db = new DynamoDBClient({ region: REGION });
const secrets = new SecretsManagerClient({ region: REGION });
const sns = new SNSClient({ region: REGION });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => Date.now();

exports.handler = async (event) => {
  const requestId = event?.requestId || event?.detail?.requestId;
  if (!requestId) {
    console.error("No requestId in event");
    return { ok: false, reason: "no-request-id" };
  }

  const record = await loadRequest(requestId);
  if (!record) {
    console.error("Request not found", requestId);
    return { ok: false, reason: "not-found" };
  }
  // Idempotency: only act on a request that is still waiting.
  if (record.status !== "scheduled" && record.status !== "armed") {
    console.log("Request not actionable", { requestId, status: record.status });
    return { ok: true, skipped: true, status: record.status };
  }

  await updateRecord(requestId, (r) => ({ ...r, status: "armed", armedAt: new Date().toISOString() }));

  // Venues we can't auto-book (phone-only, or non-Resy platforms) get a
  // reminder instead of a booking attempt.
  if (record.platform !== "resy" || record.autoBook === false) {
    const bookingUrl = record.bookingUrl || "";
    await notify(
      `RSVP reminder: ${record.restaurantName}`,
      `Reservations for ${record.restaurantName} (${record.diningDate}, party of ${record.partySize}) ` +
        `open around ${record.releaseAt}. This venue can't be auto-booked${
          bookingUrl ? `; book here: ${bookingUrl}` : "."
        }`
    );
    await finalize(requestId, {
      status: "reminded",
      message: "Reminder sent; venue is not auto-bookable.",
    });
    return { ok: true, status: "reminded" };
  }

  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    console.error("Failed to load config secret", err?.name);
    await finalize(requestId, { status: "failed", message: "Server misconfigured (secret)." });
    return { ok: false, reason: "secret" };
  }

  if (!config.resyEmail && !config.resyAuthToken) {
    await finalize(requestId, {
      status: "failed",
      message: "No Resy credentials configured.",
    });
    await notify(
      `RSVP snipe could not run: ${record.restaurantName}`,
      "No Resy credentials are configured in the sniper secret."
    );
    return { ok: false, reason: "no-credentials" };
  }

  const client = createResyClient({
    email: config.resyEmail,
    password: config.resyPassword,
    authToken: config.resyAuthToken || null,
    apiKey: config.resyApiKey || undefined,
    proxy: config.proxyUrl || undefined,
    impersonate: config.impersonate || undefined,
  });

  let outcome;
  try {
    // Pre-warm: authenticate + open the connection + measure the clock offset
    // against Resy so we can fire at the exact release millisecond.
    let clock = null;
    try {
      const warmed = await client.prewarm();
      clock = warmed.clock;
    } catch (err) {
      console.warn("Pre-warm/clock measurement failed; firing on local clock", err?.name);
      try {
        await client.authenticate();
      } catch (authErr) {
        await finalize(requestId, { status: "failed", message: "Resy login failed." });
        await notify(
          `RSVP snipe could not run: ${record.restaurantName}`,
          `Resy login failed: ${authErr?.message || authErr?.name || "unknown error"}`
        );
        return { ok: false, reason: "auth" };
      }
    }

    const venueId = await resolveVenueId(client, record);
    if (!venueId) {
      await finalize(requestId, {
        status: "failed",
        message: "Could not resolve the Resy venue id.",
      });
      await notify(
        `RSVP snipe could not run: ${record.restaurantName}`,
        "Could not resolve the Resy venue. Add a resyVenueId override to the request."
      );
      return { ok: false, reason: "venue" };
    }

    // Notify-only snipes never book, so they don't need a payment method.
    const mode = record.mode === "autobook" ? "autobook" : "notify";
    const paymentMethodId =
      mode === "autobook"
        ? await client.resolvePaymentMethodId(config.paymentMethodId).catch(() => null)
        : null;

    outcome = await runSnipe({
      record,
      client,
      clock,
      venueId,
      paymentMethodId,
      mode,
      deps: { now, sleep, log: (msg, meta) => console.log(msg, meta || "") },
      config: {
        maxPollMs: Number(config.maxPollMs) || undefined,
      },
    });
  } catch (err) {
    console.error("Snipe crashed", err?.name, err?.message);
    await finalize(requestId, {
      status: "failed",
      message: `Snipe error: ${err?.message || err?.name || "unknown"}`,
    });
    await notify(
      `RSVP snipe error: ${record.restaurantName}`,
      `The snipe crashed: ${err?.message || err?.name || "unknown error"}`
    );
    return { ok: false, reason: "crash" };
  } finally {
    await client.close().catch(() => {});
  }

  await finalize(requestId, {
    status: outcome.status,
    message: outcome.message || null,
    reservationId: outcome.reservation?.reservationId || null,
    resyToken: outcome.reservation?.resyToken || null,
    slot: outcome.slot || null,
    availableSlots: outcome.slots || null,
    findCalls: outcome.findCalls,
    bookAttempts: outcome.bookAttempts,
  });

  await notifyOutcome(record, outcome);
  return { ok: true, status: outcome.status };
};

// ---- Venue resolution ------------------------------------------------------

async function resolveVenueId(client, record) {
  if (record.resyVenueId) return Number(record.resyVenueId);
  const query = record.resySlug || record.restaurantName;
  if (!query) return null;
  let hits = [];
  try {
    hits = await client.searchVenues(query);
  } catch (err) {
    console.warn("Venue search failed", err?.name);
    return null;
  }
  const wantSlug = (record.resySlug || "").toLowerCase();
  const wantName = (record.restaurantName || "").toLowerCase();
  const scored = hits
    .map((hit) => {
      const venue = hit?.venue || hit;
      const id =
        venue?.id?.resy ?? venue?.id ?? hit?.objectID ?? hit?.id ?? null;
      const name = String(venue?.name || hit?.name || "").toLowerCase();
      const urlSlug = String(venue?.url_slug || venue?.urlSlug || "").toLowerCase();
      let score = 0;
      if (wantSlug && urlSlug === wantSlug) score += 3;
      if (wantName && name === wantName) score += 2;
      if (wantName && name.includes(wantName)) score += 1;
      return { id: id ? Number(id) : null, score };
    })
    .filter((c) => c.id)
    .sort((a, b) => b.score - a.score);
  // Require a real match; don't guess a random venue.
  return scored.length && scored[0].score > 0 ? scored[0].id : null;
}

// ---- Persistence -----------------------------------------------------------

async function loadRequest(id) {
  const res = await db.send(
    new GetItemCommand({ TableName: TABLE, Key: { id: { S: id } } })
  );
  if (!res.Item?.payload?.S) return null;
  try {
    return JSON.parse(res.Item.payload.S);
  } catch {
    return null;
  }
}

// Read-modify-write the JSON payload attribute. Fine for the single-writer
// drop path; low volume, no contention.
async function updateRecord(id, mutate) {
  const current = await loadRequest(id);
  if (!current) return null;
  const next = mutate(current);
  next.updatedAt = new Date().toISOString();
  await db.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { id: { S: id } },
      UpdateExpression: "SET payload = :p",
      ExpressionAttributeValues: { ":p": { S: JSON.stringify(next) } },
    })
  );
  return next;
}

async function finalize(id, result) {
  const status = result.status;
  await updateRecord(id, (r) => ({
    ...r,
    status,
    completedAt: new Date().toISOString(),
    result: {
      message: result.message || null,
      reservationId: result.reservationId || null,
      resyToken: result.resyToken || null,
      slot: result.slot || null,
      availableSlots: result.availableSlots || null,
      findCalls: result.findCalls ?? null,
      bookAttempts: result.bookAttempts ?? null,
    },
  }));
}

// ---- Notifications ---------------------------------------------------------

async function notify(subject, message) {
  if (!TOPIC_ARN) {
    console.log("notify (no topic)", subject, message);
    return;
  }
  try {
    await sns.send(
      new PublishCommand({
        TopicArn: TOPIC_ARN,
        Subject: subject.slice(0, 99),
        Message: message,
      })
    );
  } catch (err) {
    console.warn("Notify failed", err?.name);
  }
}

function bookingUrlFor(record) {
  if (record.bookingUrl) return record.bookingUrl;
  if (record.resySlug) {
    return `https://resy.com/cities/new-york-ny/venues/${record.resySlug}`;
  }
  return "https://resy.com";
}

async function notifyOutcome(record, outcome) {
  const label = `${record.restaurantName} (${record.diningDate}, party of ${record.partySize})`;
  if (outcome.status === "booked") {
    await notify(
      `Booked: ${record.restaurantName}`,
      `Got a table at ${label} for ${outcome.slot?.time || "your window"}` +
        `${outcome.slot?.seatingType ? ` (${outcome.slot.seatingType})` : ""}. ` +
        `Confirmation ${outcome.reservation?.reservationId}.`
    );
  } else if (outcome.status === "available") {
    const times = (outcome.slots || [])
      .map((s) => `${s.time}${s.seatingType ? ` ${s.seatingType}` : ""}`)
      .join(", ");
    await notify(
      `Tables open: ${record.restaurantName}`,
      `Tables just opened for ${label}: ${times || "see the app"}. ` +
        `Book now (they go fast): ${bookingUrlFor(record)}`
    );
  } else if (outcome.status === "missed") {
    await notify(
      `Missed: ${record.restaurantName}`,
      `No availability appeared in your window for ${label}. ${outcome.message || ""}`
    );
  } else {
    await notify(
      `Snipe failed: ${record.restaurantName}`,
      `Could not book ${label}. ${outcome.message || ""}`
    );
  }
}

// ---- Config ----------------------------------------------------------------

async function loadConfig() {
  const res = await secrets.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME })
  );
  return JSON.parse(res.SecretString || "{}");
}
