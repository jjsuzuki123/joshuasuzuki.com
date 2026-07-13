"use strict";

const assert = require("node:assert/strict");

const ranking = require("../rsvp-backend/slot-ranking.js");

function resySlot(start, type, token) {
  return { date: { start }, config: { type, token } };
}

function run() {
  // --- time parsing helpers ---
  assert.equal(ranking.minutesFromTime("19:30"), 19 * 60 + 30);
  assert.equal(ranking.minutesFromTime("7:05"), 7 * 60 + 5);
  assert.equal(ranking.minutesFromTime("24:00"), null);
  assert.equal(ranking.minutesFromSlotStart("2026-08-10 19:30:00"), 19 * 60 + 30);
  assert.equal(ranking.minutesFromSlotStart("2026-08-10T20:00:00"), 20 * 60);
  assert.equal(ranking.formatMinutes(19 * 60 + 30), "19:30");

  // --- normalizeSlot tolerates the Resy shape and flatter shapes ---
  const normalized = ranking.normalizeSlot(
    resySlot("2026-08-10 18:00:00", "Dining Room", "tok-1")
  );
  assert.equal(normalized.time, "18:00");
  assert.equal(normalized.seatingType, "Dining Room");
  assert.equal(normalized.token, "tok-1");

  const slots = [
    resySlot("2026-08-10 17:30:00", "Dining Room", "t-1730"),
    resySlot("2026-08-10 19:00:00", "Bar", "t-1900-bar"),
    resySlot("2026-08-10 19:00:00", "Dining Room", "t-1900-dr"),
    resySlot("2026-08-10 20:00:00", "Dining Room", "t-2000"),
    resySlot("2026-08-10 21:30:00", "Dining Room", "t-2130"),
  ];

  // Window 18:00-21:00, midpoint 19:30. Out-of-window slots dropped.
  const ranked = ranking.rankSlots(slots, {
    earliest: "18:00",
    latest: "21:00",
  });
  const tokens = ranked.map((slot) => slot.token);
  assert.ok(!tokens.includes("t-1730"), "17:30 is before the window");
  assert.ok(!tokens.includes("t-2130"), "21:30 is after the window");
  // 19:00 and 20:00 are both 30 min from the 19:30 midpoint; tie breaks to
  // the earlier time, and the 19:00 pair sorts by insertion order (bar first).
  assert.equal(ranked[0].minutesOfDay, 19 * 60);
  assert.equal(ranked[ranked.length - 1].token, "t-2000");

  // --- seating preference wins over distance ---
  const rankedPref = ranking.rankSlots(slots, {
    earliest: "18:00",
    latest: "21:00",
    seatingPreference: "Bar",
  });
  assert.equal(rankedPref[0].token, "t-1900-bar", "bar preference floats up");
  assert.equal(rankedPref[0].seatingMatch, true);

  // --- explicit targetTime overrides the midpoint ---
  const rankedTarget = ranking.rankSlots(slots, {
    earliest: "18:00",
    latest: "21:00",
    targetTime: "20:00",
  });
  assert.equal(rankedTarget[0].token, "t-2000");

  // --- bestSlot convenience ---
  const best = ranking.bestSlot(slots, { earliest: "18:00", latest: "21:00" });
  assert.equal(best.minutesOfDay, 19 * 60);

  // --- empty / invalid handling ---
  assert.deepEqual(ranking.rankSlots([], { earliest: "18:00", latest: "21:00" }), []);
  assert.deepEqual(
    ranking.rankSlots(slots, { earliest: "21:00", latest: "18:00" }),
    [],
    "inverted window yields nothing"
  );
  assert.equal(ranking.bestSlot(slots, { earliest: "05:00", latest: "05:30" }), null);

  console.log("RSVP slot-ranking tests passed.");
}

run();
