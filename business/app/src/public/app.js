// SiteRamp client-side niceties. The app works fully without JavaScript;
// this file only adds polling on the scan-progress page, copy buttons, and
// confirmation prompts.
(function () {
  "use strict";

  // 1) Scan progress polling.
  var progress = document.querySelector("[data-scan-poll]");
  if (progress) {
    var scanId = progress.getAttribute("data-scan-poll");
    var statusLine = document.getElementById("scan-status-line");
    var failures = 0;
    var timer = setInterval(function () {
      fetch("/scans/" + scanId + "/status", { credentials: "same-origin" })
        .then(function (res) {
          if (!res.ok) throw new Error("status " + res.status);
          return res.json();
        })
        .then(function (data) {
          failures = 0;
          if (data.status === "done" || data.status === "failed") {
            clearInterval(timer);
            window.location.reload();
          } else if (statusLine) {
            statusLine.textContent =
              data.status === "queued"
                ? "Waiting in queue" + (data.queuePosition > 1 ? " (position " + data.queuePosition + ")" : "") + "…"
                : "Scanning pages…";
          }
        })
        .catch(function () {
          failures++;
          if (failures > 20) clearInterval(timer); // stop hammering if something is wrong
        });
    }, 3000);
  }

  // 2) Copy-to-clipboard buttons.
  document.querySelectorAll("[data-copy-target]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var input = document.querySelector(btn.getAttribute("data-copy-target"));
      if (!input) return;
      input.select();
      var done = function () {
        var old = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(function () {
          btn.textContent = old;
        }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(done, done);
      } else {
        try { document.execCommand("copy"); } catch (e) { /* noop */ }
        done();
      }
    });
  });

  // 3) Confirmation prompts on destructive forms.
  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (evt) {
      if (!window.confirm(form.getAttribute("data-confirm"))) evt.preventDefault();
    });
  });

  // 4) Disable submit buttons after first click (double-submit guard).
  document.querySelectorAll("form").forEach(function (form) {
    form.addEventListener("submit", function () {
      var btn = form.querySelector("button[type=submit]");
      if (btn && !form.hasAttribute("data-no-disable")) {
        setTimeout(function () { btn.disabled = true; }, 0);
      }
    });
  });
})();
