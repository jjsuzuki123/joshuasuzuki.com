(function reportEspnLeagueLocation() {
  "use strict";

  const WORKER_SCOPE = "rosterlab-espn-worker";
  const FETCH_TIMEOUT_MS = 20_000;
  const ID_PATTERN = /^\d{1,20}$/;
  const SEASON_PATTERN = /^20\d{2}$/;
  const VIEWS = ["mTeam", "mRoster", "mSettings", "mStandings"];
  let lastReportedUrl = "";
  let activeFetch = null;

  function report(force) {
    const url = window.location.href;
    if (!force && url === lastReportedUrl) return;
    lastReportedUrl = url;
    void chrome.runtime
      .sendMessage({
        scope: WORKER_SCOPE,
        type: "espn-location",
        url,
      })
      .catch(() => {
        // The extension may be updating while this ESPN tab remains open.
      });
  }

  function validReference(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const leagueId = String(value.leagueId || "").trim();
    const season = String(value.season || "").trim();
    const teamId = String(value.teamId || "").trim();
    if (
      !ID_PATTERN.test(leagueId) ||
      !SEASON_PATTERN.test(season) ||
      (teamId && !ID_PATTERN.test(teamId))
    ) {
      return null;
    }
    return { leagueId, season, teamId: teamId || null };
  }

  function leagueApiUrl(reference) {
    const url = new URL(
      `/apis/v3/games/flb/seasons/${reference.season}/segments/0/leagues/${reference.leagueId}`,
      "https://lm-api-reads.fantasy.espn.com"
    );
    VIEWS.forEach((view) => url.searchParams.append("view", view));
    return url.href;
  }

  async function fetchLeague(message) {
    const reference = validReference(message.reference);
    if (!reference) {
      return {
        ok: false,
        code: "INVALID_LEAGUE_REFERENCE",
        message: "ESPN did not provide a valid baseball league link.",
      };
    }

    if (activeFetch) activeFetch.controller.abort();
    const controller = new AbortController();
    const request = {
      requestId: message.requestId,
      attemptToken: message.attemptToken,
      controller,
      timedOut: false,
    };
    activeFetch = request;
    const timeoutId = window.setTimeout(() => {
      request.timedOut = true;
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(leagueApiUrl(reference), {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          code: "ESPN_AUTH_REQUIRED",
          message: "Sign in to ESPN to access this league.",
        };
      }
      if (response.status === 404) {
        return {
          ok: false,
          code: "ESPN_LEAGUE_NOT_FOUND",
          message: "ESPN could not find that league for this season.",
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          code: "ESPN_REQUEST_FAILED",
          message: `ESPN returned ${response.status}. Try again in a moment.`,
        };
      }
      const contentType = response.headers.get("content-type") || "";
      if (
        response.redirected ||
        (contentType && !contentType.toLowerCase().includes("json"))
      ) {
        return {
          ok: false,
          code: "ESPN_AUTH_REQUIRED",
          message: "Sign in to ESPN to access this league.",
        };
      }
      const payload = await response.json().catch(() => null);
      if (!payload || !Array.isArray(payload.teams) || payload.teams.length < 2) {
        return {
          ok: false,
          code: "ESPN_INVALID_RESPONSE",
          message: "ESPN returned league data RosterLab could not read.",
        };
      }
      return { ok: true, payload };
    } catch (error) {
      if (error?.name === "AbortError") {
        return {
          ok: false,
          code: request.timedOut ? "ESPN_TIMEOUT" : "CANCELED",
          message: request.timedOut
            ? "ESPN took too long to respond. Try again."
            : "The ESPN request was canceled.",
        };
      }
      return {
        ok: false,
        code: "ESPN_UNAVAILABLE",
        message: "The ESPN tab could not reach the league API.",
      };
    } finally {
      window.clearTimeout(timeoutId);
      if (activeFetch === request) activeFetch = null;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (
      sender.id !== chrome.runtime.id ||
      !message ||
      message.scope !== WORKER_SCOPE
    ) {
      return false;
    }
    if (message.type === "cancel-fetch") {
      if (
        activeFetch &&
        activeFetch.requestId === message.requestId &&
        activeFetch.attemptToken === message.attemptToken
      ) {
        activeFetch.controller.abort();
      }
      sendResponse({ ok: true });
      return false;
    }
    if (
      message.type !== "fetch-league" ||
      typeof message.requestId !== "string" ||
      typeof message.attemptToken !== "string"
    ) {
      return false;
    }
    void fetchLeague(message).then(sendResponse);
    return true;
  });

  window.addEventListener("pageshow", () => report(true));
  window.addEventListener("popstate", () => report(false));
  window.addEventListener("hashchange", () => report(false));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") report(true);
  });

  report(true);
  window.setInterval(() => report(false), 1_000);
})();
