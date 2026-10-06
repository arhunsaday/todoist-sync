CREATE TABLE billing_events (event_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, subscription_id TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX billing_events_pending ON billing_events(user_id,status);
CREATE TABLE provider_secrets (key TEXT PRIMARY KEY, encrypted_value TEXT NOT NULL, created_at INTEGER NOT NULL);
