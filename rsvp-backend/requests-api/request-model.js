"use strict";

// Pure request-shaping logic for the RSVP requests API: validation, release
// time resolution, and building the stored record. No AWS SDK imports so it
// can be unit-tested with plain `node` (matching scripts/*.test.js).

const releaseRules = require("../release-rules.js");
const snapshot = require("../data/nycrsvps-snapshot.json");

const MAX_PARTY_SIZE = 20;

// Wake the sniper this long before the release: comfortably more than a minute
// so EventBridge Scheduler jitter and Lambda cold start are absorbed before the
// function busy-waits to the exact release millisecond.
const WAKE_LEAD_SECONDS = 90;
const MIN_WAKE_DELAY_MS = 60_000;
const REQUEST_RETENTION_SECONDS = 60 * 24 * 60 * 60; // 60 days

function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

// EventBridge Scheduler at() expression in UTC: yyyy-mm-ddThh:mm:ss
function toSchedulerTime(epochMs) {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, "");
}

function findRestaurant(slug) {
  if (!slug) return null;
  return (snapshot.restaurants || []).find((r) => r.slug === slug) || null;
}

function listRestaurants() {
  return (snapshot.restaurants || []).map((r) => ({
    name: r.name,
    slug: r.slug,
    neighborhood: r.neighborhood,
    platform: r.platform,
    bookingUrl: r.bookingUrl,
    release: r.release,
    autoBook: r.platform === "resy" && r.autoBook !== false,
    verified: Boolean(r.verified),
  }));
}

function validateRequestBody(body) {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object." };
  }
  const restaurantSlug =
    typeof body.restaurantSlug === "string" ? body.restaurantSlug.trim() : "";

  const diningDate = typeof body.diningDate === "string" ? body.diningDate.trim() : "";
  if (!releaseRules.parseDate(diningDate)) {
    return { error: "diningDate must be a valid YYYY-MM-DD date." };
  }

  const partySize = Number(body.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > MAX_PARTY_SIZE) {
    return { error: `partySize must be an integer between 1 and ${MAX_PARTY_SIZE}.` };
  }

  const earliest = typeof body.earliest === "string" ? body.earliest.trim() : "";
  const latest = typeof body.latest === "string" ? body.latest.trim() : "";
  const earliestMin = timeToMinutes(earliest);
  const latestMin = timeToMinutes(latest);
  if (earliestMin === null || latestMin === null) {
    return { error: "earliest and latest must be HH:MM times." };
  }
  if (earliestMin > latestMin) {
    return { error: "earliest must be at or before latest." };
  }

  const seatingPreference =
    typeof body.seatingPreference === "string" && body.seatingPreference.trim()
      ? body.seatingPreference.trim().slice(0, 64)
      : null;

  const bestInWindow = body.bestInWindow === undefined ? true : Boolean(body.bestInWindow);

  const resyVenueId =
    body.resyVenueId !== undefined && body.resyVenueId !== null && `${body.resyVenueId}`.trim()
      ? Number(body.resyVenueId)
      : null;
  if (resyVenueId !== null && (!Number.isInteger(resyVenueId) || resyVenueId <= 0)) {
    return { error: "resyVenueId must be a positive integer when provided." };
  }
  const resySlug =
    typeof body.resySlug === "string" && body.resySlug.trim()
      ? body.resySlug.trim().slice(0, 128)
      : null;

  let releaseRule = null;
  if (body.releaseRule !== undefined && body.releaseRule !== null) {
    if (typeof body.releaseRule !== "object") {
      return { error: "releaseRule must be an object when provided." };
    }
    releaseRule = body.releaseRule;
  }

  const releaseAtOverride =
    typeof body.releaseAtOverride === "string" && body.releaseAtOverride.trim()
      ? body.releaseAtOverride.trim()
      : null;

  const restaurantName =
    typeof body.restaurantName === "string" ? body.restaurantName.trim().slice(0, 128) : "";

  return {
    value: {
      restaurantSlug,
      restaurantName,
      diningDate,
      partySize,
      earliest,
      latest,
      seatingPreference,
      bestInWindow,
      resyVenueId,
      resySlug,
      releaseRule,
      releaseAtOverride,
    },
  };
}

// Build the full stored record (and derived scheduling fields) from validated
// input. Returns { error } or { record, wakeEpochMs, ttl }.
function buildRecord(input, { id, nowMs }) {
  const restaurant = findRestaurant(input.restaurantSlug);
  if (!restaurant && !input.resyVenueId && !input.resySlug) {
    return { error: "Unknown restaurant and no Resy venue override provided." };
  }

  const rule = input.releaseRule || restaurant?.release || null;

  let releaseEpochMs;
  let releaseIso;
  let releaseExplanation;

  if (input.releaseAtOverride) {
    releaseEpochMs = Date.parse(input.releaseAtOverride);
    if (!Number.isFinite(releaseEpochMs)) {
      return { error: "releaseAtOverride is not a valid date." };
    }
    releaseIso = new Date(releaseEpochMs).toISOString();
    releaseExplanation = `Manual release override at ${releaseIso}.`;
  } else {
    const computed = releaseRules.computeReleaseInstant(rule, input.diningDate);
    if (!computed) {
      return {
        error:
          "Could not compute the release time. Provide a releaseRule or releaseAtOverride.",
      };
    }
    releaseEpochMs = computed.epochMs;
    releaseIso = computed.iso;
    releaseExplanation = computed.explanation;
  }

  const wakeEpochMs = Math.max(
    nowMs + MIN_WAKE_DELAY_MS,
    releaseEpochMs - WAKE_LEAD_SECONDS * 1000
  );

  const nowIso = new Date(nowMs).toISOString();
  const record = {
    id,
    status: "scheduled",
    createdAt: nowIso,
    updatedAt: nowIso,
    restaurantSlug: input.restaurantSlug || null,
    restaurantName:
      restaurant?.name || input.restaurantName || input.restaurantSlug || "Custom venue",
    platform: restaurant?.platform || "resy",
    autoBook: restaurant
      ? restaurant.platform === "resy" && restaurant.autoBook !== false
      : true,
    resyVenueId: input.resyVenueId || restaurant?.resyVenueId || null,
    resySlug: input.resySlug || restaurant?.resySlug || null,
    diningDate: input.diningDate,
    partySize: input.partySize,
    window: { earliest: input.earliest, latest: input.latest },
    seatingPreference: input.seatingPreference || null,
    bestInWindow: input.bestInWindow,
    releaseRule: rule || null,
    releaseAt: releaseIso,
    releaseEpochMs,
    releaseExplanation,
    wakeAt: new Date(wakeEpochMs).toISOString(),
    scheduleName: `req-${id}`,
    result: null,
  };

  const ttl = Math.floor(releaseEpochMs / 1000) + REQUEST_RETENTION_SECONDS;
  return { record, wakeEpochMs, ttl };
}

module.exports = {
  MAX_PARTY_SIZE,
  WAKE_LEAD_SECONDS,
  timeToMinutes,
  toSchedulerTime,
  findRestaurant,
  listRestaurants,
  validateRequestBody,
  buildRecord,
};
