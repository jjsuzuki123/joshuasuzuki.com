/* =========================
   Utilities
========================= */

(function updateYear() {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();

/* =========================
   Cursor Glow
========================= */

(function cursorGlow() {
  const glow = document.querySelector(".cursor-glow");
  if (!glow) return;

  let rafId = null;
  let lastX = -9999;
  let lastY = -9999;
  let isActive = false;

  function render() {
    rafId = null;
    glow.style.transform = `translate(${lastX - 180}px, ${lastY - 180}px)`;
  }

  function onMove(e) {
    lastX = e.clientX;
    lastY = e.clientY;

    if (!isActive) {
      isActive = true;
      glow.style.opacity = "1";
    }

    if (!rafId) rafId = requestAnimationFrame(render);
  }

  function onLeave() {
    isActive = false;
    glow.style.opacity = "0";
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseleave", onLeave);
  window.addEventListener("blur", onLeave);
})();

/* =========================
   Contact Form
========================= */

(function contactForm() {
  const form = document.getElementById("contact-form");
  if (!form) return;

  const statusEl = document.getElementById("contact-status");
  const submitBtn = form.querySelector('button[type="submit"]');

  const CONTACT_ENDPOINT =
    "https://8bijlmtfmi.execute-api.us-east-1.amazonaws.com/prod/contact";

  const MAX = { name: 100, email: 200, message: 5000 };
  let inFlight = false;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (inFlight) return;

    const formData = new FormData(form);

    // Honeypot: silently drop bot submissions that filled the hidden field.
    const honeypot = (formData.get("website") || "").toString();
    if (honeypot.trim() !== "") {
      statusEl.textContent = "Message sent.";
      form.reset();
      return;
    }

    const name = (formData.get("name") || "").toString().trim();
    const email = (formData.get("email") || "").toString().trim();
    const message = (formData.get("message") || "").toString().trim();

    if (!name || !email || !message) {
      statusEl.textContent = "Please fill out all fields.";
      return;
    }
    if (
      name.length > MAX.name ||
      email.length > MAX.email ||
      message.length > MAX.message
    ) {
      statusEl.textContent = "Input too long. Please shorten and try again.";
      return;
    }

    inFlight = true;
    if (submitBtn) submitBtn.disabled = true;
    statusEl.textContent = "Sending...";

    try {
      const res = await fetch(CONTACT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      form.reset();
      statusEl.textContent = "Message sent.";
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Something went wrong. Please try again.";
    } finally {
      inFlight = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  });
})();

/* =========================
   Cursor Tenure Timer
========================= */

function initCursorTenureTimer() {
  const el = document.getElementById("cursor-tenure-value");
  if (!el) return;

  // Monday, March 2, 2026 9:00am PT = 17:00 UTC (month is 0-indexed)
  const start = new Date(Date.UTC(2026, 2, 2, 17, 0, 0, 0));
  const startMs = start.getTime();
  if (Number.isNaN(startMs)) {
    el.textContent = "—";
    return;
  }

  function formatPart(n, unit) {
    if (n === 0) return "";
    return n + " " + unit + (n === 1 ? "" : "s");
  }

  function update() {
    try {
      const totalMs = Date.now() - startMs;
      if (totalMs < 0) {
        el.textContent = "—";
        return;
      }
      const totalSeconds = Math.floor(totalMs / 1000);
      const seconds = totalSeconds % 60;
      const totalMinutes = Math.floor(totalSeconds / 60);
      const minutes = totalMinutes % 60;
      const totalHours = Math.floor(totalMinutes / 60);
      const hours = totalHours % 24;
      const totalDays = Math.floor(totalHours / 24);
      const years = Math.floor(totalDays / 365);
      const days = totalDays % 365;

      const parts = [
        formatPart(years, "year"),
        formatPart(days, "day"),
        formatPart(hours, "hour"),
        formatPart(minutes, "minute"),
        formatPart(seconds, "second"),
      ].filter(Boolean);

      el.textContent = parts.length ? parts.join(", ") : "0 seconds";
    } catch (err) {
      el.textContent = "—";
    }
  }

  update();
  const intervalId = setInterval(update, 1000);

  function cleanup() {
    clearInterval(intervalId);
    if (observer) observer.disconnect();
    document.removeEventListener("pagehide", onPageHide);
  }

  function onPageHide() {
    cleanup();
  }

  let observer = null;
  const parent = el.parentNode;
  if (parent) {
    observer = new MutationObserver(() => {
      if (!document.contains(el)) {
        cleanup();
      }
    });
    observer.observe(parent, { childList: true, subtree: true });
  }
  document.addEventListener("pagehide", onPageHide);
}

function runWhenReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn);
  } else {
    fn();
  }
}
runWhenReady(initCursorTenureTimer);

/* =========================
   Timeline Highlight (viewport-based)
========================= */

(function timelineHighlight() {
  const items = document.querySelectorAll(".timeline-item");
  if (!items.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        items.forEach((i) => i.classList.remove("is-active"));
        entry.target.classList.add("is-active");
      });
    },
    { root: null, threshold: 0.6 }
  );

  items.forEach((item) => observer.observe(item));
})();
