-- +goose Up
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    handle BLOB NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    last_seen_at TIMESTAMP,
    max_sessions INTEGER,
    max_session_ttl INTEGER,
    recordings_quota INTEGER,
    app_data_quota INTEGER
);

CREATE TABLE passkeys (
    id BLOB PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    credential BLOB NOT NULL,
    created_at TIMESTAMP NOT NULL,
    last_used_at TIMESTAMP
);

CREATE INDEX passkeys_user ON passkeys (user_id);

CREATE TABLE invites (
    id TEXT PRIMARY KEY,
    token_hash BLOB NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    role TEXT NOT NULL,
    user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
    domains TEXT NOT NULL,
    note TEXT NOT NULL,
    single_use BOOLEAN NOT NULL,
    expires_at TIMESTAMP,
    uses INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL
);

-- +goose Down
DROP TABLE invites;
DROP TABLE passkeys;
DROP TABLE users;
