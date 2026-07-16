(function startAfterglow() {
  "use strict";

  const scoring = window.SunsetScoring;
  if (!scoring) {
    const loading = document.getElementById("forecast-loading");
    const error = document.getElementById("forecast-error");
    const message = document.getElementById("error-message");
    if (loading) loading.hidden = true;
    if (error) error.hidden = false;
    if (message) {
      message.textContent =
        "The scoring engine did not load. Refresh the page to try again.";
    }
    document.getElementById("forecast")?.setAttribute("aria-busy", "false");
    return;
  }

  const API = {
    weather: "https://api.open-meteo.com/v1/forecast",
    air: "https://air-quality-api.open-meteo.com/v1/air-quality",
    geocoding: "https://geocoding-api.open-meteo.com/v1/search",
    reverseGeocoding:
      "https://api.bigdatacloud.net/data/reverse-geocode-client",
  };

  const WEATHER_FIELDS = [
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "relative_humidity_2m",
    "visibility",
    "precipitation_probability",
    "weather_code",
  ];

  const DEFAULT_LOCATION = {
    name: "San Francisco",
    region: "California, United States",
    latitude: 37.7749,
    longitude: -122.4194,
  };

  const CACHE_KEY = "afterglow:forecast:v3.1";
  const CACHE_MAX_AGE = 20 * 60 * 1000;
  // The last-used location persists far longer than the forecast data cache so a
  // refresh reopens where the user left off instead of the default city.
  const LAST_LOCATION_KEY = "afterglow:last-location:v1";
  const LAST_LOCATION_MAX_AGE = 90 * 24 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT = 12000;
  const CORRIDOR_FIELDS = [
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
  ];

  const elements = {
    form: document.getElementById("location-form"),
    input: document.getElementById("location-input"),
    geolocateButton: document.getElementById("geolocate-button"),
    quickLocationButtons: document.querySelectorAll("[data-location]"),
    searchStatus: document.getElementById("search-status"),
    forecastAnnouncement: document.getElementById("forecast-announcement"),
    forecastSection: document.getElementById("forecast"),
    loading: document.getElementById("forecast-loading"),
    content: document.getElementById("forecast-content"),
    error: document.getElementById("forecast-error"),
    errorMessage: document.getElementById("error-message"),
    retryButton: document.getElementById("retry-button"),
    forecastDayLabel: document.getElementById("forecast-day-label"),
    locationName: document.getElementById("location-name"),
    locationRegion: document.getElementById("location-region"),
    dataFreshness: document.getElementById("data-freshness"),
    qualityCard: document.getElementById("quality-card"),
    scoreRing: document.getElementById("score-ring"),
    scoreValue: document.getElementById("score-value"),
    ratingLabel: document.getElementById("rating-label"),
    confidenceLabel: document.getElementById("confidence-label"),
    confidenceDot: document.getElementById("confidence-dot"),
    scoreSummary: document.getElementById("score-summary"),
    sunsetTime: document.getElementById("sunset-time"),
    viewingWindow: document.getElementById("viewing-window"),
    timezoneLabel: document.getElementById("timezone-label"),
    metricGrid: document.getElementById("metric-grid"),
    forecastDays: document.getElementById("forecast-days"),
  };

  let activeForecastController = null;
  let activeGeocodingController = null;
  let currentPayload = null;
  let currentLocation = null;
  let lastAttemptedLocation = null;
  let selectedForecastIndex = 0;
  let activeIntent = 0;

  function makeUrl(base, parameters) {
    const url = new URL(base);
    Object.entries(parameters).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
    return url;
  }

  async function fetchJson(url, parentSignal) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal.reason);
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT);

    if (parentSignal) {
      if (parentSignal.aborted) controller.abort(parentSignal.reason);
      else parentSignal.addEventListener("abort", abortFromParent, { once: true });
    }

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Weather service returned ${response.status}.`);
      }

      const data = await response.json();
      if (data && data.error) {
        throw new Error(data.reason || "The weather service rejected the request.");
      }
      return data;
    } catch (error) {
      if (timedOut && !(parentSignal && parentSignal.aborted)) {
        throw new Error("The data request timed out. Please try again.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", abortFromParent);
      }
    }
  }

  async function fetchCorridorWeather(location, weather, signal) {
    const sunsets = weather.daily && Array.isArray(weather.daily.sunset)
      ? weather.daily.sunset
      : [];
    const timezone = weather.timezone || "auto";
    const latitudes = [];
    const longitudes = [];
    const meta = [];

    sunsets.forEach((sunset, dayIndex) => {
      const azimuth = scoring.solarAzimuthAtSunset(
        location.latitude,
        sunset
      );
      if (azimuth === null) return;

      const points = scoring.buildSolarCorridor(
        location.latitude,
        location.longitude,
        azimuth
      );
      points.forEach((point) => {
        latitudes.push(point.latitude.toFixed(4));
        longitudes.push(point.longitude.toFixed(4));
        meta.push({
          dayIndex,
          distanceKm: point.distanceKm,
          clearanceWeight: point.clearanceWeight,
          canvasWeight: point.canvasWeight,
          azimuth,
        });
      });
    });

    if (!meta.length) return { responses: [], meta: [] };

    const corridorUrl = makeUrl(API.weather, {
      latitude: latitudes.join(","),
      longitude: longitudes.join(","),
      timezone,
      hourly: CORRIDOR_FIELDS.join(","),
      forecast_days: 8,
    });

    const payload = await fetchJson(corridorUrl, signal);
    const responses = Array.isArray(payload) ? payload : [payload];
    return { responses, meta };
  }

  async function fetchForecastData(location, signal) {
    const shared = {
      latitude: location.latitude.toFixed(4),
      longitude: location.longitude.toFixed(4),
      timezone: "auto",
    };

    const weatherUrl = makeUrl(API.weather, {
      ...shared,
      hourly: WEATHER_FIELDS.join(","),
      daily: "sunset",
      forecast_days: 8,
    });

    const airUrl = makeUrl(API.air, {
      ...shared,
      hourly: "aerosol_optical_depth",
      forecast_days: 7,
    });

    const airPromise = fetchJson(airUrl, signal).catch((error) => {
      if (signal.aborted) throw error;
      return null;
    });

    const [weather, air] = await Promise.all([
      fetchJson(weatherUrl, signal),
      airPromise,
    ]);

    let corridor = { responses: [], meta: [] };
    try {
      corridor = await fetchCorridorWeather(location, weather, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      // Local-point scoring remains valid if the corridor request fails.
      corridor = { responses: [], meta: [] };
    }

    return { weather, air, corridor };
  }

  function shiftLocalTime(isoLocalTime, minutes) {
    const key = scoring.localTimeKey(isoLocalTime);
    if (key === null) return isoLocalTime;
    return new Date(key + minutes * 60000).toISOString().slice(0, 16);
  }

  function timeZoneNameAt(epoch, weather) {
    if (Number.isFinite(epoch) && weather.timezone) {
      try {
        const part = new Intl.DateTimeFormat(undefined, {
          timeZone: weather.timezone,
          timeZoneName: "short",
        })
          .formatToParts(new Date(epoch))
          .find((item) => item.type === "timeZoneName");
        if (part && part.value) return part.value;
      } catch (error) {
        // Use the API abbreviation when the browser lacks this time zone.
      }
    }

    return weather.timezone_abbreviation || weather.timezone || "Local time";
  }

  function buildDayCorridor(sunset, dayIndex, corridorPayload) {
    const meta = corridorPayload && Array.isArray(corridorPayload.meta)
      ? corridorPayload.meta
      : [];
    const responses =
      corridorPayload && Array.isArray(corridorPayload.responses)
        ? corridorPayload.responses
        : [];
    const afterglowTime = shiftLocalTime(sunset, 20);
    const samples = [];

    meta.forEach((entry, metaIndex) => {
      if (entry.dayIndex !== dayIndex) return;
      const response = responses[metaIndex];
      if (!response || !response.hourly) return;

      const atSunset = scoring.sampleHourlyAt(
        response.hourly,
        sunset,
        CORRIDOR_FIELDS
      );
      if (!atSunset) return;

      const atAfterglow = scoring.sampleHourlyAt(
        response.hourly,
        afterglowTime,
        ["cloud_cover_mid", "cloud_cover_high"]
      );

      samples.push({
        distanceKm: entry.distanceKm,
        lowCloud: atSunset.cloud_cover_low,
        midCloud: atSunset.cloud_cover_mid,
        highCloud: atSunset.cloud_cover_high,
        afterglowMidCloud: atAfterglow ? atAfterglow.cloud_cover_mid : null,
        afterglowHighCloud: atAfterglow ? atAfterglow.cloud_cover_high : null,
        clearanceWeight: entry.clearanceWeight,
        canvasWeight: entry.canvasWeight,
        azimuth: entry.azimuth,
      });
    });

    return samples;
  }

  function buildForecasts(weather, air, corridorPayload) {
    if (
      !weather ||
      !weather.hourly ||
      !weather.daily ||
      !Array.isArray(weather.daily.sunset)
    ) {
      throw new Error("The forecast response did not include sunset data.");
    }

    const now = Date.now();
    const dates = weather.daily.time || [];
    const sunsets = weather.daily.sunset;
    const forecasts = sunsets.map((sunset, index) => {
      const sample = scoring.sampleHourlyAt(weather.hourly, sunset, WEATHER_FIELDS);
      if (!sample) return null;

      const hourBefore = scoring.sampleHourlyAt(
        weather.hourly,
        shiftLocalTime(sunset, -60),
        ["cloud_cover_low"]
      );
      const airSample =
        air && air.hourly
          ? scoring.sampleHourlyAt(air.hourly, sunset, ["aerosol_optical_depth"])
          : null;
      const sunsetEpoch = scoring.zonedLocalTimeToEpoch(
        sunset,
        weather.timezone,
        weather.utc_offset_seconds
      );
      const hoursAhead =
        sunsetEpoch === null ? null : (sunsetEpoch - now) / (60 * 60 * 1000);
      const solarAzimuthDeg = scoring.solarAzimuthAtSunset(
        weather.latitude,
        sunset
      );
      const corridor = buildDayCorridor(sunset, index, corridorPayload);

      const result = scoring.scoreSunset({
        lowCloud: sample.cloud_cover_low,
        midCloud: sample.cloud_cover_mid,
        highCloud: sample.cloud_cover_high,
        visibility: sample.visibility,
        precipitationProbability: sample.precipitation_probability,
        humidity: sample.relative_humidity_2m,
        aerosolOpticalDepth: airSample
          ? airSample.aerosol_optical_depth
          : null,
        previousLowCloud: hourBefore ? hourBefore.cloud_cover_low : null,
        weatherCode: sample.weather_code,
        hoursAhead,
        sampleDistanceMinutes: sample.sampleDistanceMinutes,
        solarAzimuthDeg,
        corridor,
      });

      return {
        date: dates[index] || sunset.slice(0, 10),
        sunset,
        sunsetEpoch,
        sample,
        hourBefore,
        airSample,
        corridor,
        solarAzimuthDeg,
        result,
        sourceIndex: index,
      };
    });

    const futureForecasts = forecasts.filter(
      (forecast) =>
        forecast &&
        (forecast.sunsetEpoch === null ||
          forecast.sunsetEpoch > now - 30 * 60 * 1000)
    );

    return (futureForecasts.length ? futureForecasts : forecasts.filter(Boolean)).slice(
      0,
      7
    );
  }

  function formatLocalTime(isoLocalTime) {
    if (typeof isoLocalTime !== "string") return "Unavailable";
    const match = isoLocalTime.match(/T(\d{2}):(\d{2})/);
    if (!match) return "Unavailable";

    const hour = Number(match[1]);
    const minute = match[2];
    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute} ${period}`;
  }

  function formatDate(dateString, options) {
    const date = new Date(`${dateString}T12:00:00Z`);
    return new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      ...options,
    }).format(date);
  }

  function roundPercent(value) {
    return Number.isFinite(value) ? `${Math.round(value)}%` : "Unavailable";
  }

  function formatVisibility(value) {
    if (!Number.isFinite(value)) return "Unavailable";
    const kilometers = value / 1000;
    return `${kilometers < 10 ? kilometers.toFixed(1) : Math.round(kilometers)} km`;
  }

  function formatCacheAge(fetchedAt) {
    const ageMinutes = Math.max(0, Math.round((Date.now() - fetchedAt) / 60000));
    if (ageMinutes < 1) return "Cached moments ago";
    return `Cached ${ageMinutes} min ago`;
  }

  function toneColor(tone) {
    const colors = {
      electric: "#ff8067",
      bright: "#ffad68",
      warm: "#e5ad82",
      soft: "#b6a2c8",
      dim: "#7c7487",
    };
    return colors[tone] || colors.warm;
  }

  function getMetricDetails(forecast) {
    const { result, sample, hourBefore, airSample, corridor, solarAzimuthDeg } =
      forecast;
    const componentMap = Object.fromEntries(
      result.components.map((component) => [component.id, component])
    );
    const physics = result.physics || {};

    const lowCloud = sample.cloud_cover_low;
    const previousLowCloud = hourBefore ? hourBefore.cloud_cover_low : null;
    const trend =
      Number.isFinite(lowCloud) && Number.isFinite(previousLowCloud)
        ? lowCloud - previousLowCloud
        : null;

    let corridorNote =
      "Low cloud along the sunset azimuth that can cut off low-angle sunlight.";
    if (Array.isArray(corridor) && corridor.length >= 3) {
      corridorNote = `Sampled ${corridor.length} points along the solar corridor${
        Number.isFinite(solarAzimuthDeg)
          ? ` at ${Math.round(solarAzimuthDeg)}°`
          : ""
      }.`;
    } else if (trend !== null && trend <= -8) {
      corridorNote = "Low cloud is clearing as sunset approaches.";
    } else if (trend !== null && trend >= 8) {
      corridorNote = "Low cloud is building near the sunset window.";
    }

    const aerosolValue = airSample ? airSample.aerosol_optical_depth : null;
    const opticalDepth =
      physics.opticalDepth === null || physics.opticalDepth === undefined
        ? null
        : physics.opticalDepth;

    const metrics = [
      {
        component: componentMap.corridor,
        icon: "CRD",
        color: "#ffb45f",
        raw: Array.isArray(corridor) && corridor.length
          ? `${corridor.length} corridor pts · ${roundPercent(lowCloud)} local low`
          : `${roundPercent(lowCloud)} low cloud`,
        note: corridorNote,
      },
      {
        component: componentMap.cloudCanvas,
        icon: "CLD",
        color: "#ff7b6b",
        raw: `${roundPercent(sample.cloud_cover_mid)} mid · ${roundPercent(sample.cloud_cover_high)} high`,
        note: "Elevated cloud that can reflect reddened light after the surface is in shadow.",
      },
      {
        component: componentMap.atmosphere,
        icon: "ATM",
        color: "#d9b6ff",
        raw:
          opticalDepth === null
            ? formatVisibility(sample.visibility)
            : `${formatVisibility(sample.visibility)} · τ ${opticalDepth.toFixed(2)}`,
        note: "Beer–Lambert transmittance proxy from visibility, humidity, and aerosol load.",
      },
      {
        component: componentMap.precipitation,
        icon: "DRY",
        color: "#8fc5ff",
        raw: `${roundPercent(sample.precipitation_probability)} rain chance`,
        note: "Rain near sunset can close the viewing window.",
      },
      {
        component: componentMap.humidity,
        icon: "HUM",
        color: "#79d7cf",
        raw: `${roundPercent(sample.relative_humidity_2m)} relative humidity`,
        note: "High humidity grows haze and reduces color saturation.",
      },
      {
        component: componentMap.aerosol,
        icon: "AOD",
        color: "#ffe7a5",
        raw: Number.isFinite(aerosolValue)
          ? `AOD ${aerosolValue.toFixed(2)}`
          : "Data unavailable",
        note: Number.isFinite(aerosolValue)
          ? "Cleaner tropospheric air keeps color vivid; smoke and dust mute it."
          : "Aerosol term omitted; transmittance uses visibility and humidity only.",
      },
    ];

    return metrics.filter((metric) => metric.component);
  }

  function makeMetricCard(metric) {
    const article = document.createElement("article");
    article.className = "metric-card";
    article.style.setProperty("--metric-color", metric.color);

    const top = document.createElement("div");
    top.className = "metric-top";

    const icon = document.createElement("span");
    icon.className = "metric-icon";
    icon.textContent = metric.icon;

    const weight = document.createElement("span");
    weight.className = "metric-weight";
    weight.textContent = `${metric.component.weight}% importance`;
    top.append(icon, weight);

    const titleRow = document.createElement("div");
    titleRow.className = "metric-title-row";

    const title = document.createElement("h4");
    title.textContent = metric.component.label;

    const raw = document.createElement("strong");
    raw.textContent = metric.raw;
    titleRow.append(title, raw);

    const meter = document.createElement("div");
    meter.className = "metric-meter";
    meter.setAttribute("role", "progressbar");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", "100");
    meter.setAttribute(
      "aria-label",
      `${metric.component.label} favorability ${
        metric.component.percent === null ? "unavailable" : `${metric.component.percent} percent`
      }`
    );
    if (metric.component.percent !== null) {
      meter.setAttribute("aria-valuenow", String(metric.component.percent));
    }

    const fill = document.createElement("span");
    fill.style.setProperty("--value", metric.component.percent || 0);
    meter.appendChild(fill);

    const note = document.createElement("p");
    note.className = "metric-note";
    note.textContent = metric.note;

    article.append(top, titleRow, meter, note);
    return article;
  }

  function makeDayCard(forecast, index) {
    const button = document.createElement("button");
    button.className = `day-card${index === selectedForecastIndex ? " is-active" : ""}`;
    button.type = "button";
    button.dataset.index = String(index);
    button.setAttribute(
      "aria-label",
      `${formatDate(forecast.date, { weekday: "long" })}, sunset score ${
        forecast.result.score
      }, ${forecast.result.rating.label}`
    );
    button.setAttribute("aria-pressed", String(index === selectedForecastIndex));
    button.style.setProperty(
      "--day-color",
      toneColor(forecast.result.rating.tone)
    );

    const day = document.createElement("span");
    day.className = "day-card-day";
    day.textContent =
      forecast.sourceIndex === 0
        ? "Today"
        : formatDate(forecast.date, { weekday: "short" });

    const date = document.createElement("span");
    date.className = "day-card-date";
    date.textContent = formatDate(forecast.date, {
      month: "short",
      day: "numeric",
    });

    const score = document.createElement("div");
    score.className = "day-card-score";
    const scoreValue = document.createElement("strong");
    scoreValue.textContent = String(forecast.result.score);
    const scoreMax = document.createElement("span");
    scoreMax.textContent = "/100";
    score.append(scoreValue, scoreMax);

    const rating = document.createElement("span");
    rating.className = "day-card-rating";
    rating.textContent = forecast.result.rating.shortLabel;

    const rain = document.createElement("span");
    rain.className = "day-card-rain";
    rain.textContent = `${roundPercent(
      forecast.sample.precipitation_probability
    )} rain · ${formatLocalTime(forecast.sunset)}`;

    button.append(day, date, score, rating, rain);
    button.addEventListener("click", () => {
      selectedForecastIndex = index;
      renderSelectedForecast();
      updateDaySelection(true);
      elements.forecastAnnouncement.textContent = `${formatDate(forecast.date, {
        weekday: "long",
      })} selected. Sunset score ${forecast.result.score} out of 100, ${
        forecast.result.rating.label
      }.`;
    });

    return button;
  }

  function updateDaySelection(shouldScroll) {
    let activeCard = null;
    elements.forecastDays.querySelectorAll(".day-card").forEach((card, index) => {
      const isActive = index === selectedForecastIndex;
      card.classList.toggle("is-active", isActive);
      card.setAttribute("aria-pressed", String(isActive));
      if (isActive) activeCard = card;
    });

    if (shouldScroll && activeCard) {
      activeCard.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function renderSelectedForecast() {
    if (!currentPayload || !currentPayload.forecasts.length) return;
    const forecast = currentPayload.forecasts[selectedForecastIndex];
    const { result, sample } = forecast;
    const scoreColor = toneColor(result.rating.tone);

    elements.forecastDayLabel.textContent =
      forecast.sourceIndex === 0
        ? "Tonight's outlook"
        : `${formatDate(forecast.date, { weekday: "long" })}'s outlook`;
    elements.scoreValue.textContent = String(result.score);
    elements.ratingLabel.textContent = result.rating.label;
    elements.scoreSummary.textContent = result.summary;
    elements.scoreRing.style.setProperty("--score", result.score);
    elements.scoreRing.style.setProperty("--ring-color", scoreColor);
    elements.scoreRing.setAttribute(
      "aria-label",
      `Sunset quality score ${result.score} out of 100, ${result.rating.label}`
    );
    elements.qualityCard.dataset.tone = result.rating.tone;

    elements.confidenceLabel.textContent = result.confidence.label;
    elements.confidenceDot.style.background =
      result.confidence.value >= 84
        ? "#7ddbd0"
        : result.confidence.value >= 62
          ? "#ffbd6f"
          : "#ff8067";

    elements.sunsetTime.textContent = formatLocalTime(forecast.sunset);
    elements.viewingWindow.textContent = `${formatLocalTime(
      shiftLocalTime(forecast.sunset, -25)
    )} to ${formatLocalTime(shiftLocalTime(forecast.sunset, 25))}`;
    elements.timezoneLabel.textContent = timeZoneNameAt(
      forecast.sunsetEpoch,
      currentPayload.weather
    );

    const clouds = elements.qualityCard.querySelectorAll(".high-cloud");
    const elevatedCloud =
      ((Number(sample.cloud_cover_mid) || 0) +
        (Number(sample.cloud_cover_high) || 0)) /
      200;
    clouds.forEach((cloud, index) => {
      cloud.style.opacity = String(
        scoring.clamp(0.25 + elevatedCloud * 0.75 - index * 0.08, 0.2, 0.94)
      );
    });

    elements.metricGrid.replaceChildren(
      ...getMetricDetails(forecast).map(makeMetricCard)
    );
    updateDaySelection(false);
  }

  function renderPayload(payload, location, fetchedAt, cached) {
    const forecasts = buildForecasts(
      payload.weather,
      payload.air,
      payload.corridor
    );
    if (!forecasts.length) {
      throw new Error("No upcoming sunset forecast was available.");
    }

    currentPayload = { ...payload, forecasts, fetchedAt };
    currentLocation = location;
    selectedForecastIndex = 0;

    elements.locationName.textContent = location.name;
    elements.locationRegion.textContent = location.region
      ? ` · ${location.region}`
      : "";
    elements.dataFreshness.textContent = cached
      ? `${formatCacheAge(fetchedAt)} · refreshing`
      : "Updated now";
    elements.forecastDays.replaceChildren(
      ...forecasts.map(makeDayCard)
    );
    renderSelectedForecast();

    elements.loading.hidden = true;
    elements.error.hidden = true;
    elements.content.hidden = false;
    elements.forecastSection.setAttribute("aria-busy", "false");
  }

  function showLoading(preserveContent) {
    elements.forecastSection.setAttribute("aria-busy", "true");
    elements.error.hidden = true;
    if (!preserveContent) {
      elements.content.hidden = true;
      elements.loading.hidden = false;
    }
  }

  function showError(error, preserveContent) {
    const message =
      error && error.message === "Failed to fetch"
        ? "The weather service could not be reached. Check your connection and try again."
        : error && error.message
          ? error.message
          : "The weather service did not respond. Try again in a moment.";

    elements.forecastSection.setAttribute("aria-busy", "false");
    elements.loading.hidden = true;
    if (preserveContent && !elements.content.hidden) {
      elements.searchStatus.textContent = `Could not refresh: ${message}`;
      if (currentPayload) {
        elements.dataFreshness.textContent = formatCacheAge(
          currentPayload.fetchedAt
        );
      }
      return;
    }

    elements.content.hidden = true;
    elements.errorMessage.textContent = message;
    elements.error.hidden = false;
  }

  function setControlsBusy(busy) {
    elements.form.querySelector('button[type="submit"]').disabled = busy;
    elements.geolocateButton.disabled = busy;
    elements.quickLocationButtons.forEach((button) => {
      button.disabled = busy;
    });
  }

  function beginIntent() {
    activeIntent += 1;
    if (activeForecastController) activeForecastController.abort();
    if (activeGeocodingController) activeGeocodingController.abort();
    return activeIntent;
  }

  function writeCache(location, data, fetchedAt) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ location, data, fetchedAt })
      );
    } catch (error) {
      // Private browsing and storage quotas should not block a live forecast.
    }
  }

  function readCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (
        !cached ||
        !cached.location ||
        !cached.data ||
        !Number.isFinite(cached.fetchedAt) ||
        Date.now() - cached.fetchedAt > CACHE_MAX_AGE
      ) {
        return null;
      }
      return cached;
    } catch (error) {
      return null;
    }
  }

  function isValidLocation(location) {
    return (
      location &&
      Number.isFinite(location.latitude) &&
      location.latitude >= -90 &&
      location.latitude <= 90 &&
      Number.isFinite(location.longitude) &&
      location.longitude >= -180 &&
      location.longitude <= 180
    );
  }

  function writeLastLocation(location) {
    if (!isValidLocation(location)) return;
    try {
      localStorage.setItem(
        LAST_LOCATION_KEY,
        JSON.stringify({
          location: {
            latitude: location.latitude,
            longitude: location.longitude,
            name: location.name || "Saved location",
            region: location.region || "",
            source: location.source || "search",
          },
          savedAt: Date.now(),
        })
      );
    } catch (error) {
      // Storage may be unavailable in private mode; memory is best-effort.
    }
  }

  function readLastLocation() {
    try {
      const stored = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY));
      if (
        !stored ||
        !isValidLocation(stored.location) ||
        !Number.isFinite(stored.savedAt) ||
        Date.now() - stored.savedAt > LAST_LOCATION_MAX_AGE
      ) {
        return null;
      }
      return stored.location;
    } catch (error) {
      return null;
    }
  }

  function updateUrl(location) {
    const url = new URL(window.location.href);
    url.searchParams.set("lat", location.latitude.toFixed(4));
    url.searchParams.set("lon", location.longitude.toFixed(4));
    url.searchParams.set("place", location.name);
    if (location.region) url.searchParams.set("region", location.region);
    else url.searchParams.delete("region");
    window.history.replaceState(null, "", url);
  }

  function locationFromUrl() {
    const parameters = new URLSearchParams(window.location.search);
    if (!parameters.has("lat") || !parameters.has("lon")) return null;

    const latitude = Number(parameters.get("lat"));
    const longitude = Number(parameters.get("lon"));
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }

    return {
      latitude,
      longitude,
      name: parameters.get("place") || "Shared location",
      region: parameters.get("region") || "",
    };
  }

  async function loadForecast(location, options) {
    const settings = {
      preserveContent: false,
      updateHistory: true,
      intent: null,
      ...options,
    };
    const intent = settings.intent === null ? beginIntent() : settings.intent;
    if (intent !== activeIntent) return;
    if (activeForecastController) activeForecastController.abort();

    const controller = new AbortController();
    activeForecastController = controller;
    lastAttemptedLocation = location;
    showLoading(settings.preserveContent);
    setControlsBusy(true);
    elements.searchStatus.textContent = `Reading the sky above ${location.name}…`;

    try {
      const data = await fetchForecastData(location, controller.signal);
      if (controller.signal.aborted || intent !== activeIntent) return;

      const fetchedAt = Date.now();
      renderPayload(data, location, fetchedAt, false);
      writeCache(location, data, fetchedAt);
      writeLastLocation(location);
      if (settings.updateHistory) updateUrl(location);
      elements.searchStatus.textContent = `Live forecast ready for ${location.name}.`;
    } catch (error) {
      if (intent !== activeIntent) return;
      if (controller.signal.aborted && activeForecastController !== controller) return;
      showError(error, settings.preserveContent);
    } finally {
      if (activeForecastController === controller && intent === activeIntent) {
        activeForecastController = null;
        setControlsBusy(false);
      }
    }
  }

  async function geocode(query) {
    if (activeGeocodingController) activeGeocodingController.abort();
    const controller = new AbortController();
    activeGeocodingController = controller;

    const url = makeUrl(API.geocoding, {
      name: query,
      count: 5,
      language: document.documentElement.lang || "en",
      format: "json",
    });

    try {
      const data = await fetchJson(url, controller.signal);
      const result = data.results && data.results[0];
      if (!result) {
        throw new Error(`No location matched "${query}". Try a nearby city.`);
      }

      const regionParts = [result.admin1, result.country].filter(
        (part, index, all) => part && all.indexOf(part) === index && part !== result.name
      );
      return {
        name: result.name,
        region: regionParts.join(", "),
        latitude: Number(result.latitude),
        longitude: Number(result.longitude),
      };
    } finally {
      if (activeGeocodingController === controller) {
        activeGeocodingController = null;
      }
    }
  }

  // Turn precise device coordinates into a readable place name. Best-effort:
  // if the lookup fails, callers fall back to a coordinate label.
  async function reverseGeocode(latitude, longitude, signal) {
    const url = makeUrl(API.reverseGeocoding, {
      latitude: latitude.toFixed(4),
      longitude: longitude.toFixed(4),
      localityLanguage: document.documentElement.lang || "en",
    });

    const data = await fetchJson(url, signal);
    const name =
      data.locality ||
      data.city ||
      data.principalSubdivision ||
      data.countryName ||
      null;
    if (!name) return null;

    // BigDataCloud returns ISO names like "United States of America (the)".
    const country = data.countryName
      ? data.countryName.replace(/\s*\(the\)$/i, "")
      : "";
    const regionParts = [];
    if (data.city && data.city !== name) regionParts.push(data.city);
    if (data.principalSubdivision) regionParts.push(data.principalSubdivision);
    if (country) regionParts.push(country);
    const region = regionParts
      .filter((part, index, all) => part && all.indexOf(part) === index)
      .join(", ");

    return { name, region };
  }

  async function handleSearch(query) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      elements.input.focus();
      return;
    }

    const intent = beginIntent();
    elements.searchStatus.textContent = `Finding ${normalizedQuery}…`;
    setControlsBusy(true);
    try {
      const location = await geocode(normalizedQuery);
      if (intent !== activeIntent) return;
      elements.input.value = location.name;
      await loadForecast(location, { intent });
    } catch (error) {
      if (intent !== activeIntent) return;
      elements.searchStatus.textContent =
        error.message === "Failed to fetch"
          ? "The location service could not be reached. Check your connection."
          : error.message || "That location could not be found.";
      setControlsBusy(false);
    }
  }

  function handleGeolocation() {
    if (!navigator.geolocation) {
      elements.searchStatus.textContent =
        "Location access is not available in this browser. Search for a city instead.";
      return;
    }

    const intent = beginIntent();
    setControlsBusy(true);
    elements.searchStatus.textContent = "Getting your location…";
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (intent !== activeIntent) return;
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const coordLabel = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;

        let name = "Your location";
        let region = coordLabel;
        let resolvedName = false;
        elements.searchStatus.textContent = "Pinpointing your location…";
        try {
          const place = await reverseGeocode(latitude, longitude);
          if (intent !== activeIntent) return;
          if (place && place.name) {
            name = place.name;
            region = place.region || coordLabel;
            resolvedName = true;
          }
        } catch (error) {
          if (intent !== activeIntent) return;
          // Keep the coordinate label when naming is unavailable.
        }

        const location = {
          name,
          region,
          latitude,
          longitude,
          source: "geolocation",
        };
        elements.input.value = resolvedName ? name : "";
        loadForecast(location, { intent });
      },
      (error) => {
        if (intent !== activeIntent) return;
        setControlsBusy(false);
        elements.searchStatus.textContent =
          error.code === error.PERMISSION_DENIED
            ? "Location access was declined. Search for a city instead."
            : "Your location could not be read. Search for a city instead.";
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000,
      }
    );
  }

  function attachEvents() {
    elements.form.addEventListener("submit", (event) => {
      event.preventDefault();
      handleSearch(elements.input.value);
    });

    elements.geolocateButton.addEventListener("click", handleGeolocation);
    elements.retryButton.addEventListener("click", () => {
      loadForecast(lastAttemptedLocation || currentLocation || DEFAULT_LOCATION);
    });

    elements.quickLocationButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const location = button.dataset.location;
        elements.input.value = location;
        handleSearch(location);
      });
    });
  }

  function initialize() {
    attachEvents();

    const sharedLocation = locationFromUrl();
    if (sharedLocation) {
      elements.input.value = sharedLocation.name;
      loadForecast(sharedLocation, { updateHistory: false });
      return;
    }

    const cached = readCache();
    if (cached) {
      try {
        renderPayload(cached.data, cached.location, cached.fetchedAt, true);
        elements.input.value =
          cached.location.name === "Your location" ? "" : cached.location.name;
        loadForecast(cached.location, {
          preserveContent: true,
          updateHistory: false,
        });
        return;
      } catch (error) {
        localStorage.removeItem(CACHE_KEY);
      }
    }

    // Fresh forecast data has expired, but reopen the last-used place instead of
    // resetting to the default city.
    const lastLocation = readLastLocation();
    if (lastLocation) {
      elements.input.value =
        lastLocation.name === "Your location" ? "" : lastLocation.name;
      loadForecast(lastLocation, { updateHistory: false });
      return;
    }

    elements.input.value = DEFAULT_LOCATION.name;
    loadForecast(DEFAULT_LOCATION);
  }

  initialize();
})();
