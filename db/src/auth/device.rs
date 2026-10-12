//! Devices.

use sqlx::{Executor, Row, Sqlite, SqlitePool};

use super::{now_unix, AuthError, AuthResult, Device};

/// Maximum accepted length of a `LoginRequest.device_name` /
/// `RegisterRequest.device_name`, in chars.
// Bounds what an unauthenticated caller can spray at `/api/auth/register` and
// `/login`; the global body limit alone is 1 MiB per request.
pub const MAX_DEVICE_NAME_CHARS: usize = 255;

/// Maximum accepted length of a `client_version`. App version strings
/// don't legitimately exceed semver + a few build-meta segments; 64
/// chars covers `1.2.3-rc.10+build.20251205abcdef` with headroom.
pub const MAX_CLIENT_VERSION_CHARS: usize = 64;

/// Hard cap on how many devices `list_devices_for_user` returns for a single
/// user: a defensive ceiling on the REST response, far above
/// `MAX_DEVICES_PER_USER`.
pub const LIST_DEVICES_LIMIT: i64 = 500;

/// Per-user device cap enforced by the `trg_devices_cap_per_user` trigger:
/// each INSERT evicts the user's least-recently-seen devices beyond this count.
// The trigger SQL hardcodes the same number; a test asserts the two agree.
pub const MAX_DEVICES_PER_USER: i64 = 50;

/// Reject ASCII control characters (incl. CR/LF) and oversize strings before
/// INSERT, rather than truncating, so a bad client gets a deterministic error
/// and cannot inject log lines. `None` is `Ok(())`: both wire fields are
/// optional (anonymous web login).
fn validate_device_field(
    value: Option<&str>,
    max_chars: usize,
    label: &'static str,
) -> AuthResult<()> {
    let Some(v) = value else {
        return Ok(());
    };
    if v.chars().count() > max_chars {
        return Err(AuthError::Validation(format!("invalid {label}: too long")));
    }
    if v.chars().any(char::is_control) {
        return Err(AuthError::Validation(format!(
            "invalid {label}: contains control characters"
        )));
    }
    Ok(())
}

/// Validate a device name against format rules (max length, no control characters); `None` is accepted.
pub fn validate_device_name(name: Option<&str>) -> AuthResult<()> {
    validate_device_field(name, MAX_DEVICE_NAME_CHARS, "device_name")
}

/// Validate a client version string against format rules (max length, no control characters); `None` is accepted.
pub fn validate_client_version(version: Option<&str>) -> AuthResult<()> {
    validate_device_field(version, MAX_CLIENT_VERSION_CHARS, "client_version")
}

/// Register a new device for a user, validating the name and client version;
/// returns the inserted record. Accepts any `sqlx::Executor`: pass `&mut *tx`
/// to keep the insert atomic with the session insert (an orphan device leaks if
/// `create_session` fails after it commits). The cap trigger evicts the user's
/// oldest devices beyond `MAX_DEVICES_PER_USER` in the same INSERT.
pub async fn register_device<'e, E>(
    executor: E,
    user_id: i64,
    name: &str,
    client_kind: &str,
    client_version: Option<&str>,
) -> AuthResult<Device>
where
    E: Executor<'e, Database = Sqlite>,
{
    // Guards run *before* the INSERT so a rejected field never reaches
    // SQLite. Mirrors the placement of `validate_password` in `users`.
    validate_device_name(Some(name))?;
    validate_client_version(client_version)?;
    let row = sqlx::query(
        "INSERT INTO devices (user_id, name, client_kind, client_version)
         VALUES (?, ?, ?, ?)
         RETURNING id, user_id, name, client_kind, client_version, created_at, last_seen_at",
    )
    .bind(user_id)
    .bind(name)
    .bind(client_kind)
    .bind(client_version)
    .fetch_one(executor)
    .await?;
    Ok(Device {
        id: row.get("id"),
        user_id: row.get("user_id"),
        name: row.get("name"),
        client_kind: row.get("client_kind"),
        client_version: row.get("client_version"),
        created_at: row.get("created_at"),
        last_seen_at: row.get("last_seen_at"),
    })
}

/// List all registered devices for a user, ordered by most-recently-seen first, up to `LIST_DEVICES_LIMIT`.
pub async fn list_devices_for_user(pool: &SqlitePool, user_id: i64) -> AuthResult<Vec<Device>> {
    let rows = sqlx::query(
        "SELECT id, user_id, name, client_kind, client_version, created_at, last_seen_at
         FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT ?",
    )
    .bind(user_id)
    .bind(LIST_DEVICES_LIMIT)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Device {
            id: row.get("id"),
            user_id: row.get("user_id"),
            name: row.get("name"),
            client_kind: row.get("client_kind"),
            client_version: row.get("client_version"),
            created_at: row.get("created_at"),
            last_seen_at: row.get("last_seen_at"),
        })
        .collect())
}

/// Revoke a registered device by id (admin `DELETE /api/admin/devices/{id}`).
/// No ownership scoping: an admin may remove any user's device. Also revokes
/// every live session still carrying `device_id`. Returns
/// [`AuthError::DeviceNotFound`] when the id is unknown.
pub async fn revoke_device(pool: &SqlitePool, device_id: i64) -> AuthResult<()> {
    let mut tx = pool.begin().await?;
    // Before the delete: `sessions.device_id` is `ON DELETE SET NULL`, so the
    // sessions could not be found by device afterwards.
    sqlx::query("UPDATE sessions SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL")
        .bind(now_unix())
        .bind(device_id)
        .execute(&mut *tx)
        .await?;
    let deleted = sqlx::query("DELETE FROM devices WHERE id = ?")
        .bind(device_id)
        .execute(&mut *tx)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AuthError::DeviceNotFound);
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests;
