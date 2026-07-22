/* =========================
   Theme (light / dark) toggle

   Loaded synchronously from <head> so the saved/preferred theme is applied
   before first paint, which avoids a flash of the wrong theme. It also wires
   up any [data-theme-toggle] controls once the DOM is ready, so the same file
   can be shared across pages without per-page glue code.
========================= */

(function () {
  "use strict";

  var STORAGE_KEY = "theme";
  var root = document.documentElement;
  var mql =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

  function storedTheme() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (err) {
      return null;
    }
  }

  function systemTheme() {
    return mql && mql.matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
  }

  // Apply as early as possible (this script runs in <head>, before <body>).
  applyTheme(storedTheme() || systemTheme());

  function currentTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function updateToggles(theme) {
    var isDark = theme === "dark";
    var label = isDark ? "Switch to light mode" : "Switch to dark mode";
    var toggles = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].setAttribute("aria-pressed", String(isDark));
      toggles[i].setAttribute("aria-label", label);
      toggles[i].setAttribute("title", label);
    }
  }

  function setTheme(theme) {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (err) {
      /* storage unavailable (private mode, etc.) — theme still applies */
    }
    updateToggles(theme);
  }

  function init() {
    updateToggles(currentTheme());

    var toggles = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].addEventListener("click", function () {
        setTheme(currentTheme() === "dark" ? "light" : "dark");
      });
    }

    // Follow OS changes until the user makes an explicit choice.
    if (mql) {
      var onSystemChange = function (event) {
        if (storedTheme()) return;
        applyTheme(event.matches ? "dark" : "light");
        updateToggles(currentTheme());
      };
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", onSystemChange);
      } else if (typeof mql.addListener === "function") {
        mql.addListener(onSystemChange);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
