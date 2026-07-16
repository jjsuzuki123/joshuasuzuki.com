(function initSunsetScoring(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.SunsetScoring = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSunsetScoring() {
  "use strict";

  /**
   * Afterglow Solar Corridor Radiative Potential (SCRP) v3.0
   *
   * A deterministic, inspectable forecast of sunset color potential from
   * operational weather fields. Grounded in atmospheric optics:
   *
   *   1. Low-angle sunlight must traverse a clear solar corridor
   *      (Corfidi, NOAA/NWS; ray-based models such as Sunsethue).
   *   2. Elevated cloud must present a reflectance canvas once the
   *      surface is in shadow (mid/high cloud preferential).
   *   3. Tropospheric extinction (visibility, humidity, AOD) modulates
   *      saturation via a Beer–Lambert transmittance proxy.
   *
   * Primary index (before meteorological gates):
   *
   *   Q₀ = 100 · G^α · T^β · D^γ
   *
   *   G = I · R                  geometric potential
   *   I ∈ [0,1]                  corridor illumination (low-cloud clearance)
   *   R ∈ [0,1]                  elevated reflectance canvas
   *   T ∈ [0,1]                  atmospheric transmittance
   *   D ∈ [0,1]                  dry-window factor
   *   α=0.72, β=0.20, γ=0.08     calibrated exponents (∑≈1)
   *
   * Component bars exposed in the UI are diagnostic favorability scores,
   * not an additive decomposition of Q. The published score is always the
   * gated multiplicative index above.
   */

  const MODEL = {
    id: "SCRP",
    version: "3.1.0",
    name: "Solar Corridor Radiative Potential",
    alpha: 0.66,
    beta: 0.28,
    gamma: 0.06,
    // Corridor sample distances (km) along the sunset azimuth.
    corridorDistancesKm: [12, 35, 75, 130],
    // Near-field low cloud dominates solar-disk blocking.
    clearanceWeights: [0.38, 0.3, 0.2, 0.12],
    // Distant elevated cloud is preferred for afterglow duration.
    canvasWeights: [0.12, 0.22, 0.3, 0.36],
    earthRadiusKm: 6371.0088,
    refractionSunsetDeg: -0.833,
  };

  // Diagnostic UI components (favorability 0–1). Weights describe
  // relative importance in the narrative, not an additive score split.
  const COMPONENTS = [
    { id: "corridor", label: "Solar corridor", weight: 30 },
    { id: "cloudCanvas", label: "Elevated canvas", weight: 32 },
    { id: "atmosphere", label: "Air clarity", weight: 22 },
    { id: "precipitation", label: "Dry window", weight: 10 },
    { id: "humidity", label: "Humidity", weight: 3 },
    { id: "aerosol", label: "Aerosol load", weight: 3 },
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function mix(start, end, amount) {
    return start + (end - start) * amount;
  }

  function smoothstep(edge0, edge1, value) {
    if (edge0 === edge1) return value < edge0 ? 0 : 1;
    const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return amount * amount * (3 - 2 * amount);
  }

  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function toDegrees(radians) {
    return (radians * 180) / Math.PI;
  }

  function plateauScore(value, lowZero, lowIdeal, highIdeal, highZero) {
    if (value === null) return null;
    if (value <= lowZero || value >= highZero) return 0;
    if (value >= lowIdeal && value <= highIdeal) return 1;
    if (value < lowIdeal) return smoothstep(lowZero, lowIdeal, value);
    return 1 - smoothstep(highIdeal, highZero, value);
  }

  function mean(values) {
    if (!values.length) return null;
    return values.reduce((total, value) => total + value, 0) / values.length;
  }

  function populationStdev(values) {
    if (values.length < 2) return 0;
    const average = mean(values);
    const variance =
      values.reduce((total, value) => total + (value - average) ** 2, 0) /
      values.length;
    return Math.sqrt(variance);
  }

  function weightedMean(values, weights) {
    let weightSum = 0;
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      const weight = weights[index];
      if (value === null || weight === null || weight <= 0) continue;
      total += value * weight;
      weightSum += weight;
    }
    if (weightSum === 0) return null;
    return total / weightSum;
  }

  /**
   * Approximate solar declination (degrees) for a Gregorian day-of-year.
   * Spencer (1971) / NOAA simplified form; error typically < 0.3°.
   */
  function solarDeclinationDegrees(dayOfYear) {
    return 23.44 * Math.sin(toRadians((360 / 365) * (dayOfYear - 81)));
  }

  function dayOfYearFromParts(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const start = new Date(Date.UTC(year, 0, 0));
    return Math.round((date - start) / 86400000);
  }

  function parseLocalDateParts(isoLocalTime) {
    if (typeof isoLocalTime !== "string") return null;
    const match = isoLocalTime.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }

  /**
   * True-north azimuth (degrees clockwise) of the geometric setting sun,
   * including standard atmospheric refraction (−0.833° elevation).
   * Western branch of the spherical astronomy solution.
   */
  function solarAzimuthAtSunset(latitudeDeg, isoLocalDateOrDateParts) {
    const latitude = finiteOrNull(latitudeDeg);
    if (latitude === null) return null;

    const parts =
      typeof isoLocalDateOrDateParts === "string"
        ? parseLocalDateParts(isoLocalDateOrDateParts)
        : isoLocalDateOrDateParts;
    if (!parts) return null;

    const dayOfYear = dayOfYearFromParts(parts.year, parts.month, parts.day);
    const declination = solarDeclinationDegrees(dayOfYear);
    const phi = toRadians(latitude);
    const delta = toRadians(declination);
    const elevation = toRadians(MODEL.refractionSunsetDeg);

    const denominator = Math.cos(elevation) * Math.cos(phi);
    if (Math.abs(denominator) < 1e-9) return null;

    const cosAzimuth =
      (Math.sin(delta) - Math.sin(elevation) * Math.sin(phi)) / denominator;

    if (!Number.isFinite(cosAzimuth)) return null;
    if (cosAzimuth < -1 || cosAzimuth > 1) {
      // Polar day / night — no geometric sunset.
      return null;
    }

    const angleFromNorth = toDegrees(Math.acos(clamp(cosAzimuth, -1, 1)));
    return (360 - angleFromNorth + 360) % 360;
  }

  /**
   * Destination point given start, bearing (deg from north), and distance.
   * Vincenty-equivalent spherical law of cosines on WGS84 mean radius.
   */
  function destinationPoint(latitudeDeg, longitudeDeg, bearingDeg, distanceKm) {
    const lat1 = toRadians(latitudeDeg);
    const lon1 = toRadians(longitudeDeg);
    const bearing = toRadians(bearingDeg);
    const angularDistance = distanceKm / MODEL.earthRadiusKm;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) +
        Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
      );

    return {
      latitude: toDegrees(lat2),
      longitude: ((toDegrees(lon2) + 540) % 360) - 180,
      distanceKm,
      bearingDeg,
    };
  }

  function buildSolarCorridor(latitudeDeg, longitudeDeg, azimuthDeg) {
    const latitude = finiteOrNull(latitudeDeg);
    const longitude = finiteOrNull(longitudeDeg);
    const azimuth = finiteOrNull(azimuthDeg);
    if (latitude === null || longitude === null || azimuth === null) {
      return [];
    }

    return MODEL.corridorDistancesKm.map((distanceKm, index) => {
      const point = destinationPoint(latitude, longitude, azimuth, distanceKm);
      return {
        ...point,
        index,
        clearanceWeight: MODEL.clearanceWeights[index],
        canvasWeight: MODEL.canvasWeights[index],
      };
    });
  }

  function layerFit(midCloud, highCloud) {
    if (midCloud === null && highCloud === null) return null;

    // Literature sweet spots: mid ~15–55%, high ~20–70% (photographer models;
    // Brent Goldman; GoldCast). Near-total sheets rarely color well.
    const midFit =
      midCloud === null ? null : plateauScore(midCloud, 3, 18, 55, 86);
    const highFit =
      highCloud === null ? null : plateauScore(highCloud, 2, 18, 68, 92);
    const available = [midFit, highFit].filter((value) => value !== null);
    if (available.length === 1) return available[0];

    // Prefer the stronger elevated layer; blend so both layers can contribute.
    return Math.max(midFit, highFit) * 0.58 + ((midFit + highFit) / 2) * 0.42;
  }

  function localClearance(lowCloud, previousLowCloud) {
    if (lowCloud === null) return null;
    // Collapse hard past ~40% low cover (horizon-block regime).
    let openSky = 1 - smoothstep(10, 52, lowCloud);
    if (previousLowCloud !== null) {
      const trend = lowCloud - previousLowCloud;
      openSky = clamp(openSky + clamp((-trend / 100) * 0.22, -0.05, 0.05), 0, 1);
    }
    return openSky;
  }

  /**
   * Corridor illumination I: transmittance-like product along the solar path.
   * Corridor geometry dominates. Local low-cloud trend supplies a small
   * clearing/closing adjustment without letting an open local sky revive a
   * sealed down-range corridor.
   */
  function scoreCorridorIllumination(corridorSamples, fallbackLow, previousLow) {
    const local = localClearance(fallbackLow, previousLow);
    let corridor = null;

    if (Array.isArray(corridorSamples) && corridorSamples.length > 0) {
      const clearances = [];
      const weights = [];
      corridorSamples.forEach((sample, index) => {
        const low = finiteOrNull(sample.lowCloud);
        if (low === null) return;
        clearances.push(1 - smoothstep(10, 52, low));
        weights.push(
          finiteOrNull(sample.clearanceWeight) ??
            MODEL.clearanceWeights[
              Math.min(index, MODEL.clearanceWeights.length - 1)
            ]
        );
      });
      corridor = weightedMean(clearances, weights);
    }

    if (corridor === null) return local;

    let illumination = corridor;
    if (fallbackLow !== null && previousLow !== null) {
      const trend = fallbackLow - previousLow;
      illumination = clamp(
        illumination + clamp((-trend / 100) * 0.2, -0.05, 0.05),
        0,
        1
      );
    }
    return illumination;
  }

  /**
   * Elevated reflectance R: blend observer mid/high with corridor mid/high.
   * When the local sky is nearly empty but the corridor holds elevated cloud,
   * prefer the distant canvas — the classic afterglow geometry.
   */
  function scoreElevatedReflectance(localMid, localHigh, corridorSamples) {
    const localFit = layerFit(localMid, localHigh);
    if (!Array.isArray(corridorSamples) || corridorSamples.length === 0) {
      return localFit;
    }

    const distantFits = [];
    const weights = [];
    corridorSamples.forEach((sample, index) => {
      // Prefer afterglow-peak mid/high when provided (sunset + ~20 min).
      const mid =
        finiteOrNull(sample.afterglowMidCloud) ?? finiteOrNull(sample.midCloud);
      const high =
        finiteOrNull(sample.afterglowHighCloud) ??
        finiteOrNull(sample.highCloud);
      const fit = layerFit(mid, high);
      if (fit === null) return;
      distantFits.push(fit);
      weights.push(
        finiteOrNull(sample.canvasWeight) ??
          MODEL.canvasWeights[Math.min(index, MODEL.canvasWeights.length - 1)]
      );
    });

    const corridorFit = weightedMean(distantFits, weights);
    if (localFit === null) return corridorFit;
    if (corridorFit === null) return localFit;

    const localMass =
      (finiteOrNull(localMid) ?? 0) + (finiteOrNull(localHigh) ?? 0);
    // Empty local sky + good distant canvas = classic afterglow. Trust corridor.
    if (localMass < 18 && corridorFit > localFit) {
      return localFit * 0.22 + corridorFit * 0.78;
    }
    if (localMass < 35 && corridorFit > localFit + 0.15) {
      return localFit * 0.38 + corridorFit * 0.62;
    }
    return localFit * 0.52 + corridorFit * 0.48;
  }

  /**
   * Beer–Lambert transmittance proxy from visibility, humidity, and AOD.
   * τ ≈ τ_vis + τ_rh + τ_aod; T = exp(−τ) mapped through a gentle curve so
   * operational forecast noise does not cliff-edge the score.
   */
  function opticalDepthProxy(visibilityM, humidity, aerosolOpticalDepth) {
    const terms = [];

    if (visibilityM !== null) {
      // 30 km ≈ clear reference; sub-5 km → thick extinction.
      const visRatio = clamp(visibilityM / 30000, 0.03, 1);
      terms.push(-Math.log(visRatio) * 0.55);
    }

    if (humidity !== null) {
      // Hygroscopic growth above ~55% RH.
      terms.push(smoothstep(52, 92, humidity) * 0.7);
    }

    if (aerosolOpticalDepth !== null) {
      // CAMS AOD550 as direct optical-depth contribution (PhotoWeather / NOAA).
      terms.push(Math.max(0, aerosolOpticalDepth) * 1.15);
    }

    if (!terms.length) return null;
    return terms.reduce((total, term) => total + term, 0);
  }

  function atmosphericTransmittance(visibilityM, humidity, aerosolOpticalDepth) {
    const tau = opticalDepthProxy(visibilityM, humidity, aerosolOpticalDepth);
    if (tau === null) return null;
    // Closer to true Beer–Lambert; mild lift only for very thick τ so the
    // curve stays differentiable under forecast noise.
    const raw = Math.exp(-clamp(tau, 0, 4));
    return clamp(mix(raw, Math.sqrt(raw), 0.18), 0, 1);
  }

  function scoreAerosolDiagnostic(aerosolOpticalDepth) {
    if (aerosolOpticalDepth === null) return null;
    // Diagnostic only: clean air is best for tropospheric color saturation.
    if (aerosolOpticalDepth <= 0.12) return 1;
    if (aerosolOpticalDepth <= 0.25) {
      return mix(1, 0.7, smoothstep(0.12, 0.25, aerosolOpticalDepth));
    }
    if (aerosolOpticalDepth < 0.5) {
      return mix(0.7, 0.1, smoothstep(0.25, 0.5, aerosolOpticalDepth));
    }
    return mix(0.1, 0, smoothstep(0.5, 0.85, aerosolOpticalDepth));
  }

  function dryWindowFactor(precipitationProbability) {
    if (precipitationProbability === null) return null;
    return 1 - smoothstep(5, 60, precipitationProbability);
  }

  function weatherCodeCap(weatherCode) {
    if (weatherCode === null) return null;
    if (weatherCode >= 95) {
      return { score: 28, reason: "Thunderstorms can block the sunset window." };
    }
    if (weatherCode === 45 || weatherCode === 48) {
      return { score: 34, reason: "Fog is likely to hide the horizon." };
    }
    if (
      (weatherCode >= 51 && weatherCode <= 57) ||
      (weatherCode >= 61 && weatherCode <= 67) ||
      (weatherCode >= 71 && weatherCode <= 77) ||
      (weatherCode >= 80 && weatherCode <= 86)
    ) {
      return { score: 42, reason: "Active precipitation can obscure the color." };
    }
    return null;
  }

  function applyPhysicalGates(score, values, illumination, reflectance) {
    let capped = score;
    let gate = null;

    const weatherCap = weatherCodeCap(values.weatherCode);
    if (weatherCap) {
      capped = Math.min(capped, weatherCap.score);
      gate = weatherCap;
    }

    if (values.visibility !== null && values.visibility < 1500) {
      const visibilityGate = {
        score: 30,
        reason: "Very low visibility is likely to hide both the sun and distant clouds.",
      };
      if (!gate || visibilityGate.score < gate.score) gate = visibilityGate;
      capped = Math.min(capped, visibilityGate.score);
    } else if (values.visibility !== null && values.visibility < 3000) {
      capped = Math.min(capped, 52);
    } else if (values.visibility !== null && values.visibility < 5000) {
      capped = Math.min(capped, 68);
    }

    if (values.lowCloud !== null && values.lowCloud >= 90) {
      const lowGate = {
        score: 38,
        reason: "A nearly solid low cloud deck is likely to block the solar corridor.",
      };
      if (!gate || lowGate.score < gate.score) gate = lowGate;
      capped = Math.min(capped, lowGate.score);
    }

    // Geometric floors: no reflector or no illumination → no vivid color.
    if (reflectance !== null && reflectance < 0.1) {
      capped = Math.min(capped, 46);
    } else if (reflectance !== null && reflectance < 0.25) {
      capped = Math.min(capped, 60);
    } else if (reflectance !== null && reflectance < 0.4) {
      capped = Math.min(capped, 74);
    }

    if (illumination !== null && illumination < 0.08) {
      // Soft floor so a sealed corridor reads Unlikely, not a null UI zero.
      capped = Math.min(Math.max(capped, 10), 42);
    } else if (illumination !== null && illumination < 0.18) {
      capped = Math.min(capped, 50);
    } else if (illumination !== null && illumination < 0.35) {
      capped = Math.min(capped, 66);
    }

    if (values.aerosolOpticalDepth !== null && values.aerosolOpticalDepth >= 0.5) {
      capped = Math.min(capped, 55);
    } else if (
      values.aerosolOpticalDepth !== null &&
      values.aerosolOpticalDepth >= 0.35
    ) {
      capped = Math.min(capped, 70);
    }

    if (values.humidity !== null && values.humidity >= 88) {
      capped = Math.min(capped, 68);
    } else if (values.humidity !== null && values.humidity >= 80) {
      capped = Math.min(capped, 80);
    }

    return { score: Math.round(capped), gate };
  }

  function getRating(score) {
    if (score >= 85) {
      return { label: "Exceptional", shortLabel: "Exceptional", tone: "electric" };
    }
    if (score >= 72) {
      return { label: "Vivid", shortLabel: "Vivid", tone: "bright" };
    }
    if (score >= 58) {
      return { label: "Promising", shortLabel: "Promising", tone: "warm" };
    }
    if (score >= 42) {
      return { label: "Muted", shortLabel: "Muted", tone: "soft" };
    }
    return { label: "Unlikely", shortLabel: "Unlikely", tone: "dim" };
  }

  function getConfidence(input, values, corridorSamples, illumination) {
    const requiredValues = [
      values.lowCloud,
      values.midCloud,
      values.highCloud,
      values.visibility,
      values.precipitationProbability,
      values.humidity,
    ];
    const coverage =
      requiredValues.filter((value) => value !== null).length /
      requiredValues.length;

    const hoursAhead = finiteOrNull(input.hoursAhead);
    const lead =
      hoursAhead === null
        ? 0.72
        : clamp(1 - (Math.max(0, hoursAhead - 6) / 140) * 0.58, 0.42, 1);

    const sampleDistanceMinutes = finiteOrNull(input.sampleDistanceMinutes);
    const alignment =
      sampleDistanceMinutes === null
        ? 0.8
        : clamp(1 - (sampleDistanceMinutes / 60) * 0.22, 0.78, 1);

    let spatial = 0.86;
    if (Array.isArray(corridorSamples) && corridorSamples.length >= 2) {
      const lows = corridorSamples
        .map((sample) => finiteOrNull(sample.lowCloud))
        .filter((value) => value !== null);
      if (lows.length >= 2) {
        // High spatial variance → uncertain cloud field along the corridor.
        spatial = clamp(1 - populationStdev(lows) / 55, 0.55, 1);
      }
    } else {
      spatial = 0.7;
    }

    const aerosolBonus = values.aerosolOpticalDepth === null ? 0 : 0.015;
    const corridorBonus =
      Array.isArray(corridorSamples) && corridorSamples.length >= 3 ? 0.03 : 0;

    const value = Math.round(
      clamp(
        (coverage * 0.34 +
          lead * 0.4 +
          alignment * 0.08 +
          spatial * 0.18 +
          aerosolBonus +
          corridorBonus) *
          100,
        0,
        99
      )
    );

    let label = "Low";
    if (value >= 84) label = "High";
    else if (value >= 62) label = "Moderate";

    return {
      value,
      label,
      factors: {
        coverage: Math.round(coverage * 100),
        leadTime: Math.round(lead * 100),
        temporalAlignment: Math.round(alignment * 100),
        spatialCoherence: Math.round(spatial * 100),
        corridorSampleCount: Array.isArray(corridorSamples)
          ? corridorSamples.length
          : 0,
        illumination:
          illumination === null ? null : Math.round(illumination * 100),
      },
    };
  }

  function buildSummary(score, values, gate, physics) {
    if (gate) return gate.reason;

    if (physics.illumination !== null && physics.illumination < 0.28) {
      return "Low cloud along the solar corridor is likely to cut off the light before color develops.";
    }
    if (physics.reflectance !== null && physics.reflectance < 0.18) {
      return "The corridor looks open, but there may be too little elevated cloud to catch color.";
    }
    if (
      values.precipitationProbability !== null &&
      values.precipitationProbability >= 55
    ) {
      return "A wet sunset window lowers the chance of a clear view.";
    }
    if (values.visibility !== null && values.visibility < 7000) {
      return "Limited visibility may soften the color and hide the horizon.";
    }
    if (values.humidity !== null && values.humidity >= 82) {
      return "High humidity raises the chance of haze that washes out color.";
    }
    if (
      values.aerosolOpticalDepth !== null &&
      values.aerosolOpticalDepth >= 0.35
    ) {
      return "Elevated aerosol load is likely to mute saturation along the line of sight.";
    }
    if (score >= 85) {
      return "An open solar corridor, elevated cloud, and clean air line up for a strong show.";
    }
    if (score >= 72) {
      return "Geometry and atmosphere favor color, with only modest limiting factors.";
    }
    if (score >= 58) {
      return "There is enough radiative potential for color, though one or two inputs are marginal.";
    }
    if (score >= 42) {
      return "Some color is possible, but corridor geometry or extinction works against it.";
    }
    return "The forecast lacks the open corridor and elevated-cloud mix that produces vivid color.";
  }

  function scoreSunset(input) {
    const values = {
      lowCloud: finiteOrNull(input.lowCloud),
      midCloud: finiteOrNull(input.midCloud),
      highCloud: finiteOrNull(input.highCloud),
      visibility: finiteOrNull(input.visibility),
      precipitationProbability: finiteOrNull(input.precipitationProbability),
      humidity: finiteOrNull(input.humidity),
      aerosolOpticalDepth: finiteOrNull(input.aerosolOpticalDepth),
      previousLowCloud: finiteOrNull(input.previousLowCloud),
      weatherCode: finiteOrNull(input.weatherCode),
    };

    const corridorSamples = Array.isArray(input.corridor)
      ? input.corridor
          .map((sample) => ({
            distanceKm: finiteOrNull(sample.distanceKm),
            lowCloud: finiteOrNull(sample.lowCloud),
            midCloud: finiteOrNull(sample.midCloud),
            highCloud: finiteOrNull(sample.highCloud),
            afterglowMidCloud: finiteOrNull(sample.afterglowMidCloud),
            afterglowHighCloud: finiteOrNull(sample.afterglowHighCloud),
            clearanceWeight: finiteOrNull(sample.clearanceWeight),
            canvasWeight: finiteOrNull(sample.canvasWeight),
          }))
          .filter(
            (sample) =>
              sample.lowCloud !== null ||
              sample.midCloud !== null ||
              sample.highCloud !== null ||
              sample.afterglowMidCloud !== null ||
              sample.afterglowHighCloud !== null
          )
      : [];

    let illumination = scoreCorridorIllumination(
      corridorSamples,
      values.lowCloud,
      values.previousLowCloud
    );
    // Fog extinguishes the solar corridor regardless of layered cloud %.
    if (
      values.weatherCode === 45 ||
      values.weatherCode === 48
    ) {
      illumination =
        illumination === null ? 0.12 : Math.min(illumination, 0.12);
    }

    const reflectance = scoreElevatedReflectance(
      values.midCloud,
      values.highCloud,
      corridorSamples
    );

    // Residual skyGlow captures Rayleigh color of a clear disk even without
    // elevated cloud. Cloud reflectance scales from that floor to full potential.
    const skyGlow = 0.26;
    const geometric =
      illumination === null || reflectance === null
        ? null
        : illumination * (skyGlow + (1 - skyGlow) * reflectance);

    const transmittance = atmosphericTransmittance(
      values.visibility,
      values.humidity,
      values.aerosolOpticalDepth
    );
    const dry = dryWindowFactor(values.precipitationProbability);

    const tau = opticalDepthProxy(
      values.visibility,
      values.humidity,
      values.aerosolOpticalDepth
    );

    // Multiplicative radiative potential. A tiny G floor keeps sealed corridors
    // from rendering as UI-zero while staying firmly Unlikely.
    const G = geometric === null ? 0 : geometric;
    const T = transmittance === null ? 0.78 : transmittance;
    const D = dry === null ? 0.9 : dry;

    const raw =
      Math.pow(Math.max(G, 0.05), MODEL.alpha) *
      Math.pow(Math.max(T, 1e-6), MODEL.beta) *
      Math.pow(Math.max(D, 1e-6), MODEL.gamma);

    let score = Math.round(100 * clamp(raw, 0, 1));

    const gated = applyPhysicalGates(score, values, illumination, reflectance);
    score = gated.score;

    const humidityDiagnostic =
      values.humidity === null ? null : 1 - smoothstep(48, 90, values.humidity);
    const aerosolDiagnostic = scoreAerosolDiagnostic(values.aerosolOpticalDepth);

    const componentValues = {
      corridor: illumination,
      cloudCanvas: reflectance,
      atmosphere: transmittance,
      precipitation: dry,
      humidity: humidityDiagnostic,
      aerosol: aerosolDiagnostic,
    };

    const components = COMPONENTS.map((definition) => {
      const value = componentValues[definition.id];
      return {
        ...definition,
        value,
        percent: value === null ? null : Math.round(value * 100),
        points: value === null ? null : value * definition.weight,
      };
    });

    const available = components.filter((component) => component.value !== null);
    const aerosolWeight = COMPONENTS.find(
      (component) => component.id === "aerosol"
    ).weight;
    const availableWeight =
      100 - (componentValues.aerosol === null ? aerosolWeight : 0);

    const physics = {
      model: MODEL.id,
      version: MODEL.version,
      illumination,
      reflectance,
      geometric,
      transmittance,
      dryWindow: dry,
      opticalDepth: tau,
      rawIndex: raw,
      exponents: { alpha: MODEL.alpha, beta: MODEL.beta, gamma: MODEL.gamma },
      solarAzimuthDeg: finiteOrNull(input.solarAzimuthDeg),
      corridorSampleCount: corridorSamples.length,
      equation: "Q = 100 · G^α · T^β · D^γ",
    };

    const confidence = getConfidence(
      input,
      values,
      corridorSamples,
      illumination
    );
    const rating = getRating(score);
    const summary = buildSummary(score, values, gated.gate, physics);

    return {
      score,
      rating,
      confidence,
      components,
      values,
      cap: gated.gate,
      summary,
      availableWeight,
      physics,
      model: {
        id: MODEL.id,
        version: MODEL.version,
        name: MODEL.name,
      },
      available,
    };
  }

  function localTimeKey(isoLocalTime) {
    if (typeof isoLocalTime !== "string") return null;
    const match = isoLocalTime.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/
    );
    if (!match) return null;
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0)
    );
  }

  function sampleHourlyAt(hourly, targetTime, fields) {
    if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) {
      return null;
    }

    const targetKey = localTimeKey(targetTime);
    if (targetKey === null) return null;

    const keys = hourly.time.map(localTimeKey);
    const firstKey = keys.find((key) => key !== null);
    const lastKey = [...keys].reverse().find((key) => key !== null);
    if (
      firstKey === undefined ||
      lastKey === undefined ||
      targetKey < firstKey ||
      targetKey > lastKey
    ) {
      return null;
    }

    let upperIndex = keys.findIndex((key) => key !== null && key >= targetKey);
    const lowerIndex = Math.max(0, upperIndex - 1);

    const lowerKey = keys[lowerIndex];
    const upperKey = keys[upperIndex];
    const range = upperKey - lowerKey;
    const amount =
      range > 0 ? clamp((targetKey - lowerKey) / range, 0, 1) : 0;

    const sample = {
      time: targetTime,
      sourceTime:
        amount < 0.5 ? hourly.time[lowerIndex] : hourly.time[upperIndex],
      sampleDistanceMinutes:
        Math.min(
          Math.abs(targetKey - lowerKey),
          Math.abs(upperKey - targetKey)
        ) / 60000,
    };

    fields.forEach((field) => {
      const series = hourly[field];
      if (!Array.isArray(series)) {
        sample[field] = null;
        return;
      }

      // Multi-location Open-Meteo responses nest series as number[][];
      // single-location responses use number[].
      const resolvedSeries = Array.isArray(series[0]) ? null : series;
      if (!resolvedSeries) {
        sample[field] = null;
        return;
      }

      const lowerValue = finiteOrNull(resolvedSeries[lowerIndex]);
      const upperValue = finiteOrNull(resolvedSeries[upperIndex]);
      if (lowerValue === null && upperValue === null) {
        sample[field] = null;
      } else if (lowerValue === null) {
        sample[field] = upperValue;
      } else if (upperValue === null) {
        sample[field] = lowerValue;
      } else if (field === "precipitation_probability") {
        sample[field] = upperValue;
      } else if (field === "weather_code") {
        sample[field] = amount < 0.5 ? lowerValue : upperValue;
      } else {
        sample[field] = mix(lowerValue, upperValue, amount);
      }
    });

    return sample;
  }

  function localTimeToEpoch(isoLocalTime, utcOffsetSeconds) {
    const key = localTimeKey(isoLocalTime);
    if (key === null) return null;
    return key - finiteOrNull(utcOffsetSeconds || 0) * 1000;
  }

  function zonedLocalTimeToEpoch(isoLocalTime, timeZone, fallbackOffsetSeconds) {
    const targetKey = localTimeKey(isoLocalTime);
    if (targetKey === null) return null;
    if (!timeZone || typeof Intl === "undefined") {
      return localTimeToEpoch(isoLocalTime, fallbackOffsetSeconds);
    }

    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });

      let guess = targetKey;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const parts = Object.fromEntries(
          formatter
            .formatToParts(new Date(guess))
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, Number(part.value)])
        );
        const representedLocalTime = Date.UTC(
          parts.year,
          parts.month - 1,
          parts.day,
          parts.hour,
          parts.minute,
          parts.second
        );
        const correction = targetKey - representedLocalTime;
        guess += correction;
        if (Math.abs(correction) < 1000) break;
      }
      return guess;
    } catch (error) {
      return localTimeToEpoch(isoLocalTime, fallbackOffsetSeconds);
    }
  }

  return {
    MODEL,
    COMPONENTS,
    clamp,
    buildSolarCorridor,
    destinationPoint,
    getRating,
    localTimeKey,
    localTimeToEpoch,
    sampleHourlyAt,
    scoreSunset,
    solarAzimuthAtSunset,
    solarDeclinationDegrees,
    zonedLocalTimeToEpoch,
  };
});
