(function configureRosterLab(root) {
  "use strict";

  if (!root.RosterLabConfig) {
    root.RosterLabConfig = Object.freeze({
      importEndpoint: "",
      sourceEndpoint: "",
      // Set this after the Chrome Web Store listing is approved.
      connectorInstallUrl: "",
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
