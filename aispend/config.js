(function configureSpendscope(root) {
  "use strict";

  if (!root.SpendscopeConfig) {
    root.SpendscopeConfig = Object.freeze({
      apiEndpoint: "",
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
