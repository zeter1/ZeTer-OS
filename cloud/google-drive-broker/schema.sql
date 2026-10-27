CREATE TABLE IF NOT EXISTS oauth_pending (
  state_hash TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier_cipher TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_pending_expiry ON oauth_pending(expires_at);
CREATE TABLE IF NOT EXISTS sessions (
  handle_hash TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  account_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('web', 'native')),
  refresh_cipher TEXT,
  expires_at INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS start_limits (
  bucket_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS start_limits_expiry ON start_limits(expires_at);
CREATE TABLE IF NOT EXISTS sync_heads (
  account_key TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  head_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_operations (
  account_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  head_json TEXT NOT NULL,
  PRIMARY KEY (account_key, operation_id)
);
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
CREATE TABLE IF NOT EXISTS sync_root_replacements (
  account_key TEXT NOT NULL,
  old_root_folder_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  root_folder_id TEXT NOT NULL,
  bootstrap_json TEXT NOT NULL,
  PRIMARY KEY (account_key, old_root_folder_id, generation)
);
