"use strict";

const assert = require("node:assert/strict");
const {
  MODEL,
  buildSolarCorridor,
  destinationPoint,
  localTimeToEpoch,
  sampleHourlyAt,
  scoreSunset,
  solarAzimuthAtSunset,
  solarDeclinationDegrees,
  zonedLocalTimeToEpoch,
} = require("../sunset/score-engine.js");

function score(overrides = {}) {
  return scoreSunset({
    lowCloud: 8,
    midCloud: 48,
    highCloud: 42,
    visibility: 28000,
    precipitationProbability: 3,
    humidity: 48,
    aerosolOpticalDepth: 0.08,
    previousLowCloud: 18,
    weatherCode: 1,
    hoursAhead: 4,
    sampleDistanceMinutes: 15,
    solarAzimuthDeg: 298,
    corridor: [
      {
        distanceKm: 12,
        lowCloud: 6,
        midCloud: 40,
        highCloud: 45,
        clearanceWeight: 0.38,
        canvasWeight: 0.12,
      },
      {
        distanceKm: 35,
        lowCloud: 10,
        midCloud: 44,
        highCloud: 50,
        clearanceWeight: 0.3,
        canvasWeight: 0.22,
      },
      {
        distanceKm: 75,
        lowCloud: 12,
        midCloud: 38,
        highCloud: 55,
        clearanceWeight: 0.2,
        canvasWeight: 0.3,
      },
      {
        distanceKm: 130,
        lowCloud: 8,
        midCloud: 35,
        highCloud: 60,
        clearanceWeight: 0.12,
        canvasWeight: 0.36,
      },
    ],
    ...overrides,
  });
}

assert.equal(MODEL.id, "SCRP");
assert.equal(MODEL.version, "3.1.0");

// --- Solar geometry ---
const sfSummerAzimuth = solarAzimuthAtSunset(37.7749, "2026-07-15T20:30");
assert.ok(
  sfSummerAzimuth > 290 && sfSummerAzimuth < 305,
  `SF midsummer sunset azimuth was ${sfSummerAzimuth}`
);

const sfWinterAzimuth = solarAzimuthAtSunset(37.7749, "2026-01-15T17:10");
assert.ok(
  sfWinterAzimuth > 235 && sfWinterAzimuth < 255,
  `SF midwinter sunset azimuth was ${sfWinterAzimuth}`
);

const equinoxAzimuth = solarAzimuthAtSunset(37.7749, "2026-03-20T19:20");
assert.ok(
  Math.abs(equinoxAzimuth - 270) < 4,
  `Equinox sunset azimuth was ${equinoxAzimuth}`
);

assert.ok(Math.abs(solarDeclinationDegrees(172) - 23.4) < 0.5);
assert.ok(Math.abs(solarDeclinationDegrees(355) + 23.4) < 1.5);

// --- Geodesy ---
const westPoint = destinationPoint(37.7749, -122.4194, 270, 100);
assert.ok(westPoint.longitude < -122.4194);
assert.ok(Math.abs(westPoint.latitude - 37.7749) < 0.2);

const corridor = buildSolarCorridor(37.7749, -122.4194, 298);
assert.equal(corridor.length, 4);
assert.equal(corridor[0].distanceKm, 12);
assert.equal(corridor[3].distanceKm, 130);
assert.ok(corridor[3].longitude < corridor[0].longitude);

// --- Ideal geometry ---
const ideal = score();
assert.ok(ideal.score >= 85, `ideal setup scored ${ideal.score}`);
assert.equal(ideal.rating.label, "Exceptional");
assert.equal(ideal.model.id, "SCRP");
assert.ok(ideal.physics.geometric > 0.7);
assert.ok(ideal.physics.corridorSampleCount === 4);
assert.match(ideal.physics.equation, /G\^α/);

// --- Clear sky: residual Rayleigh glow only ---
const clear = score({
  lowCloud: 0,
  midCloud: 0,
  highCloud: 0,
  previousLowCloud: 0,
  corridor: [
    { distanceKm: 12, lowCloud: 0, midCloud: 0, highCloud: 0 },
    { distanceKm: 35, lowCloud: 0, midCloud: 0, highCloud: 0 },
    { distanceKm: 75, lowCloud: 0, midCloud: 0, highCloud: 0 },
    { distanceKm: 130, lowCloud: 0, midCloud: 0, highCloud: 0 },
  ],
});
assert.ok(clear.score <= 50, `clear sky scored ${clear.score}`);
assert.ok(clear.score >= 20, `clear sky too crushed at ${clear.score}`);
assert.match(clear.summary, /elevated cloud/i);

// --- Blocked corridor despite pretty local mid/high ---
const blocked = score({
  lowCloud: 18,
  midCloud: 50,
  highCloud: 55,
  corridor: [
    { distanceKm: 12, lowCloud: 85, midCloud: 40, highCloud: 40 },
    { distanceKm: 35, lowCloud: 80, midCloud: 45, highCloud: 50 },
    { distanceKm: 75, lowCloud: 70, midCloud: 40, highCloud: 45 },
    { distanceKm: 130, lowCloud: 60, midCloud: 35, highCloud: 40 },
  ],
});
assert.ok(blocked.score <= 42, `blocked corridor scored ${blocked.score}`);
assert.ok(blocked.score >= 10, `blocked corridor should not UI-zero (${blocked.score})`);
assert.ok(
  blocked.score < ideal.score - 40,
  "blocked corridor must fall well below ideal"
);

// --- Distant afterglow canvas with empty local sky ---
const distantCanvas = score({
  lowCloud: 5,
  midCloud: 4,
  highCloud: 4,
  previousLowCloud: 8,
  corridor: [
    { distanceKm: 12, lowCloud: 5, midCloud: 10, highCloud: 20 },
    { distanceKm: 35, lowCloud: 8, midCloud: 25, highCloud: 40 },
    {
      distanceKm: 75,
      lowCloud: 10,
      midCloud: 20,
      highCloud: 30,
      afterglowMidCloud: 45,
      afterglowHighCloud: 60,
    },
    {
      distanceKm: 130,
      lowCloud: 12,
      midCloud: 25,
      highCloud: 35,
      afterglowMidCloud: 55,
      afterglowHighCloud: 70,
    },
  ],
});
assert.ok(
  distantCanvas.score >= 70,
  `distant afterglow canvas scored ${distantCanvas.score}`
);
assert.ok(distantCanvas.physics.reflectance > 0.55);

// --- Haze visibility must not stay Exceptional ---
const haze = score({ visibility: 4000 });
assert.ok(haze.score <= 68, `4 km visibility scored ${haze.score}`);

// --- Closing local trend should reduce illumination vs clearing ---
const closing = score({
  lowCloud: 40,
  previousLowCloud: 10,
  corridor: [
    { distanceKm: 12, lowCloud: 20, midCloud: 40, highCloud: 45 },
    { distanceKm: 35, lowCloud: 18, midCloud: 44, highCloud: 50 },
    { distanceKm: 75, lowCloud: 15, midCloud: 38, highCloud: 55 },
    { distanceKm: 130, lowCloud: 12, midCloud: 35, highCloud: 60 },
  ],
});
const clearing = score({
  lowCloud: 18,
  previousLowCloud: 50,
  corridor: [
    { distanceKm: 12, lowCloud: 20, midCloud: 40, highCloud: 45 },
    { distanceKm: 35, lowCloud: 18, midCloud: 44, highCloud: 50 },
    { distanceKm: 75, lowCloud: 15, midCloud: 38, highCloud: 55 },
    { distanceKm: 130, lowCloud: 12, midCloud: 35, highCloud: 60 },
  ],
});
assert.ok(
  clearing.physics.illumination > closing.physics.illumination,
  "clearing horizon should beat closing for illumination"
);

// --- Local-only fallback (no corridor) still runs ---
const localOnly = score({ corridor: [] });
assert.ok(Number.isFinite(localOnly.score));
assert.ok(localOnly.confidence.factors.corridorSampleCount === 0);

// --- Moderate low cloud should not stay Exceptional ---
const moderateLow = score({
  lowCloud: 42,
  previousLowCloud: 40,
  corridor: [
    { distanceKm: 12, lowCloud: 42, midCloud: 45, highCloud: 40 },
    { distanceKm: 35, lowCloud: 40, midCloud: 45, highCloud: 40 },
    { distanceKm: 75, lowCloud: 38, midCloud: 40, highCloud: 42 },
    { distanceKm: 130, lowCloud: 35, midCloud: 38, highCloud: 45 },
  ],
});
assert.ok(
  moderateLow.score <= 72,
  `40% corridor low cloud scored ${moderateLow.score}`
);

// --- Weather gates ---
const thunderstorm = score({
  weatherCode: 96,
  precipitationProbability: 85,
});
assert.ok(thunderstorm.score <= 28, `thunderstorm scored ${thunderstorm.score}`);
assert.match(thunderstorm.summary, /thunderstorm/i);

const fog = score({ weatherCode: 45, visibility: 600, lowCloud: 88 });
assert.ok(fog.score <= 34, `fog scored ${fog.score}`);

const drizzle = score({ weatherCode: 55 });
assert.ok(drizzle.score <= 42, `drizzle scored ${drizzle.score}`);

// --- Atmosphere / AOD ---
const cleanAir = score({ aerosolOpticalDepth: 0.04 });
const smoke = score({ aerosolOpticalDepth: 0.55 });
assert.ok(
  cleanAir.score > smoke.score,
  `clean ${cleanAir.score} should beat smoke ${smoke.score}`
);
assert.ok(smoke.score <= 60, `smoke scored ${smoke.score}`);

const humid = score({ humidity: 88 });
assert.ok(
  humid.score < ideal.score - 5,
  `humidity scored ${humid.score} vs ideal ${ideal.score}`
);

// --- Multiplicative property: zero reflectance collapses geometric potential ---
assert.ok(clear.physics.reflectance < 0.15);
assert.ok(clear.physics.geometric < 0.35);

// --- Confidence: corridor coherence and lead time ---
const nearTerm = score({ hoursAhead: 3 });
const daySeven = score({ hoursAhead: 160 });
assert.ok(nearTerm.confidence.value > daySeven.confidence.value);
assert.equal(daySeven.confidence.label, "Moderate");

const noisyCorridor = score({
  corridor: [
    { distanceKm: 12, lowCloud: 5, midCloud: 40, highCloud: 40 },
    { distanceKm: 35, lowCloud: 90, midCloud: 40, highCloud: 40 },
    { distanceKm: 75, lowCloud: 10, midCloud: 40, highCloud: 40 },
    { distanceKm: 130, lowCloud: 85, midCloud: 40, highCloud: 40 },
  ],
});
assert.ok(
  noisyCorridor.confidence.factors.spatialCoherence <
    ideal.confidence.factors.spatialCoherence,
  "spatial disagreement should lower spatial coherence"
);
assert.ok(
  noisyCorridor.confidence.value <= ideal.confidence.value,
  "spatial disagreement should not raise confidence"
);

// --- Missing aerosol renormalizes diagnostic weight ---
const noAerosol = score({ aerosolOpticalDepth: null });
assert.equal(noAerosol.availableWeight, 97);
assert.ok(Number.isFinite(noAerosol.score));

// --- Interpolation helpers ---
const sample = sampleHourlyAt(
  {
    time: ["2026-07-05T18:00", "2026-07-05T19:00"],
    cloud_cover_low: [20, 60],
    precipitation_probability: [10, 70],
    weather_code: [1, 3],
  },
  "2026-07-05T18:30",
  ["cloud_cover_low", "precipitation_probability", "weather_code"]
);
assert.equal(sample.cloud_cover_low, 40);
assert.equal(sample.precipitation_probability, 70);
assert.equal(sample.weather_code, 3);
assert.equal(sample.sampleDistanceMinutes, 30);

assert.equal(
  sampleHourlyAt(
    { time: ["2026-07-05T18:00"], aerosol_optical_depth: [0.14] },
    "2026-07-06T18:00",
    ["aerosol_optical_depth"]
  ),
  null
);

assert.equal(
  localTimeToEpoch("2026-07-05T20:30", -7 * 60 * 60),
  Date.parse("2026-07-06T03:30:00Z")
);

assert.equal(
  zonedLocalTimeToEpoch(
    "2026-11-01T17:00",
    "America/Los_Angeles",
    -7 * 60 * 60
  ),
  Date.parse("2026-11-02T01:00:00Z")
);

// --- Polar / invalid azimuth ---
assert.equal(solarAzimuthAtSunset(89.5, "2026-06-21T00:00"), null);

console.log("SCRP v3 scoring engine tests passed.");
