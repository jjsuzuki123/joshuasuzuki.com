(function initReleaseRules(root, factory) {
  "use strict";

  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.RsvpReleaseRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createReleaseRules() {
  "use strict";

  const DEFAULT_TZ = "America/New_York";
  const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const WEEKDAYS = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  function parseDate(dateISO) {
    const match = DATE_PATTERN.exec(String(dateISO || "").trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    // Round-trip through UTC to reject impossible dates like 2026-02-30.
    const utc = Date.UTC(year, month - 1, day);
    const back = new Date(utc);
    if (
      back.getUTCFullYear() !== year ||
      back.getUTCMonth() !== month - 1 ||
      back.getUTCDate() !== day
    ) {
      return null;
    }
    return { year, month, day, utc };
  }

  function parseTime(time) {
    const match = TIME_PATTERN.exec(String(time || "").trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
  }

  function pad(value, length) {
    return String(value).padStart(length, "0");
  }

  function formatDate(year, month, day) {
    return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  }

  function normalizeWeekday(weekday) {
    if (typeof weekday === "number" && Number.isInteger(weekday)) {
      return weekday >= 0 && weekday <= 6 ? weekday : null;
    }
    const index = WEEKDAYS.indexOf(String(weekday || "").trim().toLowerCase());
    return index === -1 ? null : index;
  }

  // Calendar-day math is done in UTC on a date-only value so it never drifts
  // across daylight-saving transitions; the wall-clock time is applied later.
  function addCalendarDays(dateISO, deltaDays) {
    const parsed = parseDate(dateISO);
    if (!parsed) return null;
    const shifted = new Date(parsed.utc + Math.trunc(deltaDays) * DAY_MS);
    return formatDate(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate()
    );
  }

  function weekdayOf(dateISO) {
    const parsed = parseDate(dateISO);
    if (!parsed) return null;
    return new Date(parsed.utc).getUTCDay();
  }

  function firstWeekdayOnOrAfter(dateISO, weekday) {
    const target = normalizeWeekday(weekday);
    const start = weekdayOf(dateISO);
    if (target === null || start === null) return null;
    const delta = (target - start + 7) % 7;
    return addCalendarDays(dateISO, delta);
  }

  // Move to the first day of the dining month, step back whole months, then
  // clamp the requested day-of-month to the target month's length.
  function shiftMonths(dateISO, deltaMonths, dayOfMonth) {
    const parsed = parseDate(dateISO);
    if (!parsed) return null;
    const totalMonths = parsed.year * 12 + (parsed.month - 1) - Math.trunc(deltaMonths);
    const targetYear = Math.floor(totalMonths / 12);
    const targetMonth = (totalMonths % 12 + 12) % 12; // 0-based
    const daysInMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const day = Math.min(Math.max(Math.trunc(dayOfMonth) || 1, 1), daysInMonth);
    return formatDate(targetYear, targetMonth + 1, day);
  }

  // Convert a wall-clock instant in a named IANA zone to an epoch (ms), correct
  // across DST. Mirrors the iterative approach used in sunset/score-engine.js.
  function zonedWallClockToEpoch(dateISO, time, timeZone) {
    const parsed = parseDate(dateISO);
    const parsedTime = parseTime(time);
    if (!parsed || !parsedTime) return null;

    const targetKey = Date.UTC(
      parsed.year,
      parsed.month - 1,
      parsed.day,
      parsedTime.hour,
      parsedTime.minute,
      0
    );

    const zone = timeZone || DEFAULT_TZ;
    if (typeof Intl === "undefined") {
      return targetKey; // Best effort when Intl is unavailable.
    }

    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });

      let guess = targetKey;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const parts = Object.fromEntries(
          formatter
            .formatToParts(new Date(guess))
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, Number(part.value)])
        );
        const represented = Date.UTC(
          parts.year,
          parts.month - 1,
          parts.day,
          parts.hour,
          parts.minute,
          parts.second
        );
        const correction = targetKey - represented;
        guess += correction;
        if (Math.abs(correction) < 1000) break;
      }
      return guess;
    } catch (error) {
      return targetKey;
    }
  }

  function releaseDate(rule, diningDateISO) {
    switch (rule.type) {
      case "daily": {
        const daysOut = Number(rule.daysOut);
        if (!Number.isFinite(daysOut) || daysOut < 0) return null;
        return addCalendarDays(diningDateISO, -daysOut);
      }
      case "weekly": {
        const daysOut = Number(rule.daysOut);
        const weekday = normalizeWeekday(rule.weekday);
        if (!Number.isFinite(daysOut) || daysOut < 0 || weekday === null) {
          return null;
        }
        // The batch that first reaches the dining date opens on the earliest
        // qualifying weekday that is no earlier than (diningDate - daysOut).
        const earliest = addCalendarDays(diningDateISO, -daysOut);
        return firstWeekdayOnOrAfter(earliest, weekday);
      }
      case "monthly": {
        const monthsBefore = Number(rule.monthsBefore);
        const dayOfMonth = Number(rule.dayOfMonth);
        if (!Number.isFinite(monthsBefore) || monthsBefore < 0) return null;
        if (!Number.isFinite(dayOfMonth) || dayOfMonth < 1) return null;
        return shiftMonths(diningDateISO, monthsBefore, dayOfMonth);
      }
      case "manual": {
        return parseDate(rule.releaseDate) ? rule.releaseDate : null;
      }
      default:
        return null;
    }
  }

  function describe(rule, dropDateISO, time, tz) {
    switch (rule.type) {
      case "daily":
        return `Opens ${rule.daysOut} days ahead at ${time} ${tz} (on ${dropDateISO}).`;
      case "weekly":
        return `Opens on ${WEEKDAYS[normalizeWeekday(rule.weekday)]}s at ${time} ${tz} (${rule.daysOut} days ahead, on ${dropDateISO}).`;
      case "monthly":
        return `Opens ${rule.monthsBefore} month(s) ahead on day ${rule.dayOfMonth} at ${time} ${tz} (on ${dropDateISO}).`;
      case "manual":
        return `Opens ${dropDateISO} at ${time} ${tz}.`;
      default:
        return `Opens ${dropDateISO} at ${time} ${tz}.`;
    }
  }

  // Compute the exact release instant for a dining date under a release rule.
  // Returns null when inputs are invalid so callers can require an override.
  function computeReleaseInstant(rule, diningDateISO) {
    if (!rule || typeof rule !== "object") return null;
    if (!parseDate(diningDateISO)) return null;

    const time = parseTime(rule.time) ? String(rule.time).trim() : "10:00";
    const tz = rule.tz || DEFAULT_TZ;

    const dropDateISO = releaseDate(rule, diningDateISO);
    if (!dropDateISO) return null;

    const normalizedTime = (() => {
      const t = parseTime(time);
      return `${pad(t.hour, 2)}:${pad(t.minute, 2)}`;
    })();

    const epochMs = zonedWallClockToEpoch(dropDateISO, normalizedTime, tz);
    if (epochMs === null) return null;

    return {
      epochMs,
      iso: new Date(epochMs).toISOString(),
      wallClock: { dateISO: dropDateISO, time: normalizedTime, tz },
      explanation: describe(rule, dropDateISO, normalizedTime, tz),
    };
  }

  return {
    DEFAULT_TZ,
    WEEKDAYS,
    parseDate,
    parseTime,
    normalizeWeekday,
    addCalendarDays,
    weekdayOf,
    firstWeekdayOnOrAfter,
    shiftMonths,
    zonedWallClockToEpoch,
    releaseDate,
    computeReleaseInstant,
  };
});
