-- +goose Up
ALTER TABLE session_events ADD COLUMN package TEXT NOT NULL DEFAULT '';
CREATE INDEX session_events_at ON session_events (at);

-- +goose Down
DROP INDEX session_events_at;
ALTER TABLE session_events DROP COLUMN package;
