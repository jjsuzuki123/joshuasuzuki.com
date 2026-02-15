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
    glow.style.transform = `translate(${lastX - 160}px, ${lastY - 160}px)`;
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

  const CONTACT_ENDPOINT =
    "https://8bijlmtfmi.execute-api.us-east-1.amazonaws.com/prod/contact";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    statusEl.textContent = "Sending...";

    const formData = new FormData(form);
    const payload = {
      name: (formData.get("name") || "").trim(),
      email: (formData.get("email") || "").trim(),
      message: (formData.get("message") || "").trim(),
    };

    try {
      const res = await fetch(CONTACT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      form.reset();
      statusEl.textContent = "Message sent.";
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Something went wrong. Please try again.";
    }
  });
})();

/* =========================
   Fastly Tenure Timer
========================= */

(function fastlyTenureTimer() {
  const el = document.getElementById("fastly-tenure-value");
  if (!el) return;

  // July 1, 2021 12:01am EST (UTC-5)
  const start = new Date("2021-07-01T00:01:00-05:00");

  function formatPart(n, unit) {
    return n ? `${n} ${unit}${n === 1 ? "" : "s"} ` : "";
  }

  function update() {
    const totalMs = Date.now() - start.getTime();
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
      `${seconds} second${seconds === 1 ? "" : "s"}`,
    ].filter(Boolean);

    el.textContent = parts.join(", ").trim();
  }

  update();
  setInterval(update, 1000);
})();

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
