(function wirePopup() {
  "use strict";

  document.getElementById("open-rosterlab").addEventListener("click", async () => {
    await chrome.tabs.create({
      url: "https://www.joshuasuzuki.com/fantasy/",
      active: true,
    });
    window.close();
  });
})();
