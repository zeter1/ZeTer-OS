"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const smokeFiles = [
  "smoke_contacts.js",
  "smoke_contacts_integration.js",
  "smoke_web_cache.js",
  "smoke_preferences_writer.js",
  "smoke_settings_preferences.js",
  "smoke_shell_preferences.js",
  "smoke_boot_guard.js",
  "smoke_shell_runtime.js",
  "smoke_first_run_setup.js",
  "smoke_taskbar_grouping.js",
  "smoke_desktop_group_drag.js",
  "smoke_icon_layout.js",
  "smoke_desktop_appearance.js",
  "smoke_explorer_navigation.js",
  "smoke_explorer_view_persistence.js",
  "smoke_system_settings.js",
  "smoke_start_preferences.js",
  "smoke_start_preferences_queue.js",
  "smoke_window_sizes.js",
  "smoke_calendar_runtime.js",
  "smoke_calendar_persistence.js",
  "smoke_calendar_planner.js",
  "smoke_calendar_workspace.js",
  "smoke_calendar_integrations.js",
  "smoke_automation_object_links.js",
  "smoke_automation_v2_core.js",
  "smoke_automation_v2_ui.js",
  "smoke_feature7_ui.js",
  "smoke_project_overview.js",
  "smoke_project_settings.js",
  "smoke_task_categories.js",
  "smoke_notification_feature7_core.js",
  "smoke_automation_import_validation.js",
  "smoke_state_migration.js",
  "smoke_deletion.js",
  "smoke_storage_runtime.js",
  "smoke_monitor_runtime.js",
  "smoke_security_protection.js",
  "smoke_security_archive.js",
  "smoke_security_restore.js",
  "smoke_security_vault.js",
  "smoke_security_scheduler.js",
  "smoke_security_loading.js",
  "smoke_import_runtime.js",
  "smoke_export_runtime.js",
  "smoke_editor_ui.js",
  "smoke_document_editor.js",
  "smoke_managed_file_runtime.js",
  "smoke_shortcut_runtime.js",
  "smoke_link_library.js",
  "smoke_prompt_library.js",
  "smoke_business_calculations.js",
  "smoke_time_tracking.js",
  "smoke_time_tracking_upgrade.js",
  "smoke_time_tracking_management.js",
  "smoke_time_tracking_clarity.js",
  "smoke_item_customization.js",
  "smoke_search_ui.js",
  "smoke_search_index.js",
  "smoke_search_controller.js",
  "smoke_search_actions.js",
  "smoke_search_settings.js",
  "smoke_persistence_ack.js",
  "smoke_help_content.js",
  "smoke_about_ui.js",
  "smoke_update_runtime.js",
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
