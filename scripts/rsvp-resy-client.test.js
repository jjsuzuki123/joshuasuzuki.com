"use strict";

const assert = require("node:assert/strict");

const { createResyClient, ResyError } = require("../rsvp-backend/resy-client.js");

// A fake transport records every call and replays queued responses. This lets
// us exercise the full auth -> find -> details -> book flow with no network.
function makeTransport(handlers) {
  const calls = [];
  const transport = async (method, url, options) => {
    calls.push({ method, url, options });
    const key = `${method} ${new URL(url).pathname}`;
    const handler = handlers[key];
    if (!handler) {
      return { status: 404, headers: new Map(), body: JSON.stringify({ message: "no handler" }) };
    }
    const result = typeof handler === "function" ? handler({ method, url, options }) : handler;
    return {
      status: result.status ?? 200,
      headers: result.headers ?? new Map(),
      body: result.body !== undefined ? result.body : JSON.stringify(result.json ?? {}),
      timing: result.timing ?? { sentAt: 1000, receivedAt: 1040 },
    };
  };
  transport.calls = calls;
  return transport;
}

async function run() {
  // --- authenticate via email/password caches the token and sets headers ---
  {
    const transport = makeTransport({
      "POST /3/auth/password": ({ options }) => {
        assert.match(options.body, /email=me%40example.com/);
        assert.match(options.body, /password=hunter2/);
        return { json: { token: "auth-token-xyz" } };
      },
      "GET /2/user": ({ options }) => {
        // Confirms the auth token is attached after login.
        const token = readHeader(options.headers, "X-Resy-Auth-Token");
        assert.equal(token, "auth-token-xyz");
        return { json: { payment_methods: [{ id: 55, is_default: true }] } };
      },
    });
    const client = createResyClient({
      transport,
      email: "me@example.com",
      password: "hunter2",
    });
    const token = await client.authenticate();
    assert.equal(token, "auth-token-xyz");
    const paymentId = await client.resolvePaymentMethodId();
    assert.equal(paymentId, 55);
  }

  // --- authorization header carries the public api key ---
  {
    const transport = makeTransport({
      "GET /2/user": ({ options }) => {
        const auth = readHeader(options.headers, "Authorization");
        assert.match(auth, /^ResyAPI api_key="/);
        return { json: { payment_methods: [] } };
      },
    });
    const client = createResyClient({ transport, authToken: "t" });
    await client.getUser();
  }

  // --- findSlots parses the nested results and picks the matching venue ---
  {
    const transport = makeTransport({
      "GET /4/find": () => ({
        headers: new Map([["date", "Mon, 13 Jul 2026 14:00:00 GMT"]]),
        json: {
          results: {
            venues: [
              {
                venue: { id: { resy: 494 }, name: "Carbone" },
                slots: [
                  { date: { start: "2026-08-10 19:00:00" }, config: { type: "Dining Room", token: "cfg-1900" } },
                ],
              },
            ],
          },
        },
      }),
    });
    const client = createResyClient({ transport, authToken: "t" });
    const found = await client.findSlots({ venueId: 494, day: "2026-08-10", partySize: 2 });
    assert.equal(found.slots.length, 1);
    assert.equal(found.venue.name, "Carbone");
    assert.equal(found.slots[0].config.token, "cfg-1900");
    assert.equal(found.serverDate, "Mon, 13 Jul 2026 14:00:00 GMT");
  }

  // --- details -> book two-token flow ---
  {
    const transport = makeTransport({
      "POST /3/details": ({ options }) => {
        const payload = JSON.parse(options.body);
        assert.equal(payload.config_id, "cfg-1900");
        assert.equal(payload.party_size, 2);
        return { json: { book_token: { value: "book-token-abc" }, user: { payment_methods: [{ id: 55 }] } } };
      },
      "POST /3/book": ({ options }) => {
        assert.match(options.body, /book_token=book-token-abc/);
        assert.match(options.body, /struct_payment_method/);
        return { json: { reservation_id: 987654, resy_token: "resy-tok" } };
      },
    });
    const client = createResyClient({ transport, authToken: "t" });
    const details = await client.getReservationDetails({
      configToken: "cfg-1900",
      day: "2026-08-10",
      partySize: 2,
    });
    assert.equal(details.bookToken, "book-token-abc");
    const booking = await client.book({ bookToken: details.bookToken, paymentMethodId: 55 });
    assert.equal(booking.reservationId, 987654);
    assert.equal(booking.resyToken, "resy-tok");
  }

  // --- typed errors for auth / blocked / rate-limited responses ---
  {
    const transport = makeTransport({
      "GET /2/user": () => ({ status: 401, json: { message: "bad token" } }),
    });
    const client = createResyClient({ transport, authToken: "stale" });
    await assert.rejects(
      () => client.getUser(),
      (err) => err instanceof ResyError && err.code === "AUTH_REJECTED" && err.status === 401
    );
  }
  {
    const transport = makeTransport({
      "GET /4/find": () => ({ status: 429, json: { message: "slow down" } }),
    });
    const client = createResyClient({ transport, authToken: "t" });
    await assert.rejects(
      () => client.findSlots({ venueId: 1, day: "2026-08-10", partySize: 2 }),
      (err) => err.code === "RATE_LIMITED"
    );
  }

  // --- measureServerClock keeps the lowest-RTT sample and computes offset ---
  {
    let call = 0;
    const transport = makeTransport({
      "GET /2/config": () => {
        call += 1;
        // Server clock is exactly 2026-07-13T14:00:00Z on each sample.
        const headers = new Map([["date", "Mon, 13 Jul 2026 14:00:00 GMT"]]);
        // Second sample has the smallest RTT (10ms) and should win.
        const timings = [
          { sentAt: 1_752_415_000_000, receivedAt: 1_752_415_000_100 },
          { sentAt: 1_752_415_000_200, receivedAt: 1_752_415_000_210 },
          { sentAt: 1_752_415_000_300, receivedAt: 1_752_415_000_360 },
        ];
        return { headers, json: {}, timing: timings[call - 1] };
      },
    });
    const client = createResyClient({ transport, authToken: "t" });
    const clock = await client.measureServerClock({ samples: 3 });
    assert.equal(clock.rttMs, 10, "keeps the lowest-RTT sample");
    assert.equal(typeof clock.offsetMs, "number");
  }

  console.log("RSVP resy-client tests passed.");
}

function readHeader(headers, name) {
  if (headers && typeof headers.get === "function") return headers.get(name);
  return headers ? headers[name] : null;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
