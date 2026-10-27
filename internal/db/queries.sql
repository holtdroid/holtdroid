-- name: AddSessionEvent :exec
INSERT INTO session_events (at, provider, session_id, action, result, actor, artifact, reason)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);

-- name: ListSessionEvents :many
SELECT * FROM session_events
WHERE provider = ? AND session_id = ?
ORDER BY id;

-- name: CreateUser :exec
INSERT INTO users (id, handle, email, name, role, created_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: GetUser :one
SELECT * FROM users WHERE id = ?;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = ?;

-- name: GetUserByHandle :one
SELECT * FROM users WHERE handle = ?;

-- name: ListUsers :many
SELECT users.*, (SELECT COUNT(*) FROM passkeys WHERE passkeys.user_id = users.id) AS passkeys
FROM users
ORDER BY role = '' DESC, created_at;

-- name: UpdateUser :exec
UPDATE users
SET email = ?, name = ?, role = ?, max_sessions = ?, max_session_ttl = ?, recordings_quota = ?, app_data_quota = ?, references_quota = ?
WHERE id = ?;

-- name: RenameUser :exec
UPDATE users SET name = ? WHERE id = ?;

-- name: TouchUser :exec
UPDATE users SET last_seen_at = ? WHERE id = ?;

-- name: DeleteUser :execrows
DELETE FROM users WHERE id = ?;

-- name: CountAdmins :one
SELECT COUNT(*) FROM users WHERE role = 'admin';

-- name: AddPasskey :exec
INSERT INTO passkeys (id, user_id, name, credential, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: GetPasskey :one
SELECT * FROM passkeys WHERE id = ?;

-- name: ListPasskeys :many
SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at;

-- name: UsePasskey :exec
UPDATE passkeys SET credential = ?, last_used_at = ? WHERE id = ?;

-- name: RenamePasskey :execrows
UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?;

-- name: DeletePasskey :execrows
DELETE FROM passkeys WHERE id = ? AND user_id = ?;

-- name: CountPasskeys :one
SELECT COUNT(*) FROM passkeys WHERE user_id = ?;

-- name: CreateInvite :exec
INSERT INTO invites (id, token_hash, token, kind, role, user_id, domains, note, single_use, expires_at, created_by, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: GetInviteByHash :one
SELECT * FROM invites WHERE token_hash = ?;

-- name: ListInvites :many
SELECT * FROM invites WHERE kind = 'invite' ORDER BY created_at DESC;

-- name: UseInvite :exec
UPDATE invites SET uses = uses + 1 WHERE id = ?;

-- name: DeleteInvite :execrows
DELETE FROM invites WHERE id = ? AND kind = 'invite';

-- name: DeleteBootstrapInvites :exec
DELETE FROM invites WHERE kind = 'bootstrap';

-- name: DeleteRecoveryLinks :exec
DELETE FROM invites WHERE kind = 'recovery' AND user_id = ?;

-- name: ListDNSPresets :many
SELECT * FROM dns_presets
WHERE owner = ?
ORDER BY updated_at DESC, id;

-- name: GetDNSPreset :one
SELECT * FROM dns_presets WHERE id = ? AND owner = ?;

-- name: CountDNSPresets :one
SELECT count(*) FROM dns_presets WHERE owner = ?;

-- name: CreateDNSPreset :exec
INSERT INTO dns_presets (id, owner, name, settings, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: UpdateDNSPreset :execrows
UPDATE dns_presets SET name = ?, settings = ?, updated_at = ?
WHERE id = ? AND owner = ?;

-- name: DeleteDNSPreset :execrows
DELETE FROM dns_presets WHERE id = ? AND owner = ?;

-- name: GetNetworkRoute :one
SELECT route FROM network_routes WHERE provider = ? AND location = ?;

-- name: PutNetworkRoute :exec
INSERT INTO network_routes (provider, location, route, measured_at) VALUES (?, ?, ?, ?)
ON CONFLICT (provider, location) DO UPDATE SET route = excluded.route, measured_at = excluded.measured_at
WHERE excluded.measured_at > network_routes.measured_at;

-- name: GetNetworkBackends :one
SELECT backends FROM network_backends WHERE owner = ? AND package = ?;

-- name: PutNetworkBackends :exec
INSERT INTO network_backends (owner, package, backends, updated_at) VALUES (?, ?, ?, ?)
ON CONFLICT (owner, package) DO UPDATE SET backends = excluded.backends, updated_at = excluded.updated_at;

-- name: GetFigmaToken :one
SELECT sealed, handle, hint, updated_at FROM figma_tokens WHERE owner = ?;

-- name: PutFigmaToken :exec
INSERT INTO figma_tokens (owner, sealed, handle, hint, updated_at) VALUES (?, ?, ?, ?, ?)
ON CONFLICT (owner) DO UPDATE SET sealed = excluded.sealed, handle = excluded.handle, hint = excluded.hint, updated_at = excluded.updated_at;

-- name: DeleteFigmaToken :exec
DELETE FROM figma_tokens WHERE owner = ?;
