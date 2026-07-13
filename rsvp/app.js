(function rsvpApp() {
  "use strict";

  const config = (typeof globalThis !== "undefined" && globalThis.RsvpConfig) || {};
  const API_BASE = (config.apiBase || "").replace(/\/$/, "");

  const LOGIN_ENDPOINT = `${API_BASE}/rsvp/login`;
  const RESTAURANTS_ENDPOINT = `${API_BASE}/rsvp/restaurants`;
  const REQUESTS_ENDPOINT = `${API_BASE}/rsvp/requests`;
  const requestEndpoint = (id) => `${REQUESTS_ENDPOINT}/${encodeURIComponent(id)}`;

  const TOKEN_KEY = "rsvpToken";
  const ET_TZ = "America/New_York";

  // ---- DOM ----
  const loginView = document.getElementById("login-view");
  const newView = document.getElementById("new-view");
  const requestsView = document.getElementById("requests-view");

  const loginForm = document.getElementById("login-form");
  const passwordInput = document.getElementById("password");
  const loginStatus = document.getElementById("login-status");
  const logoutBtn = document.getElementById("logout-btn");

  const snipeForm = document.getElementById("snipe-form");
  const restaurantSelect = document.getElementById("restaurant");
  const customFields = document.getElementById("custom-fields");
  const overrideToggle = document.getElementById("overrideToggle");
  const overrideFields = document.getElementById("override-fields");
  const releasePreview = document.getElementById("release-preview");
  const snipeStatus = document.getElementById("snipe-status");
  const snipeSubmit = document.getElementById("snipe-submit");

  const refreshBtn = document.getElementById("refresh-btn");
  const requestsBody = document.getElementById("requests-body");
  const requestsStatus = document.getElementById("requests-status");
  const requestsCount = document.getElementById("requests-count");

  let authToken = null;
  let restaurants = [];
  let refreshTimer = null;

  // ---- Token helpers ----
  function setToken(token) {
    authToken = token;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      /* ignore storage errors */
    }
  }
  function getToken() {
    if (authToken) return authToken;
    try {
      authToken = localStorage.getItem(TOKEN_KEY);
    } catch (e) {
      authToken = null;
    }
    return authToken;
  }

  // ---- Views ----
  function showLoggedOut(message) {
    loginView.classList.remove("hidden");
    newView.classList.add("hidden");
    requestsView.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    stopAutoRefresh();
    if (message) loginStatus.textContent = message;
  }
  function showLoggedIn() {
    loginView.classList.add("hidden");
    newView.classList.remove("hidden");
    requestsView.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
  }

  // ---- API helper ----
  async function api(path, options = {}) {
    const token = getToken();
    const headers = Object.assign({}, options.headers || {});
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body) headers["Content-Type"] = "application/json";
    const res = await fetch(path, { ...options, headers });
    if (res.status === 401) {
      setToken(null);
      showLoggedOut("Session expired. Please log in again.");
      throw new Error("unauthorized");
    }
    return res;
  }

  // ---- Login ----
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      loginStatus.textContent = "Logging in...";
      try {
        const res = await fetch(LOGIN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: passwordInput.value || "" }),
        });
        if (!res.ok) {
          loginStatus.textContent =
            res.status === 401 ? "Incorrect password." : `Login failed (HTTP ${res.status}).`;
          return;
        }
        const data = await res.json();
        if (!data.token) {
          loginStatus.textContent = "No token returned.";
          return;
        }
        setToken(data.token);
        loginStatus.textContent = "";
        passwordInput.value = "";
        await enterApp();
      } catch (err) {
        loginStatus.textContent = "Unexpected error logging in.";
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      setToken(null);
      showLoggedOut("Logged out.");
    });
  }

  // ---- Restaurants ----
  async function loadRestaurants() {
    try {
      const res = await api(RESTAURANTS_ENDPOINT);
      if (!res.ok) return;
      const data = await res.json();
      restaurants = Array.isArray(data.restaurants) ? data.restaurants : [];
      populateRestaurantSelect();
    } catch (err) {
      /* handled by api() for 401 */
    }
  }

  function populateRestaurantSelect() {
    restaurantSelect.replaceChildren();
    const sorted = [...restaurants].sort((a, b) => a.name.localeCompare(b.name));
    for (const r of sorted) {
      const opt = document.createElement("option");
      opt.value = r.slug;
      opt.textContent = r.autoBook
        ? `${r.name} — ${r.neighborhood}`
        : `${r.name} — ${r.neighborhood} (reminder only)`;
      restaurantSelect.appendChild(opt);
    }
    const custom = document.createElement("option");
    custom.value = "__custom__";
    custom.textContent = "Custom Resy venue…";
    restaurantSelect.appendChild(custom);
    updateFormForSelection();
  }

  function selectedRestaurant() {
    const slug = restaurantSelect.value;
    if (slug === "__custom__") return null;
    return restaurants.find((r) => r.slug === slug) || null;
  }

  // ---- Release rule summary + preview ----
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function describeRule(rule) {
    if (!rule) return "";
    const time = rule.time || "10:00";
    switch (rule.type) {
      case "daily":
        return `Opens ${rule.daysOut} days ahead at ${time} ET, daily.`;
      case "weekly": {
        const wd = typeof rule.weekday === "number" ? WEEKDAYS[rule.weekday] : capitalize(rule.weekday);
        return `Opens on ${wd}s at ${time} ET (${rule.daysOut} days ahead).`;
      }
      case "monthly":
        return `Opens ${rule.monthsBefore} month(s) ahead on day ${rule.dayOfMonth} at ${time} ET.`;
      case "manual":
        return `Opens ${rule.releaseDate} at ${time} ET.`;
      default:
        return "";
    }
  }

  function capitalize(s) {
    s = String(s || "");
    return s ? s[0].toUpperCase() + s.slice(1) : s;
  }

  function updateReleasePreview() {
    const restaurant = selectedRestaurant();
    let text = "";
    if (overrideToggle.checked) {
      const d = document.getElementById("releaseDate").value;
      const t = document.getElementById("releaseTime").value || "10:00";
      text = d ? `Manual release: ${d} at ${t} ET.` : "Set a manual release date.";
    } else if (restaurant) {
      text = describeRule(restaurant.release);
      if (!restaurant.autoBook) {
        text += " This venue is reminder-only (not auto-booked).";
      }
    } else {
      text = "Custom venue: set a manual release, or the bot uses a daily rule you provide.";
    }
    releasePreview.textContent = text;
    releasePreview.classList.toggle("hidden", !text);
  }

  function updateFormForSelection() {
    const isCustom = restaurantSelect.value === "__custom__";
    customFields.classList.toggle("hidden", !isCustom);
    updateReleasePreview();
  }

  // ---- Create snipe ----
  function buildPayload() {
    const restaurant = selectedRestaurant();
    const payload = {
      diningDate: document.getElementById("diningDate").value,
      partySize: Number(document.getElementById("partySize").value),
      earliest: document.getElementById("earliest").value,
      latest: document.getElementById("latest").value,
      bestInWindow: document.getElementById("bestInWindow").checked,
    };
    const seating = document.getElementById("seatingPreference").value.trim();
    if (seating) payload.seatingPreference = seating;

    if (restaurant) {
      payload.restaurantSlug = restaurant.slug;
    } else {
      payload.restaurantName = document.getElementById("restaurantName").value.trim();
      const slug = document.getElementById("resySlug").value.trim();
      const venueId = document.getElementById("resyVenueId").value.trim();
      if (slug) payload.resySlug = slug;
      if (venueId) payload.resyVenueId = Number(venueId);
    }

    if (overrideToggle.checked) {
      const releaseDate = document.getElementById("releaseDate").value;
      const releaseTime = document.getElementById("releaseTime").value || "10:00";
      // Sent as a DST-safe manual rule; the server resolves it in ET.
      payload.releaseRule = {
        type: "manual",
        releaseDate,
        time: releaseTime,
        tz: ET_TZ,
      };
    }
    return payload;
  }

  if (snipeForm) {
    snipeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      snipeStatus.textContent = "Scheduling...";
      snipeSubmit.disabled = true;
      try {
        const payload = buildPayload();
        const res = await api(REQUESTS_ENDPOINT, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          snipeStatus.textContent = data.message || `Failed (HTTP ${res.status}).`;
          return;
        }
        snipeStatus.textContent = data.item?.releaseExplanation
          ? `Scheduled. ${data.item.releaseExplanation}`
          : "Scheduled.";
        snipeForm.reset();
        document.getElementById("partySize").value = "2";
        document.getElementById("earliest").value = "19:00";
        document.getElementById("latest").value = "21:00";
        document.getElementById("bestInWindow").checked = true;
        updateFormForSelection();
        await loadRequests();
      } catch (err) {
        if (err.message !== "unauthorized") {
          snipeStatus.textContent = "Unexpected error scheduling the snipe.";
        }
      } finally {
        snipeSubmit.disabled = false;
      }
    });
  }

  restaurantSelect.addEventListener("change", updateFormForSelection);
  overrideToggle.addEventListener("change", () => {
    overrideFields.classList.toggle("hidden", !overrideToggle.checked);
    updateReleasePreview();
  });
  ["releaseDate", "releaseTime"].forEach((id) => {
    document.getElementById(id).addEventListener("change", updateReleasePreview);
  });

  // ---- Requests list ----
  function formatET(iso) {
    if (!iso) return "";
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return iso;
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: ET_TZ,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(ms));
    } catch (e) {
      return new Date(ms).toISOString();
    }
  }

  function notesFor(item) {
    if (item.result?.reservationId) {
      const slot = item.result.slot;
      return `Booked ${slot?.time || ""}${slot?.seatingType ? ` · ${slot.seatingType}` : ""} · #${item.result.reservationId}`;
    }
    if (item.result?.message) return item.result.message;
    return item.releaseExplanation || "";
  }

  async function loadRequests() {
    requestsStatus.textContent = "Loading...";
    try {
      const res = await api(REQUESTS_ENDPOINT);
      if (!res.ok) {
        requestsStatus.textContent = `Failed to load (HTTP ${res.status}).`;
        return;
      }
      const data = await res.json();
      renderRequests(Array.isArray(data.items) ? data.items : []);
      requestsStatus.textContent = "";
    } catch (err) {
      if (err.message !== "unauthorized") {
        requestsStatus.textContent = "Unexpected error loading snipes.";
      }
    }
  }

  function renderRequests(items) {
    requestsBody.replaceChildren();
    requestsCount.textContent = String(items.length);

    if (!items.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 8;
      td.textContent = "No snipes scheduled yet.";
      td.className = "notes";
      tr.appendChild(td);
      requestsBody.appendChild(tr);
      return;
    }

    for (const item of items) {
      const tr = document.createElement("tr");
      appendCell(tr, item.restaurantName || item.restaurantSlug || "");
      appendCell(tr, item.diningDate || "");
      appendCell(tr, String(item.partySize || ""));
      appendCell(tr, `${item.window?.earliest || ""}–${item.window?.latest || ""}`);
      appendCell(tr, formatET(item.releaseAt));

      const statusCell = document.createElement("td");
      const badge = document.createElement("span");
      const status = item.status || "scheduled";
      badge.className = `badge ${status}`;
      badge.textContent = status;
      statusCell.appendChild(badge);
      tr.appendChild(statusCell);

      const notesCell = document.createElement("td");
      notesCell.className = "notes";
      notesCell.textContent = notesFor(item);
      tr.appendChild(notesCell);

      const actionCell = document.createElement("td");
      const del = document.createElement("button");
      del.type = "button";
      del.className = "delete-btn";
      del.textContent = ["booked", "missed", "failed", "reminded"].includes(status)
        ? "Remove"
        : "Cancel";
      del.dataset.id = item.id;
      actionCell.appendChild(del);
      tr.appendChild(actionCell);

      requestsBody.appendChild(tr);
    }
  }

  function appendCell(tr, text) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }

  requestsBody.addEventListener("click", async (event) => {
    const target = event.target;
    if (!target.classList.contains("delete-btn")) return;
    const id = target.dataset.id;
    if (!id) return;
    if (!window.confirm("Remove this snipe? If it hasn't fired yet, it will be cancelled.")) return;
    try {
      const res = await api(requestEndpoint(id), { method: "DELETE" });
      if (res.ok || res.status === 204) {
        await loadRequests();
      } else {
        requestsStatus.textContent = `Failed to remove (HTTP ${res.status}).`;
      }
    } catch (err) {
      if (err.message !== "unauthorized") {
        requestsStatus.textContent = "Unexpected error removing the snipe.";
      }
    }
  });

  if (refreshBtn) refreshBtn.addEventListener("click", loadRequests);

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(loadRequests, 30_000);
  }
  function stopAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  }

  // ---- Boot ----
  async function enterApp() {
    if (!API_BASE) {
      loginStatus.textContent = "API endpoint is not configured yet.";
      snipeStatus.textContent = "";
    }
    showLoggedIn();
    await loadRestaurants();
    await loadRequests();
    startAutoRefresh();
  }

  (function init() {
    if (!API_BASE) {
      // Still show the login UI, but make the misconfiguration visible.
      loginStatus.textContent = "Waiting on API configuration (rsvp/config.js).";
    }
    if (getToken()) {
      enterApp();
    } else {
      showLoggedOut();
    }
  })();
})();
