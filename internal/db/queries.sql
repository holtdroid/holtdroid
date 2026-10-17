-- name: AddSessionEvent :exec
INSERT INTO session_events (at, provider, session_id, action, result, actor, artifact, reason)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);

-- name: ListSessionEvents :many
SELECT * FROM session_events
WHERE provider = ? AND session_id = ?
ORDER BY id;
