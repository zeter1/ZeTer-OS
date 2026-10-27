-- Additive only: accepted heads, operation receipts and reservations are retained.
CREATE TABLE IF NOT EXISTS sync_root_replacements (
  account_key TEXT NOT NULL,
  old_root_folder_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  root_folder_id TEXT NOT NULL,
  bootstrap_json TEXT NOT NULL,
  PRIMARY KEY (account_key, old_root_folder_id, generation)
);
