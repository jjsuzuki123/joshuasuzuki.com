(function initSunsetScoring(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.SunsetScoring = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSunsetScoring() {
  "use strict";

  const COMPONENTS = [
    { id: "cloudCanvas", label: "Cloud canvas", weight: 32 },
    { id: "horizon", label: "Open horizon", weight: 28 },
    { id: "visibility", label: "Visibility", weight: 14 },
    { id: "precipitation", label: "Dry window", weight: 11 },
    { id: "humidity", label: "Humidity", weight: 8 },
    { id: "aerosol", label: "Color particles", weight: 7 },
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

  function plateauScore(value, lowZero, lowIdeal, highIdeal, highZero) {
    if (value === null) return null;
    if (value <= lowZero || value >= highZero) return 0;
    if (value >= lowIdeal && value <= highIdeal) return 1;
    if (value < lowIdeal) return smoothstep(lowZero, lowIdeal, value);
    return 1 - smoothstep(highIdeal, highZero, value);
  }

  function scoreCloudCanvas(midCloud, highCloud) {
    if (midCloud === null && highCloud === null) return null;

    const midFit =
      midCloud === null ? null : plateauScore(midCloud, 3, 28, 68, 98);
    const highFit =
      highCloud === null ? null : plateauScore(highCloud, 2, 22, 76, 100);
    const available = [midFit, highFit].filter((value) => value !== null);

    if (available.length === 1) return available[0];

    const strongestLayer = Math.max(midFit, highFit);
    const layerAverage = (midFit + highFit) / 2;
    return strongestLayer * 0.62 + layerAverage * 0.38;
  }

  function scoreHorizon(lowCloud, previousLowCloud) {
    if (lowCloud === null) return null;

    const openSky = 1 - smoothstep(12, 86, lowCloud);
    if (previousLowCloud === null) return openSky;

    const cloudTrend = lowCloud - previousLowCloud;
    const trendAdjustment = clamp((-cloudTrend / 100) * 0.3, -0.08, 0.08);
    return clamp(openSky + trendAdjustment, 0, 1);
  }

  function scoreAerosol(aerosolOpticalDepth) {
    if (aerosolOpticalDepth === null) return null;

    if (aerosolOpticalDepth <= 0.03) return 0.65;
    if (aerosolOpticalDepth < 0.08) {
      return mix(0.65, 1, smoothstep(0.03, 0.08, aerosolOpticalDepth));
    }
    if (aerosolOpticalDepth <= 0.25) return 1;
    if (aerosolOpticalDepth < 0.65) {
      return 1 - smoothstep(0.25, 0.65, aerosolOpticalDepth);
    }
    return 0;
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

  function weatherCodeCap(weatherCode) {
    if (weatherCode === null) return null;
    if (weatherCode >= 95) {
      return { score: 30, reason: "Thunderstorms can block the sunset window." };
    }
    if (weatherCode === 45 || weatherCode === 48) {
      return { score: 38, reason: "Fog is likely to hide the horizon." };
    }
    if (
      (weatherCode >= 51 && weatherCode <= 57) ||
      (weatherCode >= 61 && weatherCode <= 67) ||
      (weatherCode >= 71 && weatherCode <= 77) ||
      (weatherCode >= 80 && weatherCode <= 86)
    ) {
      return { score: 45, reason: "Active precipitation can obscure the color." };
    }
    return null;
  }

  function getConfidence(input, numericInputs) {
    const requiredValues = [
      numericInputs.lowCloud,
      numericInputs.midCloud,
      numericInputs.highCloud,
      numericInputs.visibility,
      numericInputs.precipitationProbability,
      numericInputs.humidity,
    ];
    const coverage =
      requiredValues.filter((value) => value !== null).length / requiredValues.length;

    const hoursAhead = finiteOrNull(input.hoursAhead);
    const horizon =
      hoursAhead === null
        ? 0.72
        : clamp(1 - (Math.max(0, hoursAhead - 8) / 160) * 0.48, 0.52, 1);

    const sampleDistanceMinutes = finiteOrNull(input.sampleDistanceMinutes);
    const alignment =
      sampleDistanceMinutes === null
        ? 0.8
        : clamp(1 - (sampleDistanceMinutes / 60) * 0.2, 0.8, 1);

    const aerosolBonus = numericInputs.aerosolOpticalDepth === null ? 0 : 0.02;
    const value = Math.round(
      clamp((coverage * 0.5 + horizon * 0.4 + alignment * 0.1 + aerosolBonus) * 100, 0, 94)
    );

    let label = "Low";
    if (value >= 84) label = "High";
    else if (value >= 62) label = "Moderate";

    return { value, label };
  }

  function buildSummary(score, values, cap) {
    if (cap) return cap.reason;

    if (values.lowCloud !== null && values.lowCloud >= 66) {
      return "Low clouds may cover the sun before the best color develops.";
    }
    if (
      values.midCloud !== null &&
      values.highCloud !== null &&
      values.midCloud + values.highCloud < 18
    ) {
      return "The horizon looks clear, but there may be too little elevated cloud to catch color.";
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
    if (score >= 85) {
      return "Elevated clouds, a clear horizon, and clean air line up for a strong show.";
    }
    if (score >= 72) {
      return "The cloud layers should catch color without fully blocking the sun.";
    }
    if (score >= 58) {
      return "There is enough structure for color, though one or two inputs are marginal.";
    }
    if (score >= 42) {
      return "Some color is possible, but the cloud setup is working against it.";
    }
    return "The forecast lacks the clear horizon and elevated cloud mix that produces vivid color.";
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

    const componentValues = {
      cloudCanvas: scoreCloudCanvas(values.midCloud, values.highCloud),
      horizon: scoreHorizon(values.lowCloud, values.previousLowCloud),
      visibility:
        values.visibility === null ? null : smoothstep(3000, 22000, values.visibility),
      precipitation:
        values.precipitationProbability === null
          ? null
          : 1 - smoothstep(4, 68, values.precipitationProbability),
      humidity:
        values.humidity === null ? null : 1 - smoothstep(60, 96, values.humidity),
      aerosol: scoreAerosol(values.aerosolOpticalDepth),
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
    const normalizationWeight =
      100 - (componentValues.aerosol === null ? 7 : 0);
    const earnedPoints = available.reduce(
      (total, component) => total + component.points,
      0
    );

    let score =
      normalizationWeight === 0
        ? 0
        : Math.round((earnedPoints / normalizationWeight) * 100);
    let cap = weatherCodeCap(values.weatherCode);

    if (values.lowCloud !== null && values.lowCloud >= 90) {
      const lowCloudCap = {
        score: 42,
        reason: "A nearly solid low cloud deck is likely to block the horizon.",
      };
      if (!cap || lowCloudCap.score < cap.score) cap = lowCloudCap;
    }
    if (values.visibility !== null && values.visibility < 1500) {
      const visibilityCap = {
        score: 32,
        reason: "Very low visibility is likely to hide both the sun and distant clouds.",
      };
      if (!cap || visibilityCap.score < cap.score) cap = visibilityCap;
    }
    if (cap) score = Math.min(score, cap.score);

    const rating = getRating(score);
    const confidence = getConfidence(input, values);

    return {
      score,
      rating,
      confidence,
      components,
      values,
      cap,
      summary: buildSummary(score, values, cap),
      availableWeight: normalizationWeight,
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

      const lowerValue = finiteOrNull(series[lowerIndex]);
      const upperValue = finiteOrNull(series[upperIndex]);
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
    COMPONENTS,
    clamp,
    getRating,
    localTimeKey,
    localTimeToEpoch,
    sampleHourlyAt,
    scoreSunset,
    zonedLocalTimeToEpoch,
  };
});
