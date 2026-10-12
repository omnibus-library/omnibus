//! Sessions.
//!
//! `validate_session` is the one place every HTTP auth extractor (REST and
//! Dioxus) resolves a request to a session, so expiry and revocation checks
//! cannot drift. It takes raw header strings to keep this crate free of
//! axum/http types.

use sqlx::{Executor, Row, Sqlite, SqlitePool};

use super::api_token::{is_api_token_shaped, lookup_api_token};
use super::token::{generate_token, hash_token, parse_session_token};
use super::{
    build_user_from_joined_row, now_unix, AuthError, AuthResult, NewSession, Session, SessionKind,
    User,
};

/// Only write `last_used_at` if the existing value is older than this many
/// seconds. Avoids write-amplification on every authenticated request.
const SESSION_TOUCH_THRESHOLD_SECS: i64 = 5 * 60;

/// Idle-expiry threshold. A session whose `last_used_at` is older than this
/// is treated as expired by `lookup_session`, even if `expires_at` is still
/// in the future. Caps the blast radius of a stolen or forgotten session
/// (cookie absolute TTL is 30 days; bearer is 90).
pub(crate) const SESSION_IDLE_TIMEOUT_SECS: i64 = 7 * 24 * 60 * 60;

/// Hard cap on how many sessions `list_sessions_for_user` returns for a
/// single user. Matches `LIST_DEVICES_LIMIT` — a defensive ceiling so a
/// pathological session count (e.g. a client stuck re-logging-in) can't
/// produce an unbounded REST response.
pub const LIST_SESSIONS_LIMIT: i64 = 500;

/// Maximum stored length of a captured `User-Agent`. Real headers run well
/// under 200 chars; anything past this is truncated rather than rejected,
/// because unlike `device_name` this string is incidental to the request —
/// refusing an odd header would fail the login itself.
pub const MAX_USER_AGENT_CHARS: usize = 512;

/// Truncate a `User-Agent` to [`MAX_USER_AGENT_CHARS`] on a char boundary,
/// mapping a blank header to `None` so the column holds either a usable value
/// or nothing.
fn clamp_user_agent(user_agent: Option<&str>) -> Option<String> {
    let trimmed = user_agent?.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(MAX_USER_AGENT_CHARS).collect())
}

/// Create a new session for `user_id`, returning the session record and the
/// raw (unhashed) token. Accepts any `sqlx::Executor`: pass `&mut *tx` to keep
/// the device + session inserts atomic.
pub async fn create_session<'e, E>(
    executor: E,
    user_id: i64,
    device_id: Option<i64>,
    kind: SessionKind,
    ttl_secs: i64,
    user_agent: Option<&str>,
) -> AuthResult<NewSession>
where
    E: Executor<'e, Database = Sqlite>,
{
    let raw = generate_token()?;
    let hash = hash_token(&raw);
    let now = now_unix();
    let expires = now + ttl_secs;
    let user_agent = clamp_user_agent(user_agent);

    let row = sqlx::query(
        "INSERT INTO sessions (token_hash, user_id, device_id, kind, expires_at, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id, user_id, device_id, kind, created_at, last_used_at, expires_at, user_agent",
    )
    .bind(&hash)
    .bind(user_id)
    .bind(device_id)
    .bind(kind.as_str())
    .bind(expires)
    .bind(user_agent)
    .fetch_one(executor)
    .await?;

    let session = Session {
        id: row.get("id"),
        user_id: row.get("user_id"),
        device_id: row.get("device_id"),
        kind,
        created_at: row.get("created_at"),
        last_used_at: row.get("last_used_at"),
        expires_at: row.get("expires_at"),
        user_agent: row.get("user_agent"),
    };

    Ok(NewSession {
        session,
        raw_token: raw,
    })
}

/// Resolve a raw token into `(User, Session)`. Rejects expired or revoked
/// sessions. Updates `last_used_at` opportunistically (rate-limited by
/// `SESSION_TOUCH_THRESHOLD_SECS`).
pub async fn lookup_session(pool: &SqlitePool, raw_token: &str) -> AuthResult<(User, Session)> {
    let hash = hash_token(raw_token);
    let now = now_unix();

    let row = fetch_session_row(pool, &hash).await?;
    check_session_validity(&row, now)?;

    let session_id: i64 = row.get("s_id");
    let last_used_at: i64 = row.get("last_used_at");

    let user = build_user_from_joined_row(&row);
    let session = build_session_from_row(&row, session_id, last_used_at)?;

    if now - last_used_at >= SESSION_TOUCH_THRESHOLD_SECS {
        touch_last_used(pool, session_id, now).await?;
    }

    Ok((user, session))
}

/// Fetch the joined session+user row for a token hash. Returns `SessionNotFound`
/// when no row matches — the caller treats any absence as an invalid token.
async fn fetch_session_row(pool: &SqlitePool, hash: &[u8]) -> AuthResult<sqlx::sqlite::SqliteRow> {
    let row = sqlx::query(
        "SELECT s.id AS s_id, s.user_id, s.device_id, s.kind, s.created_at,
                s.last_used_at, s.expires_at, s.revoked_at, s.user_agent,
                u.id AS u_id, u.username, u.is_admin, u.can_upload, u.can_edit, u.can_download,
                u.kindle_email, u.display_name, u.hidden_formats,
                u.book_detail_scroll_stops, u.stack_series, u.share_stats,
                EXISTS(SELECT 1 FROM user_avatars a WHERE a.user_id = u.id) AS has_avatar
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?",
    )
    .bind(hash)
    .fetch_optional(pool)
    .await?;

    row.ok_or(AuthError::SessionNotFound)
}

/// Reject a session row that is revoked, absolutely expired, or idle-expired.
/// Returns `SessionNotFound` for any disqualifying condition so callers see
/// one error variant and the specific reason isn't leaked to the wire.
fn check_session_validity(row: &sqlx::sqlite::SqliteRow, now: i64) -> AuthResult<()> {
    let revoked_at: Option<i64> = row.get("revoked_at");
    let expires_at: i64 = row.get("expires_at");
    if revoked_at.is_some() || expires_at <= now {
        return Err(AuthError::SessionNotFound);
    }

    let last_used_at: i64 = row.get("last_used_at");
    // Idle expiry: a session that hasn't been touched in
    // `SESSION_IDLE_TIMEOUT_SECS` is treated as expired regardless of its
    // absolute `expires_at`. `last_used_at` is updated opportunistically
    // below (rate-limited by `SESSION_TOUCH_THRESHOLD_SECS`), so this
    // genuinely tracks user inactivity.
    if now - last_used_at > SESSION_IDLE_TIMEOUT_SECS {
        return Err(AuthError::SessionNotFound);
    }

    Ok(())
}

/// Build a `Session` from the joined query row. Returns `SessionNotFound` if
/// the `kind` column holds an unrecognised value — the migration enforces the
/// CHECK constraint, so an unknown kind means DB corruption or a hand-edited row.
fn build_session_from_row(
    row: &sqlx::sqlite::SqliteRow,
    session_id: i64,
    last_used_at: i64,
) -> AuthResult<Session> {
    let expires_at: i64 = row.get("expires_at");
    let kind_str: String = row.get("kind");
    let kind = match kind_str.as_str() {
        "cookie" => SessionKind::Cookie,
        "bearer" => SessionKind::Bearer,
        _ => return Err(AuthError::SessionNotFound),
    };
    Ok(Session {
        id: session_id,
        user_id: row.get("u_id"),
        device_id: row.get("device_id"),
        kind,
        created_at: row.get("created_at"),
        last_used_at,
        expires_at,
        user_agent: row.get("user_agent"),
    })
}

/// Write the current timestamp to `sessions.last_used_at` for `session_id`,
/// guarded by `revoked_at IS NULL AND expires_at > now` so a session revoked
/// or expired between the outer SELECT and this UPDATE can't have its
/// activity timestamp bumped by a racing lookup. A 0-row result is benign —
/// the threshold guard in `lookup_session` controls whether we write at all.
async fn touch_last_used(pool: &SqlitePool, session_id: i64, now: i64) -> AuthResult<()> {
    // Re-assert validity inside the UPDATE WHERE clause so a session that is
    // revoked or (absolute-)expired between the SELECT above and this write
    // can't have its `last_used_at` bumped by a racing lookup.
    sqlx::query(
        "UPDATE sessions SET last_used_at = ?
         WHERE id = ? AND revoked_at IS NULL AND expires_at > ?",
    )
    .bind(now)
    .bind(session_id)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// Outcome of [`validate_session`], collapsed to the two dispositions an HTTP
/// auth extractor cares about: [`SessionAuthError::Unauthenticated`] (no usable
/// token, or it doesn't resolve to a live session; map to `401`) and
/// [`SessionAuthError::Internal`] (infrastructure failure such as the DB query
/// erroring; map to `500`).
#[derive(Debug, thiserror::Error)]
pub enum SessionAuthError {
    #[error("unauthenticated")]
    Unauthenticated,
    #[error(transparent)]
    Internal(AuthError),
}

/// Resolve an authenticated `(User, Session)` from raw header values, preferring
/// `Authorization: Bearer …` over the `omnibus_session` cookie (see
/// [`parse_session_token`]); `omni_` bearers resolve as API tokens via
/// [`resolve_token`]. No token or [`AuthError::SessionNotFound`] is
/// `Unauthenticated`; any other [`AuthError`] is `Internal`.
pub async fn validate_session(
    pool: &SqlitePool,
    authorization: Option<&str>,
    cookie_header: Option<&str>,
) -> Result<(User, Session), SessionAuthError> {
    let Some((token, _kind)) = parse_session_token(authorization, cookie_header) else {
        return Err(SessionAuthError::Unauthenticated);
    };
    match resolve_token(pool, &token).await {
        Ok(pair) => Ok(pair),
        Err(AuthError::SessionNotFound) => Err(SessionAuthError::Unauthenticated),
        Err(e) => Err(SessionAuthError::Internal(e)),
    }
}

/// Resolve a raw token into `(User, Session)`, routing on its shape: an `omni_…`
/// value of the exact minted length (see [`is_api_token_shaped`]) is an API
/// token (no expiry, revoked via the management UI), anything else a session
/// token. An API token has no `sessions` row, so its principal is synthesized:
/// `kind` [`SessionKind::ApiToken`], `id` the `0` sentinel, `expires_at` `i64::MAX`.
pub async fn resolve_token(pool: &SqlitePool, raw_token: &str) -> AuthResult<(User, Session)> {
    if is_api_token_shaped(raw_token) {
        let (user, token) = lookup_api_token(pool, raw_token).await?;
        // Id `0` never collides with a real session id (they start at 1) in
        // "revoke all sessions except mine" sweeps.
        let session = Session {
            id: 0,
            user_id: user.id,
            device_id: None,
            kind: SessionKind::ApiToken,
            created_at: token.created_at,
            last_used_at: token.last_used_at.unwrap_or(token.created_at),
            expires_at: i64::MAX,
            // API tokens don't capture a login User-Agent — they have no
            // login; the request's own UA is already in the trace span.
            user_agent: None,
        };
        return Ok((user, session));
    }
    lookup_session(pool, raw_token).await
}

/// Revoke a single session by id, setting its `revoked_at` timestamp so `lookup_session` rejects it.
pub async fn revoke_session(pool: &SqlitePool, session_id: i64) -> AuthResult<()> {
    sqlx::query("UPDATE sessions SET revoked_at = ? WHERE id = ?")
        .bind(now_unix())
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Revoke all active sessions for a user; returns the number of rows updated.
/// Accepts any `sqlx::Executor` so callers can run it inside an existing
/// transaction (e.g. alongside a password update, so a failure rolls back
/// both together) or standalone via `&SqlitePool`.
pub async fn revoke_all_sessions_for_user<'e, E>(executor: E, user_id: i64) -> AuthResult<u64>
where
    E: Executor<'e, Database = Sqlite>,
{
    let r =
        sqlx::query("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
            .bind(now_unix())
            .bind(user_id)
            .execute(executor)
            .await?;
    Ok(r.rows_affected())
}

/// Revoke all of a user's active sessions except `except_session_id`. Used by
/// the self-service password change so the caller's own session survives the
/// revocation sweep (they'd otherwise be logged out by the change they just
/// made). Accepts any `sqlx::Executor`, same rationale as
/// [`revoke_all_sessions_for_user`].
pub async fn revoke_all_sessions_for_user_except<'e, E>(
    executor: E,
    user_id: i64,
    except_session_id: i64,
) -> AuthResult<u64>
where
    E: Executor<'e, Database = Sqlite>,
{
    let r = sqlx::query(
        "UPDATE sessions SET revoked_at = ?
         WHERE user_id = ? AND id != ? AND revoked_at IS NULL",
    )
    .bind(now_unix())
    .bind(user_id)
    .bind(except_session_id)
    .execute(executor)
    .await?;
    Ok(r.rows_affected())
}

/// List every currently-live session for `user_id` (not revoked, past its
/// absolute expiry, or idle-expired), most-recently-used first, up to
/// [`LIST_SESSIONS_LIMIT`]. Shared by the self-service and admin listings; they
/// differ only in which `user_id` the caller may pass.
pub async fn list_sessions_for_user(pool: &SqlitePool, user_id: i64) -> AuthResult<Vec<Session>> {
    let now = now_unix();
    // Same idle predicate as `check_session_validity`, so a listing never shows
    // a session that would no longer authenticate.
    let idle_cutoff = now - SESSION_IDLE_TIMEOUT_SECS;
    let rows = sqlx::query(
        "SELECT id, user_id, device_id, kind, created_at, last_used_at, expires_at, user_agent
         FROM sessions
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? AND last_used_at >= ?
         ORDER BY last_used_at DESC
         LIMIT ?",
    )
    .bind(user_id)
    .bind(now)
    .bind(idle_cutoff)
    .bind(LIST_SESSIONS_LIMIT)
    .fetch_all(pool)
    .await?;
    rows.iter().map(row_to_session).collect()
}

/// Build a `Session` from a plain (non-joined) `sessions` row — used by
/// [`list_sessions_for_user`], whose `SELECT` carries no `u_id`/`s_id`
/// aliases (those exist only on [`fetch_session_row`]'s joined query, which
/// [`build_session_from_row`] is shaped for). Returns `SessionNotFound` for
/// an unrecognised `kind`, same rationale as `build_session_from_row`.
fn row_to_session(row: &sqlx::sqlite::SqliteRow) -> AuthResult<Session> {
    let kind_str: String = row.get("kind");
    let kind = match kind_str.as_str() {
        "cookie" => SessionKind::Cookie,
        "bearer" => SessionKind::Bearer,
        _ => return Err(AuthError::SessionNotFound),
    };
    Ok(Session {
        id: row.get("id"),
        user_id: row.get("user_id"),
        device_id: row.get("device_id"),
        kind,
        created_at: row.get("created_at"),
        last_used_at: row.get("last_used_at"),
        expires_at: row.get("expires_at"),
        user_agent: row.get("user_agent"),
    })
}

/// Revoke a session by id, scoped to `user_id` so a caller can only revoke
/// their own sessions — the self-service `DELETE /api/auth/sessions/{id}`
/// (AC2). Returns [`AuthError::SessionNotFound`] when the id is unknown,
/// already revoked, or owned by a different user, so the handler can map
/// every one of those to a 404 without distinguishing them on the wire.
pub async fn revoke_session_for_user(
    pool: &SqlitePool,
    user_id: i64,
    session_id: i64,
) -> AuthResult<()> {
    let r = sqlx::query(
        "UPDATE sessions SET revoked_at = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    )
    .bind(now_unix())
    .bind(session_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    if r.rows_affected() == 0 {
        return Err(AuthError::SessionNotFound);
    }
    Ok(())
}

/// Revoke a session by id with no ownership scoping (admin `DELETE
/// /api/admin/sessions/{id}`). Unlike [`revoke_session`] it checks
/// `rows_affected`, so an unknown or already-revoked id is
/// [`AuthError::SessionNotFound`] rather than a silent no-op.
pub async fn revoke_session_checked(pool: &SqlitePool, session_id: i64) -> AuthResult<()> {
    let r = sqlx::query("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
        .bind(now_unix())
        .bind(session_id)
        .execute(pool)
        .await?;
    if r.rows_affected() == 0 {
        return Err(AuthError::SessionNotFound);
    }
    Ok(())
}

/// Hard-delete every session [`lookup_session`] would reject: revoked, past its
/// absolute `expires_at`, or idle-expired (older than
/// [`SESSION_IDLE_TIMEOUT_SECS`]). Revocation only marks rows, so without this
/// prune the `sessions` table grows unboundedly. Returns the number of rows
/// deleted; meant to run on a periodic schedule.
pub async fn prune_expired_sessions(pool: &SqlitePool) -> AuthResult<u64> {
    let now = now_unix();
    let idle_cutoff = now - SESSION_IDLE_TIMEOUT_SECS;

    // One transaction keeps the prune atomic; a row matching several predicates
    // is removed by the first matching DELETE, so the counts don't overlap.
    let mut tx = pool.begin().await?;
    // Three single-predicate DELETEs: SQLite scans the table for an OR'd form
    // unless every branch is indexed.
    let revoked = sqlx::query("DELETE FROM sessions WHERE revoked_at IS NOT NULL")
        .execute(&mut *tx)
        .await?
        .rows_affected();
    let expired = sqlx::query("DELETE FROM sessions WHERE expires_at <= ?")
        .bind(now)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    let idle = sqlx::query("DELETE FROM sessions WHERE last_used_at < ?")
        .bind(idle_cutoff)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    tx.commit().await?;
    Ok(revoked + expired + idle)
}

#[cfg(test)]
mod tests;
