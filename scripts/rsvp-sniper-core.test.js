"use strict";

const assert = require("node:assert/strict");

const core = require("../rsvp-backend/sniper/snipe-core.js");

function resySlot(start, type, token) {
  return { date: { start }, config: { type, token } };
}

// A fake clock: now() advances only when sleep() is called, so the polling
// loop is deterministic and instant.
function fakeClock(startMs) {
  let t = startMs;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

function baseRecord(overrides = {}) {
  return {
    diningDate: "2026-08-10",
    partySize: 2,
    window: { earliest: "19:00", latest: "21:00" },
    seatingPreference: null,
    bestInWindow: true,
    releaseEpochMs: 1_000_000,
    ...overrides,
  };
}

async function run() {
  // --- computeFireStartMs compensates for offset + RTT ---
  {
    const { sendAtLocalMs, delayMs } = core.computeFireStartMs({
      releaseEpochMs: 1_000_000,
      clock: { offsetMs: 5_000, rttMs: 100 },
      nowMs: 900_000,
      preReleaseLeadMs: 250,
    });
    // local release = release - offset = 995000; minus rtt/2 (50) minus lead (250).
    assert.equal(sendAtLocalMs, 995_000 - 50 - 250);
    assert.equal(delayMs, sendAtLocalMs - 900_000);
  }
  {
    // Never returns a negative delay.
    const { delayMs } = core.computeFireStartMs({
      releaseEpochMs: 1_000_000,
      clock: null,
      nowMs: 2_000_000,
      preReleaseLeadMs: 250,
    });
    assert.equal(delayMs, 0);
  }

  // --- selectCandidates honors bestInWindow ---
  {
    const slots = [
      resySlot("2026-08-10 19:00:00", "Dining Room", "t1900"),
      resySlot("2026-08-10 20:00:00", "Dining Room", "t2000"),
      resySlot("2026-08-10 22:30:00", "Dining Room", "t2230"),
    ];
    const many = core.selectCandidates(slots, {
      earliest: "19:00",
      latest: "21:00",
      bestInWindow: true,
      maxAttempts: 4,
    });
    assert.equal(many.length, 2, "only in-window slots, both attemptable");
    const one = core.selectCandidates(slots, {
      earliest: "19:00",
      latest: "21:00",
      bestInWindow: false,
      maxAttempts: 4,
    });
    assert.equal(one.length, 1, "bestInWindow=false attempts only the top slot");
  }

  // --- books the best in-window slot on the first find that returns slots ---
  {
    const clock = fakeClock(999_000);
    let findCalls = 0;
    const client = {
      findSlots: async () => {
        findCalls += 1;
        // First two polls empty, third returns slots (simulating the drop).
        if (findCalls < 3) return { slots: [] };
        return {
          slots: [
            resySlot("2026-08-10 19:00:00", "Bar", "cfg-1900-bar"),
            resySlot("2026-08-10 19:30:00", "Dining Room", "cfg-1930"),
          ],
        };
      },
      getReservationDetails: async ({ configToken }) => ({ bookToken: `book-${configToken}` }),
      book: async ({ bookToken }) => ({ reservationId: 111, resyToken: bookToken }),
    };
    const outcome = await core.runSnipe({
      record: baseRecord(),
      client,
      clock: { offsetMs: 0, rttMs: 0 },
      venueId: 494,
      paymentMethodId: 55,
      deps: { now: clock.now, sleep: clock.sleep },
      config: { pollIntervalMs: 100, jitterMs: 0, maxPollMs: 90_000 },
    });
    assert.equal(outcome.status, "booked");
    // 19:30 is the closest to the 20:00 midpoint of a 19:00-21:00 window.
    assert.equal(outcome.slot.time, "19:30");
    assert.equal(outcome.reservation.reservationId, 111);
    assert.ok(findCalls >= 3);
  }

  // --- falls back to the next candidate when the first booking loses a race ---
  {
    const clock = fakeClock(1_000_000);
    let bookCalls = 0;
    const client = {
      findSlots: async () => ({
        slots: [
          resySlot("2026-08-10 19:30:00", "Dining Room", "cfg-1930"),
          resySlot("2026-08-10 20:00:00", "Dining Room", "cfg-2000"),
        ],
      }),
      getReservationDetails: async ({ configToken }) => ({ bookToken: `book-${configToken}` }),
      book: async ({ bookToken }) => {
        bookCalls += 1;
        // 20:00 is the window midpoint so it is attempted first; simulate it
        // being taken, forcing a fall back to the 19:30 slot.
        if (bookToken === "book-cfg-2000") {
          const err = new Error("slot taken");
          err.code = "HTTP_ERROR";
          throw err;
        }
        return { reservationId: 222, resyToken: bookToken };
      },
    };
    const outcome = await core.runSnipe({
      record: baseRecord(),
      client,
      clock: { offsetMs: 0, rttMs: 0 },
      venueId: 1,
      deps: { now: clock.now, sleep: clock.sleep },
      config: { pollIntervalMs: 100, jitterMs: 0, maxPollMs: 5_000 },
    });
    assert.equal(outcome.status, "booked");
    assert.equal(outcome.reservation.reservationId, 222);
    assert.equal(bookCalls, 2, "tried the second candidate after the first race");
  }

  // --- reports 'missed' when no slots appear before the deadline ---
  {
    const clock = fakeClock(1_000_000);
    const client = {
      findSlots: async () => ({ slots: [] }),
      getReservationDetails: async () => ({ bookToken: "x" }),
      book: async () => ({ reservationId: 1 }),
    };
    const outcome = await core.runSnipe({
      record: baseRecord(),
      client,
      clock: { offsetMs: 0, rttMs: 0 },
      venueId: 1,
      deps: { now: clock.now, sleep: clock.sleep },
      config: { pollIntervalMs: 500, jitterMs: 0, maxPollMs: 3_000 },
    });
    assert.equal(outcome.status, "missed");
  }

  // --- reports 'failed' when slots appear but every attempt is taken ---
  {
    const clock = fakeClock(1_000_000);
    const client = {
      findSlots: async () => ({
        slots: [resySlot("2026-08-10 20:00:00", "Dining Room", "cfg-2000")],
      }),
      getReservationDetails: async () => ({ bookToken: "book" }),
      book: async () => {
        const err = new Error("gone");
        err.code = "HTTP_ERROR";
        throw err;
      },
    };
    const outcome = await core.runSnipe({
      record: baseRecord({ bestInWindow: false }),
      client,
      clock: { offsetMs: 0, rttMs: 0 },
      venueId: 1,
      deps: { now: clock.now, sleep: clock.sleep },
      config: { pollIntervalMs: 500, jitterMs: 0, maxPollMs: 2_000 },
    });
    assert.equal(outcome.status, "failed");
    assert.ok(outcome.bookAttempts >= 1);
  }

  // --- re-authenticates once on AUTH_REJECTED, then continues ---
  {
    const clock = fakeClock(1_000_000);
    let reauthed = false;
    let findCalls = 0;
    const client = {
      findSlots: async () => {
        findCalls += 1;
        if (findCalls === 1) {
          const err = new Error("bad token");
          err.code = "AUTH_REJECTED";
          throw err;
        }
        return { slots: [resySlot("2026-08-10 20:00:00", "Dining Room", "cfg-2000")] };
      },
      setAuthToken: () => {},
      authenticate: async () => {
        reauthed = true;
      },
      getReservationDetails: async () => ({ bookToken: "book" }),
      book: async () => ({ reservationId: 333 }),
    };
    const outcome = await core.runSnipe({
      record: baseRecord(),
      client,
      clock: { offsetMs: 0, rttMs: 0 },
      venueId: 1,
      deps: { now: clock.now, sleep: clock.sleep },
      config: { pollIntervalMs: 100, jitterMs: 0, backoffMs: 10, maxPollMs: 5_000 },
    });
    assert.equal(reauthed, true);
    assert.equal(outcome.status, "booked");
    assert.equal(outcome.reservation.reservationId, 333);
  }

  console.log("RSVP sniper-core tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
