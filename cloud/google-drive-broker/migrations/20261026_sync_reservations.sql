-- Additive and repeatable. Preserves sessions, heads, receipts and all Drive data.
CREATE TABLE IF NOT EXISTS sync_bootstrap (
  account_key TEXT PRIMARY KEY,
  root_folder_id TEXT NOT NULL,
  bootstrap_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS directory_reservations (
  account_key TEXT NOT NULL,
  root_folder_id TEXT NOT NULL,
  path_key TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  file_id TEXT NOT NULL,
  PRIMARY KEY (account_key, root_folder_id, path_key)
);
