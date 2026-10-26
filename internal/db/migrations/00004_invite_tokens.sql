-- +goose Up
ALTER TABLE invites ADD COLUMN token TEXT;

-- +goose Down
ALTER TABLE invites DROP COLUMN token;
