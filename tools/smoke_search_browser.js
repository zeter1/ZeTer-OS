"use strict";
// Compatibility entrypoint. The unified acceptance suite owns the current UI contract.
// Import has no startup, browser or storage side effects.
const { runSearchUpgradeSmoke } = require("./smoke_search_upgrade_browser");
module.exports = { runSearchSmoke: runSearchUpgradeSmoke };
