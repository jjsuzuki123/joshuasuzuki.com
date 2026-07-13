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

// A client whose booking methods must never be called (for notify-mode tests).
function readOnlyClient(findImpl) {
  return {
    findSlots: findImpl,
    getReservationDetails: async () => {
      throw new Error("notify mode must not call details");
    },
    book: async () => {
      throw new Error("notify mode must not book");
    },
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
    assert.equal(sendAtLocalMs, 995_000 - 50 - 250);
    assert.equal(delayMs, sendAtLocalMs - 900_000);
  }
  {
    const { delayMs } = core.computeFireStartMs({
      releaseEpochMs: 1_000_000,
      clock: null,
      nowMs: 2_000_000,
      preReleaseLeadMs: 250,
    });
    assert.equal(delayMs, 0);
  }

  // --- lean-burst defaults: autobook window is short, notify is bounded ---
  assert.ok(core.MODE_DEFAULTS.autobook.maxPollMs <= 10_000, "autobook is a short burst");
  assert.ok(core.MODE_DEFAULTS.notify.maxPollMs <= 120_000, "notify is bounded");
  assert.ok(
    core.MODE_DEFAULTS.notify.pollIntervalMs >= core.MODE_DEFAULTS.autobook.pollIntervalMs,
    "notify polls no faster than autobook"
  );

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
    assert.equal(many.length, 2);
    const one = core.selectCandidates(slots, {
      earliest: "19:00",
      latest: "21:00",
      bestInWindow: false,
      maxAttempts: 4,
    });
    assert.equal(one.length, 1);
  }

  // ==================== autobook mode ====================

  // --- books the best in-window slot on the first find that returns slots ---
  {
    const clock = fakeClock(999_000);
    let findCalls = 0;
    const client = {
      findSlots: async () => {
        findCalls += 1;
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
      mode: "autobook",
      clock: { offsetMs: 0, rttMs: 0 },
      venueId: 494,
      paymentMethodId: 55,
      deps: { now: clock.now, sleep: clock.sleep },
      config: { pollIntervalMs: 100, jitterMs: 0, maxPollMs: 90_000 },
    });
    assert.equal(outcome.status, "booked");
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
      mode: "autobook",
      clock: { offsetMs: 0, rttMs: 0 },
      venueId: 1,
      deps: { now: clock.now, sleep: clock.sleep },
      config: { pollIntervalMs: 100, jitterMs: 0, maxPollMs: 5_000 },
    });
    assert.equal(outcome.status, "booked");
    assert.equal(outcome.reservation.reservationId, 222);
    assert.equal(bookCalls, 2);
  }

  // --- 'missed' when no slots appear before the deadline ---
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
      mode: "autobook",
      clock: { offsetMs: 0, rttMs: 0 },
      venueId: 1,
      deps: { now: clock.now, sleep: clock.sleep },
      config: { pollIntervalMs: 500, jitterMs: 0, maxPollMs: 3_000 },
    });
    assert.equal(outcome.status, "missed");
  }

  // --- 'failed' when slots appear but every attempt is taken ---
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
      mode: "autobook",
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
      mode: "autobook",
      clock: { offsetMs: 0, rttMs: 0 },
      venueId: 1,
      deps: { now: clock.now, sleep: clock.sleep },
      config: { pollIntervalMs: 100, jitterMs: 0, backoffMs: 10, maxPollMs: 5_000 },
    });
    assert.equal(reauthed, true);
    assert.equal(outcome.status, "booked");
    assert.equal(outcome.reservation.reservationId, 333);
  }

  // ==================== notify mode ====================

  // --- default mode is notify: reports availability, books nothing ---
  {
    const clock = fakeClock(999_000);
    let findCalls = 0;
    const client = readOnlyClient(async () => {
      findCalls += 1;
      if (findCalls < 2) return { slots: [] };
      return {
        slots: [
          resySlot("2026-08-10 19:30:00", "Dining Room", "cfg-1930"),
          resySlot("2026-08-10 20:00:00", "Bar", "cfg-2000-bar"),
          resySlot("2026-08-10 23:00:00", "Dining Room", "cfg-2300"),
        ],
      };
    });
    const outcome = await core.runSnipe({
      record: baseRecord(),
      client,
      // no mode passed -> defaults to notify
      clock: { offsetMs: 0, rttMs: 0 },
      venueId: 1,
      deps: { now: clock.now, sleep: clock.sleep },
      config: { pollIntervalMs: 100, jitterMs: 0, maxPollMs: 30_000 },
    });
    assert.equal(outcome.status, "available");
    assert.equal(outcome.bookAttempts, 0);
    // Only in-window slots, ranked by proximity to the 20:00 window midpoint
    // (20:00 is dead-center, so it leads; 19:30 follows). No seating pref set.
    const times = outcome.slots.map((s) => s.time);
    assert.deepEqual(times, ["20:00", "19:30"]);
    assert.ok(!times.includes("23:00"), "out-of-window slot excluded");
  }

  // --- notify: 'missed' when tables open but none land in the window ---
  {
    const clock = fakeClock(1_000_000);
    const client = readOnlyClient(async () => ({
      slots: [resySlot("2026-08-10 22:30:00", "Dining Room", "cfg-2230")],
    }));
    const outcome = await core.runSnipe({
      record: baseRecord(),
      client,
      mode: "notify",
      clock: { offsetMs: 0, rttMs: 0 },
      venueId: 1,
      deps: { now: clock.now, sleep: clock.sleep },
      config: { pollIntervalMs: 500, jitterMs: 0, maxPollMs: 2_000 },
    });
    assert.equal(outcome.status, "missed");
    assert.match(outcome.message, /window/i);
  }

  // --- notify: 'missed' when no availability appears at all ---
  {
    const clock = fakeClock(1_000_000);
    const client = readOnlyClient(async () => ({ slots: [] }));
    const outcome = await core.runSnipe({
      record: baseRecord(),
      client,
      mode: "notify",
      clock: { offsetMs: 0, rttMs: 0 },
      venueId: 1,
      deps: { now: clock.now, sleep: clock.sleep },
      config: { pollIntervalMs: 500, jitterMs: 0, maxPollMs: 2_000 },
    });
    assert.equal(outcome.status, "missed");
  }

  console.log("RSVP sniper-core tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
