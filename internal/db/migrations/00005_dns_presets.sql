-- +goose Up
CREATE TABLE dns_presets (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    settings TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE INDEX dns_presets_owner ON dns_presets (owner);

-- +goose Down
DROP TABLE dns_presets;
