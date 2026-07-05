"use strict";

const assert = require("node:assert/strict");
const {
  localTimeToEpoch,
  sampleHourlyAt,
  scoreSunset,
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
    aerosolOpticalDepth: 0.14,
    previousLowCloud: 18,
    weatherCode: 1,
    hoursAhead: 4,
    sampleDistanceMinutes: 15,
    ...overrides,
  });
}

const ideal = score();
assert.ok(ideal.score >= 85, `ideal setup scored ${ideal.score}`);
assert.equal(ideal.rating.label, "Exceptional");

const lowOvercast = score({ lowCloud: 96, previousLowCloud: 92 });
assert.ok(lowOvercast.score <= 42, `low overcast scored ${lowOvercast.score}`);
assert.match(lowOvercast.summary, /low cloud deck/i);

const thunderstorm = score({
  weatherCode: 96,
  precipitationProbability: 85,
});
assert.ok(thunderstorm.score <= 30, `thunderstorm scored ${thunderstorm.score}`);
assert.match(thunderstorm.summary, /thunderstorm/i);

const clear = score({
  lowCloud: 0,
  midCloud: 0,
  highCloud: 0,
});
assert.ok(clear.score < ideal.score);
assert.match(clear.summary, /too little elevated cloud/i);

const noAerosol = score({ aerosolOpticalDepth: null });
assert.equal(noAerosol.availableWeight, 93);
assert.ok(Number.isFinite(noAerosol.score));

const missingHorizon = score({ lowCloud: null, previousLowCloud: null });
assert.ok(missingHorizon.score < ideal.score);

const drizzle = score({ weatherCode: 55 });
assert.ok(drizzle.score <= 45, `drizzle scored ${drizzle.score}`);

const nearTerm = score({ hoursAhead: 3 });
const daySeven = score({ hoursAhead: 160 });
assert.ok(nearTerm.confidence.value > daySeven.confidence.value);
assert.equal(daySeven.confidence.label, "Moderate");

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

console.log("Sunset scoring engine tests passed.");
