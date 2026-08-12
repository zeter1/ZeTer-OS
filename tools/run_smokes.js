"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const smokeFiles = [
  "smoke_boot_guard.js",
  "smoke_shell_runtime.js",
  "smoke_desktop_group_drag.js",
  "smoke_explorer_navigation.js",
  "smoke_system_settings.js",
  "smoke_calendar_runtime.js",
  "smoke_state_migration.js",
  "smoke_storage_runtime.js",
  "smoke_monitor_runtime.js",
  "smoke_security_protection.js",
  "smoke_import_runtime.js",
  "smoke_export_runtime.js",
  "smoke_editor_ui.js",
  "smoke_managed_file_runtime.js",
  "smoke_shortcut_runtime.js",
  "smoke_item_customization.js",
  "smoke_help_content.js",
];

for (const smokeFile of smokeFiles) {
  const scriptPath = path.join(__dirname, smokeFile);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 10000,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}

if (!process.exitCode) {
  console.log(`scenario smoke suite: ok (${smokeFiles.length} files)`);
}
