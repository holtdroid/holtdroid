-- +goose Up
CREATE TABLE session_events (
    id INTEGER PRIMARY KEY,
    at TIMESTAMP NOT NULL,
    provider TEXT NOT NULL,
    session_id TEXT NOT NULL,
    action TEXT NOT NULL,
    result TEXT NOT NULL,
    actor TEXT NOT NULL,
    artifact TEXT NOT NULL,
    reason TEXT NOT NULL
);

CREATE INDEX session_events_session ON session_events (provider, session_id);

-- +goose Down
DROP TABLE session_events;
