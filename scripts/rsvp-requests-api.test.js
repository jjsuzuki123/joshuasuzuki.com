"use strict";

const assert = require("node:assert/strict");

const model = require("../rsvp-backend/requests-api/request-model.js");

function baseBody(overrides = {}) {
  return {
    restaurantSlug: "carbone",
    diningDate: "2026-08-10",
    partySize: 2,
    earliest: "19:00",
    latest: "21:00",
    ...overrides,
  };
}

function run() {
  // --- listRestaurants exposes snapshot fields and an autoBook flag ---
  const restaurants = model.listRestaurants();
  assert.ok(restaurants.length > 0);
  const carbone = restaurants.find((r) => r.slug === "carbone");
  assert.equal(carbone.platform, "resy");
  assert.equal(carbone.autoBook, true);
  const polo = restaurants.find((r) => r.slug === "the-polo-bar");
  assert.equal(polo.autoBook, false, "phone-only venue is not auto-bookable");

  // --- validation: happy path ---
  const ok = model.validateRequestBody(baseBody());
  assert.equal(ok.error, undefined);
  assert.equal(ok.value.partySize, 2);
  assert.equal(ok.value.bestInWindow, true, "defaults to best-in-window");

  // --- validation: bad inputs ---
  assert.match(model.validateRequestBody(baseBody({ diningDate: "nope" })).error, /diningDate/);
  assert.match(model.validateRequestBody(baseBody({ partySize: 0 })).error, /partySize/);
  assert.match(model.validateRequestBody(baseBody({ partySize: 99 })).error, /partySize/);
  assert.match(model.validateRequestBody(baseBody({ earliest: "9am" })).error, /HH:MM/);
  assert.match(
    model.validateRequestBody(baseBody({ earliest: "21:00", latest: "19:00" })).error,
    /at or before/
  );
  assert.match(
    model.validateRequestBody(baseBody({ resyVenueId: -3 })).error,
    /resyVenueId/
  );

  // --- buildRecord for a known restaurant computes the release + wake time ---
  const nowMs = Date.parse("2026-06-01T12:00:00Z");
  const built = model.buildRecord(model.validateRequestBody(baseBody()).value, {
    id: "id-1",
    nowMs,
  });
  assert.equal(built.error, undefined);
  assert.equal(built.record.restaurantName, "Carbone");
  assert.equal(built.record.status, "scheduled");
  // Carbone: 30 days out at 10:00 ET => dining 2026-08-10 opens 2026-07-11 14:00Z.
  assert.equal(built.record.releaseAt, "2026-07-11T14:00:00.000Z");
  // Wake is 90s before release.
  const expectedWake = built.record.releaseEpochMs - 90_000;
  assert.equal(Date.parse(built.record.wakeAt), expectedWake);
  assert.equal(built.record.scheduleName, "req-id-1");
  // TTL is release + 60 days (in seconds).
  assert.equal(built.ttl, Math.floor(built.record.releaseEpochMs / 1000) + 60 * 24 * 60 * 60);

  // --- buildRecord clamps the wake time to at least 60s out when the release
  //     is imminent or already past (cancellation / testing) ---
  const soon = model.buildRecord(
    model.validateRequestBody(baseBody({ releaseAtOverride: "2020-01-01T00:00:00Z" })).value,
    { id: "id-2", nowMs }
  );
  assert.equal(Date.parse(soon.record.wakeAt), nowMs + 60_000);

  // --- unknown restaurant requires a venue override ---
  const unknown = model.buildRecord(
    model.validateRequestBody(baseBody({ restaurantSlug: "does-not-exist" })).value,
    { id: "id-3", nowMs }
  );
  assert.match(unknown.error, /Unknown restaurant/);

  // --- unknown restaurant WITH a resy override builds an auto-bookable record ---
  const custom = model.buildRecord(
    model.validateRequestBody(
      baseBody({
        restaurantSlug: "",
        restaurantName: "Secret Spot",
        resyVenueId: 12345,
        releaseRule: { type: "daily", daysOut: 7, time: "09:00" },
      })
    ).value,
    { id: "id-4", nowMs }
  );
  assert.equal(custom.error, undefined);
  assert.equal(custom.record.resyVenueId, 12345);
  assert.equal(custom.record.autoBook, true);
  assert.equal(custom.record.restaurantName, "Secret Spot");

  // --- releaseRule override applies for a known restaurant ---
  const overridden = model.buildRecord(
    model.validateRequestBody(
      baseBody({ releaseRule: { type: "daily", daysOut: 1, time: "12:00" } })
    ).value,
    { id: "id-5", nowMs }
  );
  assert.equal(overridden.record.releaseAt, "2026-08-09T16:00:00.000Z");

  // --- toSchedulerTime yields a Scheduler at() body (no ms, no Z) ---
  assert.equal(model.toSchedulerTime(Date.parse("2026-07-11T13:58:30.500Z")), "2026-07-11T13:58:30");

  console.log("RSVP requests-api model tests passed.");
}

run();
