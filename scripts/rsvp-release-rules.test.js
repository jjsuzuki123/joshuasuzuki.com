"use strict";

const assert = require("node:assert/strict");

const rules = require("../rsvp-backend/release-rules.js");

// Helper: what wall-clock time (America/New_York) does an epoch represent?
function nyParts(epochMs) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter
      .formatToParts(new Date(epochMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

function run() {
  // --- parseDate / parseTime ---
  assert.equal(rules.parseDate("2026-08-10").day, 10);
  assert.equal(rules.parseDate("2026-13-01"), null, "rejects bad month");
  assert.equal(rules.parseDate("2026-02-30"), null, "rejects impossible day");
  assert.equal(rules.parseDate("not-a-date"), null);
  assert.deepEqual(rules.parseTime("9:05"), { hour: 9, minute: 5 });
  assert.equal(rules.parseTime("24:00"), null);
  assert.equal(rules.parseTime("10:60"), null);

  // --- addCalendarDays across a DST boundary (spring forward 2026-03-08) ---
  assert.equal(rules.addCalendarDays("2026-03-07", 2), "2026-03-09");
  assert.equal(rules.addCalendarDays("2026-03-31", -1), "2026-03-30");
  assert.equal(rules.addCalendarDays("2026-01-01", -1), "2025-12-31");

  // --- weekday helpers ---
  assert.equal(rules.weekdayOf("2026-08-10"), 1, "2026-08-10 is a Monday");
  assert.equal(rules.normalizeWeekday("Saturday"), 6);
  assert.equal(rules.normalizeWeekday(6), 6);
  assert.equal(rules.normalizeWeekday("noneday"), null);
  // First Saturday on/after a Monday is 5 days later.
  assert.equal(rules.firstWeekdayOnOrAfter("2026-08-10", "saturday"), "2026-08-15");
  // If the date already is the weekday, it returns the same date.
  assert.equal(rules.firstWeekdayOnOrAfter("2026-08-15", "saturday"), "2026-08-15");

  // --- daily rule: 30 days out at 10:00 ET ---
  const daily = rules.computeReleaseInstant(
    { type: "daily", daysOut: 30, time: "10:00", tz: "America/New_York" },
    "2026-08-10"
  );
  assert.equal(daily.wallClock.dateISO, "2026-07-11");
  assert.equal(daily.wallClock.time, "10:00");
  const dailyNy = nyParts(daily.epochMs);
  assert.equal(dailyNy.hour, "10");
  assert.equal(dailyNy.minute, "00");
  assert.equal(dailyNy.month, "07");
  assert.equal(dailyNy.day, "11");
  // July is EDT (UTC-4), so 10:00 ET === 14:00 UTC.
  assert.equal(daily.iso, "2026-07-11T14:00:00.000Z");

  // --- daily rule whose drop lands in EST (winter, UTC-5) ---
  const winter = rules.computeReleaseInstant(
    { type: "daily", daysOut: 10, time: "10:00", tz: "America/New_York" },
    "2026-01-20"
  );
  assert.equal(winter.wallClock.dateISO, "2026-01-10");
  // January is EST (UTC-5), so 10:00 ET === 15:00 UTC. Proves DST-correctness.
  assert.equal(winter.iso, "2026-01-10T15:00:00.000Z");

  // --- daily rule whose drop crosses the spring-forward day ---
  // Dining 2026-03-10, 2 days out => drop 2026-03-08 (spring forward) at 10:00.
  const springDrop = rules.computeReleaseInstant(
    { type: "daily", daysOut: 2, time: "10:00", tz: "America/New_York" },
    "2026-03-10"
  );
  assert.equal(springDrop.wallClock.dateISO, "2026-03-08");
  // After spring-forward, 10:00 is already EDT (UTC-4) => 14:00 UTC.
  assert.equal(springDrop.iso, "2026-03-08T14:00:00.000Z");

  // --- weekly rule: Balthazar-style Saturday midnight drop ---
  const weekly = rules.computeReleaseInstant(
    {
      type: "weekly",
      weekday: "saturday",
      daysOut: 30,
      time: "00:00",
      tz: "America/New_York",
    },
    "2026-08-10"
  );
  // earliest = 2026-07-11 (a Saturday) so the drop is that same day at midnight.
  assert.equal(rules.weekdayOf("2026-07-11"), 6);
  assert.equal(weekly.wallClock.dateISO, "2026-07-11");
  assert.equal(weekly.wallClock.time, "00:00");
  assert.equal(weekly.iso, "2026-07-11T04:00:00.000Z");

  // --- monthly rule: EMP-style 1st-of-previous-month at 10:00 ---
  const monthly = rules.computeReleaseInstant(
    {
      type: "monthly",
      monthsBefore: 1,
      dayOfMonth: 1,
      time: "10:00",
      tz: "America/New_York",
    },
    "2026-08-10"
  );
  assert.equal(monthly.wallClock.dateISO, "2026-07-01");
  assert.equal(monthly.iso, "2026-07-01T14:00:00.000Z");

  // Monthly across a year boundary: dining Jan 2027 => opens Dec 1, 2026.
  const monthlyYear = rules.computeReleaseInstant(
    { type: "monthly", monthsBefore: 1, dayOfMonth: 1, time: "10:00" },
    "2027-01-15"
  );
  assert.equal(monthlyYear.wallClock.dateISO, "2026-12-01");

  // dayOfMonth clamps to a short month (Feb).
  const monthlyClamp = rules.computeReleaseInstant(
    { type: "monthly", monthsBefore: 0, dayOfMonth: 31, time: "10:00" },
    "2026-02-15"
  );
  assert.equal(monthlyClamp.wallClock.dateISO, "2026-02-28");

  // --- manual rule ---
  const manual = rules.computeReleaseInstant(
    { type: "manual", releaseDate: "2026-07-01", time: "09:30" },
    "2026-08-10"
  );
  assert.equal(manual.wallClock.dateISO, "2026-07-01");
  assert.equal(manual.wallClock.time, "09:30");

  // --- default time is 10:00 when omitted ---
  const defaulted = rules.computeReleaseInstant(
    { type: "daily", daysOut: 1 },
    "2026-08-10"
  );
  assert.equal(defaulted.wallClock.time, "10:00");

  // --- invalid inputs return null (caller must override) ---
  assert.equal(rules.computeReleaseInstant(null, "2026-08-10"), null);
  assert.equal(rules.computeReleaseInstant({ type: "daily" }, "2026-08-10"), null);
  assert.equal(
    rules.computeReleaseInstant({ type: "daily", daysOut: 5 }, "bad-date"),
    null
  );
  assert.equal(
    rules.computeReleaseInstant({ type: "mystery" }, "2026-08-10"),
    null
  );

  console.log("RSVP release-rules tests passed.");
}

run();
