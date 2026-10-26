-- +goose Up
ALTER TABLE users ADD COLUMN references_quota INTEGER;

-- +goose Down
ALTER TABLE users DROP COLUMN references_quota;
