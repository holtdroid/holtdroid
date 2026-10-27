-- +goose Up
ALTER TABLE users ADD COLUMN media_quota INTEGER;

-- +goose Down
ALTER TABLE users DROP COLUMN media_quota;
