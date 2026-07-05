(function startAfterglow() {
  "use strict";

  const scoring = window.SunsetScoring;
  if (!scoring) {
    throw new Error("Sunset scoring engine failed to load.");
  }

  const API = {
    weather: "https://api.open-meteo.com/v1/forecast",
    air: "https://air-quality-api.open-meteo.com/v1/air-quality",
    geocoding: "https://geocoding-api.open-meteo.com/v1/search",
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

  const CACHE_KEY = "afterglow:forecast:v1";
  const CACHE_MAX_AGE = 20 * 60 * 1000;
  const REQUEST_TIMEOUT = 9000;

  const elements = {
    form: document.getElementById("location-form"),
    input: document.getElementById("location-input"),
    geolocateButton: document.getElementById("geolocate-button"),
    searchStatus: document.getElementById("search-status"),
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
  let selectedForecastIndex = 0;

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
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

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
    } finally {
      window.clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", abortFromParent);
      }
    }
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

    return { weather, air };
  }

  function shiftLocalTime(isoLocalTime, minutes) {
    const key = scoring.localTimeKey(isoLocalTime);
    if (key === null) return isoLocalTime;
    return new Date(key + minutes * 60000).toISOString().slice(0, 16);
  }

  function buildForecasts(weather, air) {
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
      const sunsetEpoch = scoring.localTimeToEpoch(
        sunset,
        weather.utc_offset_seconds
      );
      const hoursAhead =
        sunsetEpoch === null ? null : (sunsetEpoch - now) / (60 * 60 * 1000);

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
      });

      return {
        date: dates[index] || sunset.slice(0, 10),
        sunset,
        sunsetEpoch,
        sample,
        hourBefore,
        airSample,
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
    const { result, sample, hourBefore, airSample } = forecast;
    const componentMap = Object.fromEntries(
      result.components.map((component) => [component.id, component])
    );

    const lowCloud = sample.cloud_cover_low;
    const previousLowCloud = hourBefore ? hourBefore.cloud_cover_low : null;
    const trend =
      Number.isFinite(lowCloud) && Number.isFinite(previousLowCloud)
        ? lowCloud - previousLowCloud
        : null;

    let horizonNote = "Lower cloud means a clearer line to the setting sun.";
    if (trend !== null && trend <= -8) {
      horizonNote = "Low cloud is clearing as sunset approaches.";
    } else if (trend !== null && trend >= 8) {
      horizonNote = "Low cloud is building near the sunset window.";
    }

    const aerosolValue = airSample ? airSample.aerosol_optical_depth : null;

    return [
      {
        component: componentMap.cloudCanvas,
        icon: "CLD",
        color: "#ff7b6b",
        raw: `${roundPercent(sample.cloud_cover_mid)} mid · ${roundPercent(sample.cloud_cover_high)} high`,
        note: "Partial elevated cloud gives sunlight a surface to color.",
      },
      {
        component: componentMap.horizon,
        icon: "HRZ",
        color: "#ffb45f",
        raw: `${roundPercent(lowCloud)} low cloud`,
        note: horizonNote,
      },
      {
        component: componentMap.visibility,
        icon: "VIS",
        color: "#d9b6ff",
        raw: formatVisibility(sample.visibility),
        note: "Long visibility keeps distant color and cloud edges distinct.",
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
        note: "Very humid air raises the risk of haze or fog.",
      },
      {
        component: componentMap.aerosol,
        icon: "AOD",
        color: "#ffe7a5",
        raw: Number.isFinite(aerosolValue)
          ? `Optical depth ${aerosolValue.toFixed(2)}`
          : "Data unavailable",
        note: Number.isFinite(aerosolValue)
          ? "A little haze can deepen warm color; too much hides it."
          : "This input was removed and the other weights were rebalanced.",
      },
    ];
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
    weight.textContent = `${metric.component.weight}% weight`;
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
    meter.setAttribute(
      "aria-label",
      `${metric.component.label} favorability ${
        metric.component.percent === null ? "unavailable" : `${metric.component.percent} percent`
      }`
    );

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
    button.setAttribute("role", "listitem");
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
    });

    return button;
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
      result.confidence.value >= 80
        ? "#7ddbd0"
        : result.confidence.value >= 62
          ? "#ffbd6f"
          : "#ff8067";

    elements.sunsetTime.textContent = formatLocalTime(forecast.sunset);
    elements.viewingWindow.textContent = `${formatLocalTime(
      shiftLocalTime(forecast.sunset, -25)
    )} to ${formatLocalTime(shiftLocalTime(forecast.sunset, 25))}`;
    elements.timezoneLabel.textContent =
      currentPayload.weather.timezone_abbreviation ||
      currentPayload.weather.timezone ||
      "Local time";

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
    elements.forecastDays.replaceChildren(
      ...currentPayload.forecasts.map(makeDayCard)
    );
  }

  function renderPayload(payload, location, fetchedAt, cached) {
    const forecasts = buildForecasts(payload.weather, payload.air);
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
    elements.dataFreshness.textContent = cached ? "Updating cached forecast" : "Updated now";
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
      error && error.name === "AbortError"
        ? "The weather request timed out. Please try again."
        : error && error.message
          ? error.message
          : "The weather service did not respond. Try again in a moment.";

    elements.forecastSection.setAttribute("aria-busy", "false");
    elements.loading.hidden = true;
    if (preserveContent && !elements.content.hidden) {
      elements.searchStatus.textContent = `Could not refresh: ${message}`;
      return;
    }

    elements.content.hidden = true;
    elements.errorMessage.textContent = message;
    elements.error.hidden = false;
  }

  function setControlsBusy(busy) {
    elements.form.querySelector('button[type="submit"]').disabled = busy;
    elements.geolocateButton.disabled = busy;
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
    const settings = { preserveContent: false, updateHistory: true, ...options };
    if (activeForecastController) activeForecastController.abort();

    const controller = new AbortController();
    activeForecastController = controller;
    showLoading(settings.preserveContent);
    setControlsBusy(true);
    elements.searchStatus.textContent = `Reading the sky above ${location.name}…`;

    try {
      const data = await fetchForecastData(location, controller.signal);
      if (controller.signal.aborted) return;

      const fetchedAt = Date.now();
      renderPayload(data, location, fetchedAt, false);
      writeCache(location, data, fetchedAt);
      if (settings.updateHistory) updateUrl(location);
      elements.searchStatus.textContent = `Live forecast ready for ${location.name}.`;
    } catch (error) {
      if (controller.signal.aborted && activeForecastController !== controller) return;
      showError(error, settings.preserveContent);
    } finally {
      if (activeForecastController === controller) {
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

  async function handleSearch(query) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      elements.input.focus();
      return;
    }

    elements.searchStatus.textContent = `Finding ${normalizedQuery}…`;
    setControlsBusy(true);
    try {
      const location = await geocode(normalizedQuery);
      elements.input.value = location.name;
      await loadForecast(location);
    } catch (error) {
      if (error.name !== "AbortError") {
        elements.searchStatus.textContent =
          error.message || "That location could not be found.";
      }
      setControlsBusy(false);
    }
  }

  function handleGeolocation() {
    if (!navigator.geolocation) {
      elements.searchStatus.textContent =
        "Location access is not available in this browser. Search for a city instead.";
      return;
    }

    setControlsBusy(true);
    elements.searchStatus.textContent = "Getting your location…";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          name: "Current location",
          region: `${position.coords.latitude.toFixed(2)}, ${position.coords.longitude.toFixed(2)}`,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        elements.input.value = "";
        loadForecast(location);
      },
      (error) => {
        setControlsBusy(false);
        elements.searchStatus.textContent =
          error.code === error.PERMISSION_DENIED
            ? "Location access was declined. Search for a city instead."
            : "Your location could not be read. Search for a city instead.";
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 10 * 60 * 1000,
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
      loadForecast(currentLocation || DEFAULT_LOCATION);
    });

    document.querySelectorAll("[data-location]").forEach((button) => {
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
          cached.location.name === "Current location" ? "" : cached.location.name;
        loadForecast(cached.location, {
          preserveContent: true,
          updateHistory: false,
        });
        return;
      } catch (error) {
        localStorage.removeItem(CACHE_KEY);
      }
    }

    elements.input.value = DEFAULT_LOCATION.name;
    loadForecast(DEFAULT_LOCATION);
  }

  initialize();
})();
