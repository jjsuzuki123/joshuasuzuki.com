(function initSlotRanking(root, factory) {
  "use strict";

  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.RsvpSlotRanking = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSlotRanking() {
  "use strict";

  const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

  function minutesFromTime(value) {
    const match = TIME_PATTERN.exec(String(value || "").trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  }

  // Resy slot start looks like "2026-08-10 19:30:00"; pull the wall-clock time.
  function minutesFromSlotStart(start) {
    const text = String(start || "").trim();
    const timePart = text.includes("T") ? text.split("T")[1] : text.split(" ")[1];
    if (!timePart) {
      // A bare "HH:MM" is also accepted.
      return minutesFromTime(text);
    }
    const [hourStr, minuteStr] = timePart.split(":");
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  }

  function formatMinutes(minutes) {
    if (!Number.isFinite(minutes)) return null;
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function normalizeSeating(value) {
    return String(value || "").trim().toLowerCase();
  }

  // Extract the fields we rank on from a raw Resy slot, tolerating shape drift.
  function normalizeSlot(rawSlot) {
    if (!rawSlot || typeof rawSlot !== "object") return null;
    const start =
      rawSlot?.date?.start ||
      rawSlot?.start ||
      rawSlot?.time ||
      null;
    const minutesOfDay = minutesFromSlotStart(start);
    if (minutesOfDay === null) return null;

    const seatingType =
      rawSlot?.config?.type ||
      rawSlot?.type ||
      rawSlot?.seatingType ||
      "";
    const token =
      rawSlot?.config?.token ||
      rawSlot?.token ||
      null;

    return {
      start,
      minutesOfDay,
      time: formatMinutes(minutesOfDay),
      seatingType,
      token,
      raw: rawSlot,
    };
  }

  // Rank in-window slots best-first. Preference order:
  //   1. matches the requested seating type (when one is given)
  //   2. closest to the window midpoint (or an explicit targetTime)
  //   3. earlier time as a stable tiebreak
  function rankSlots(slots, options) {
    const opts = options || {};
    const earliest = minutesFromTime(opts.earliest);
    const latest = minutesFromTime(opts.latest);
    if (earliest === null || latest === null || earliest > latest) {
      return [];
    }

    const target =
      minutesFromTime(opts.targetTime) ?? Math.round((earliest + latest) / 2);
    const preferred = opts.seatingPreference
      ? normalizeSeating(opts.seatingPreference)
      : null;

    const candidates = [];
    for (const rawSlot of Array.isArray(slots) ? slots : []) {
      const slot = normalizeSlot(rawSlot);
      if (!slot) continue;
      if (slot.minutesOfDay < earliest || slot.minutesOfDay > latest) continue;

      const seatingMatch = preferred
        ? normalizeSeating(slot.seatingType) === preferred
        : false;
      candidates.push({
        ...slot,
        seatingMatch,
        distance: Math.abs(slot.minutesOfDay - target),
      });
    }

    candidates.sort((a, b) => {
      if (preferred && a.seatingMatch !== b.seatingMatch) {
        return a.seatingMatch ? -1 : 1;
      }
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.minutesOfDay - b.minutesOfDay;
    });

    return candidates;
  }

  function bestSlot(slots, options) {
    const ranked = rankSlots(slots, options);
    return ranked.length > 0 ? ranked[0] : null;
  }

  return {
    minutesFromTime,
    minutesFromSlotStart,
    formatMinutes,
    normalizeSlot,
    rankSlots,
    bestSlot,
  };
});
