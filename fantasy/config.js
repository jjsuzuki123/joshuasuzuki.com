(function configureRosterLab(root) {
  "use strict";

  root.RosterLabConfig = Object.freeze({
    importEndpoint: "https://5mdog6ljjk.execute-api.us-east-1.amazonaws.com/production/league/import",
    // Set this after the Chrome Web Store listing is approved.
    connectorInstallUrl: "",
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
