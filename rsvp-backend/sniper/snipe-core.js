"use strict";

// Drop-time orchestration for the sniper, kept free of AWS/Resy imports so it
// can be unit-tested with a fake client and a fake clock. The AWS glue in
// index.js wires a real Resy client, DynamoDB persistence, and SNS in.

const ranking = require("../slot-ranking.js");

const DEFAULTS = {
  // Start firing this far before the computed release so the first request
  // lands right at (or a hair before) the open, covering our own send latency.
  preReleaseLeadMs: 250,
  // Cadence of find() calls once we start. Jitter is added so the pattern is
  // not perfectly periodic.
  pollIntervalMs: 200,
  jitterMs: 80,
  // How long after the release to keep trying before giving up.
  maxPollMs: 90_000,
  // Most candidate slots to attempt booking on a single find() result.
  maxAttempts: 4,
  // Brief backoff when Resy rate-limits/blocks mid-drop.
  backoffMs: 750,
};

// Local timestamp (our clock) at which to begin firing so the request arrives
// at Resy right at the release instant. `clock` is the measured offset/RTT vs
// Resy's servers; when null we assume our clock matches theirs.
function computeFireStartMs({ releaseEpochMs, clock, nowMs, preReleaseLeadMs }) {
  const lead = preReleaseLeadMs ?? DEFAULTS.preReleaseLeadMs;
  const offsetMs = clock?.offsetMs || 0;
  const rttMs = clock?.rttMs || 0;
  // Local time corresponding to the server-side release instant.
  const localAtRelease = releaseEpochMs - offsetMs;
  const sendAt = localAtRelease - rttMs / 2 - lead;
  return { sendAtLocalMs: sendAt, delayMs: Math.max(0, sendAt - nowMs) };
}

// Local deadline after which we stop polling.
function computeDeadlineMs({ releaseEpochMs, clock, maxPollMs }) {
  const offsetMs = clock?.offsetMs || 0;
  const localAtRelease = releaseEpochMs - offsetMs;
  return localAtRelease + (maxPollMs ?? DEFAULTS.maxPollMs);
}

// Rank in-window slots and cap how many we will attempt. When bestInWindow is
// false, only the single best-ranked slot is attempted.
function selectCandidates(slots, options) {
  const ranked = ranking.rankSlots(slots, {
    earliest: options.earliest,
    latest: options.latest,
    seatingPreference: options.seatingPreference,
    targetTime: options.targetTime,
  });
  const limit = options.bestInWindow ? options.maxAttempts || DEFAULTS.maxAttempts : 1;
  return ranked.slice(0, limit);
}

// Run the drop-time booking loop. Returns an outcome describing what happened.
async function runSnipe(params) {
  const {
    record,
    client,
    clock = null,
    venueId,
    paymentMethodId = null,
    deps,
    config = {},
  } = params;

  const now = deps.now;
  const sleep = deps.sleep;
  const log = deps.log || (() => {});

  const cfg = { ...DEFAULTS, ...config };
  const day = record.diningDate;
  const partySize = record.partySize;
  const selectOptions = {
    earliest: record.window?.earliest,
    latest: record.window?.latest,
    seatingPreference: record.seatingPreference,
    bestInWindow: record.bestInWindow !== false,
    maxAttempts: cfg.maxAttempts,
  };

  // Wait until the exact firing moment (accounting for clock offset + RTT).
  const { delayMs } = computeFireStartMs({
    releaseEpochMs: record.releaseEpochMs,
    clock,
    nowMs: now(),
    preReleaseLeadMs: cfg.preReleaseLeadMs,
  });
  if (delayMs > 0) {
    log("waiting to fire", { delayMs });
    await sleep(delayMs);
  }

  const deadlineMs = computeDeadlineMs({
    releaseEpochMs: record.releaseEpochMs,
    clock,
    maxPollMs: cfg.maxPollMs,
  });

  let findCalls = 0;
  let bookAttempts = 0;
  let sawSlots = false;
  let lastError = null;

  while (now() < deadlineMs) {
    findCalls += 1;
    let found;
    try {
      found = await client.findSlots({ venueId, day, partySize });
    } catch (err) {
      lastError = err;
      log("find error", { code: err?.code, message: err?.message });
      if (err?.code === "AUTH_REJECTED" && typeof client.authenticate === "function") {
        try {
          client.setAuthToken(null);
          await client.authenticate();
        } catch (reauthErr) {
          lastError = reauthErr;
        }
      }
      await sleep(cfg.backoffMs);
      continue;
    }

    const slots = found?.slots || [];
    if (slots.length > 0) {
      sawSlots = true;
      const candidates = selectCandidates(slots, selectOptions);
      for (const candidate of candidates) {
        if (!candidate.token) continue;
        bookAttempts += 1;
        try {
          const details = await client.getReservationDetails({
            configToken: candidate.token,
            day,
            partySize,
          });
          const booking = await client.book({
            bookToken: details.bookToken,
            paymentMethodId,
          });
          log("booked", { reservationId: booking.reservationId, time: candidate.time });
          return {
            status: "booked",
            reservation: booking,
            slot: {
              time: candidate.time,
              seatingType: candidate.seatingType,
              start: candidate.start,
            },
            findCalls,
            bookAttempts,
          };
        } catch (err) {
          lastError = err;
          log("book attempt failed", {
            code: err?.code,
            message: err?.message,
            time: candidate.time,
          });
          // Slot lost to a race or token expired: try the next candidate.
          continue;
        }
      }
    }

    // Nothing bookable yet; poll again with jitter.
    const jitter = Math.floor(Math.random() * (cfg.jitterMs + 1));
    await sleep(cfg.pollIntervalMs + jitter);
  }

  if (!sawSlots) {
    return {
      status: "missed",
      findCalls,
      bookAttempts,
      message:
        lastError?.message ||
        "No availability appeared in the time window before the deadline.",
    };
  }
  return {
    status: "failed",
    findCalls,
    bookAttempts,
    message:
      "Availability appeared but every in-window slot was taken before booking completed.",
  };
}

module.exports = {
  DEFAULTS,
  computeFireStartMs,
  computeDeadlineMs,
  selectCandidates,
  runSnipe,
};
