"use strict";

// End-to-end integration test that exercises the real modules together across
// their seams, simulating an actual reservation drop with no network:
//
//   request-model (real release computation + record shape)
//        -> snipe-core (real timing + polling + ranking + fallback)
//        -> resy-client (real request building + response parsing)
//        -> fake Resy HTTP transport (empty before the drop, slots after)
//
// The only injected boundary is the HTTP transport; everything above it is the
// production code path.

const assert = require("node:assert/strict");

const model = require("../rsvp-backend/requests-api/request-model.js");
const { createResyClient } = require("../rsvp-backend/resy-client.js");
const { runSnipe } = require("../rsvp-backend/sniper/snipe-core.js");

// A virtual clock the polling loop advances via sleep(); the fake Resy uses it
// to decide when tables "open".
function virtualClock(startMs) {
  let t = startMs;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    set: (v) => {
      t = v;
    },
  };
}

// A fake api.resy.com implemented as an `impers`-style transport: it receives
// (method, url, { headers, body }) and returns { status, headers, body }.
function fakeResy({ clock, releaseAtMs, venueId, venueName }) {
  const calls = { find: 0, details: 0, book: 0, auth: 0 };
  let booked = false;

  const transport = async (method, url, options = {}) => {
    const u = new URL(url);
    const path = u.pathname;
    const json = (status, obj) => ({
      status,
      headers: new Map([["date", new Date(clock.now()).toUTCString()]]),
      body: JSON.stringify(obj),
      timing: { sentAt: clock.now(), receivedAt: clock.now() + 20 },
    });

    if (method === "POST" && path === "/3/auth/password") {
      calls.auth += 1;
      return json(200, { token: "e2e-auth-token" });
    }
    if (method === "GET" && path === "/2/config") {
      return json(200, { ok: true });
    }
    if (method === "GET" && path === "/2/user") {
      return json(200, { payment_methods: [{ id: 4242, is_default: true }] });
    }
    if (method === "GET" && path === "/4/find") {
      calls.find += 1;
      // Sanity: the client must send party size + venue id.
      assert.equal(u.searchParams.get("venue_id"), String(venueId));
      assert.ok(u.searchParams.get("party_size"));
      if (clock.now() < releaseAtMs) {
        return json(200, { results: { venues: [] } });
      }
      return json(200, {
        results: {
          venues: [
            {
              venue: { id: { resy: venueId }, name: venueName },
              slots: [
                { date: { start: "2026-08-10 18:00:00" }, config: { type: "Dining Room", token: "cfg-1800" } },
                { date: { start: "2026-08-10 19:30:00" }, config: { type: "Dining Room", token: "cfg-1930" } },
                { date: { start: "2026-08-10 20:00:00" }, config: { type: "Bar", token: "cfg-2000-bar" } },
              ],
            },
          ],
        },
      });
    }
    if (method === "POST" && path === "/3/details") {
      calls.details += 1;
      const payload = JSON.parse(options.body);
      assert.ok(payload.config_id, "details needs a config token");
      return json(200, { book_token: { value: `book-${payload.config_id}` } });
    }
    if (method === "POST" && path === "/3/book") {
      calls.book += 1;
      assert.match(options.body, /book_token=book-/);
      assert.match(options.body, /struct_payment_method/);
      if (booked) return { status: 409, headers: new Map(), body: JSON.stringify({ message: "already booked" }) };
      booked = true;
      return json(201, { reservation_id: 55501, resy_token: "resy-token-e2e" });
    }
    return { status: 404, headers: new Map(), body: "{}" };
  };
  transport.calls = calls;
  return transport;
}

async function run() {
  const T0 = 1_800_000_000_000; // fixed virtual epoch
  const clock = virtualClock(T0);
  const venueId = 494;

  // 1) Build a request through the real model (manual release rule so the drop
  //    time is explicit), then align its release to our virtual clock.
  const validation = model.validateRequestBody({
    restaurantSlug: "carbone",
    diningDate: "2026-08-10",
    partySize: 2,
    earliest: "19:00",
    latest: "21:00",
    seatingPreference: "Dining Room",
  });
  assert.equal(validation.error, undefined);
  const built = model.buildRecord(validation.value, { id: "e2e-1", nowMs: T0 });
  assert.equal(built.error, undefined);
  assert.equal(built.record.restaurantName, "Carbone");
  assert.equal(built.record.resySlug, "carbone");
  const record = built.record;
  // Drop opens 5s into the run.
  const releaseAtMs = T0 + 5_000;
  record.releaseEpochMs = releaseAtMs;

  // 2) Real Resy client over the fake transport.
  const transport = fakeResy({ clock, releaseAtMs, venueId, venueName: "Carbone" });
  const client = createResyClient({
    transport,
    email: "e2e@example.com",
    password: "secret",
  });

  // 3) Pre-warm exercises auth + clock measurement (real code paths).
  const warmed = await client.prewarm();
  assert.equal(client.getAuthToken(), "e2e-auth-token");
  assert.ok(warmed.clock, "prewarm measured a server clock");

  // 4) Resolve the venue id via the record override and a payment method.
  const paymentMethodId = await client.resolvePaymentMethodId();
  assert.equal(paymentMethodId, 4242);

  // 5) Run the real sniper loop. clock=null => fire on our (virtual) clock,
  //    which the fake Resy also reads, so slots appear exactly at release.
  const outcome = await runSnipe({
    record,
    client,
    clock: null,
    venueId,
    paymentMethodId,
    deps: { now: clock.now, sleep: clock.sleep },
    config: { pollIntervalMs: 200, jitterMs: 0, maxPollMs: 60_000, preReleaseLeadMs: 250 },
  });

  // 6) It booked the best in-window slot (19:30, closest to the 20:00 midpoint,
  //    Dining Room preference) via the two-token flow.
  assert.equal(outcome.status, "booked", `expected booked, got ${outcome.status}: ${outcome.message || ""}`);
  assert.equal(outcome.slot.time, "19:30");
  assert.equal(outcome.slot.seatingType, "Dining Room");
  assert.equal(outcome.reservation.reservationId, 55501);
  assert.equal(outcome.reservation.resyToken, "resy-token-e2e");
  assert.ok(transport.calls.find >= 1, "polled find at least once");
  assert.equal(transport.calls.details, 1);
  assert.equal(transport.calls.book, 1);

  // 7) The loop only started returning slots at/after release: it must have
  //    polled at least one empty find before the drop (fired early).
  assert.ok(transport.calls.find >= 2, "fired before the drop and polled through it");

  await client.close();
  console.log("RSVP end-to-end integration test passed.");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
