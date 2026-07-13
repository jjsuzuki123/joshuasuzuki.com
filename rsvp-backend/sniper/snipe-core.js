"use strict";

// Drop-time orchestration for the sniper, kept free of AWS/Resy imports so it
// can be unit-tested with a fake client and a fake clock. The AWS glue in
// index.js wires a real Resy client, DynamoDB persistence, and SNS in.

const ranking = require("../slot-ranking.js");

const DEFAULTS = {
  // Start firing this far before the computed release so the first request
  // lands right at (or a hair before) the open, covering our own send latency.
  preReleaseLeadMs: 250,
  jitterMs: 80,
  // Most candidate slots to attempt booking on a single find() result.
  maxAttempts: 4,
  // Brief backoff when Resy rate-limits/blocks mid-drop.
  backoffMs: 750,
  // How many in-window slots to include in a notify alert.
  notifyListLimit: 6,
};

// Per-mode cadence and window. Both are bounded so this is a clean scheduled
// job, not a sustained hammer:
//   - autobook fires a short burst (booking is the risk-bearing action, so we
//     keep the footprint minimal and give up fast if we lose the race);
//   - notify makes read-only availability checks at a calmer cadence over a
//     somewhat longer bounded window, stopping the instant a table appears.
const MODE_DEFAULTS = {
  autobook: { pollIntervalMs: 250, maxPollMs: 6_000 },
  notify: { pollIntervalMs: 500, maxPollMs: 45_000 },
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

// Rank the in-window slots for a notify alert (top N, no capping by attempts).
function listInWindow(slots, options, limit) {
  const ranked = ranking.rankSlots(slots, {
    earliest: options.earliest,
    latest: options.latest,
    seatingPreference: options.seatingPreference,
    targetTime: options.targetTime,
  });
  return ranked.slice(0, limit).map((c) => ({
    time: c.time,
    seatingType: c.seatingType,
    start: c.start,
    token: c.token,
  }));
}

// Run the drop-time loop. In "autobook" mode it books the best in-window slot;
// in "notify" mode it only watches (read-only) and reports the first
// availability so the user can book by hand. Returns an outcome object.
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

  const mode = params.mode === "autobook" ? "autobook" : "notify";
  const now = deps.now;
  const sleep = deps.sleep;
  const log = deps.log || (() => {});

  const cfg = { ...DEFAULTS, ...MODE_DEFAULTS[mode], ...config };
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
    log("waiting to fire", { mode, delayMs });
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

      if (mode === "notify") {
        // Read-only: report availability, book nothing.
        const available = listInWindow(slots, selectOptions, cfg.notifyListLimit);
        if (available.length > 0) {
          log("available", { count: available.length, best: available[0].time });
          return {
            status: "available",
            slots: available.map((s) => ({
              time: s.time,
              seatingType: s.seatingType,
              start: s.start,
            })),
            findCalls,
            bookAttempts: 0,
          };
        }
      } else {
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
    }

    // Nothing actionable yet; poll again with jitter.
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
  if (mode === "notify") {
    // Saw slots but none inside the requested window.
    return {
      status: "missed",
      findCalls,
      bookAttempts,
      message: "Tables opened but none fell inside your time window.",
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
  MODE_DEFAULTS,
  computeFireStartMs,
  computeDeadlineMs,
  selectCandidates,
  listInWindow,
  runSnipe,
};
