-- +goose Up
CREATE TABLE figma_tokens (
    owner TEXT PRIMARY KEY,
    sealed BLOB NOT NULL,
    handle TEXT NOT NULL,
    hint TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

-- +goose Down
DROP TABLE figma_tokens;
