(function configureSpendscope(root) {
  "use strict";

  if (!root.SpendscopeConfig) {
    root.SpendscopeConfig = Object.freeze({
      apiEndpoint: "",
      suggestEndpoint: "",
      gated: false,
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
