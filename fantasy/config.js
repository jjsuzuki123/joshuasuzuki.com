(function configureRosterLab(root) {
  "use strict";

  if (!root.RosterLabConfig) {
    root.RosterLabConfig = Object.freeze({
      importEndpoint: "",
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
