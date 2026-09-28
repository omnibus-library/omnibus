//! Who may see whose stats. Owns the one predicate the readers list and the
//! per-reader stats/session-log reads both apply, so they can't disagree
//! about what "shares" means.

use omnibus_shared::{HouseholdReader, SessionCursor, SessionLogPage, StatsRange, StatsSummary};
use sqlx::{Row, SqlitePool};

use super::StatsError;

#[cfg(test)]
mod tests;

/// Why a viewer's read of a reader's stats was refused or failed.
#[derive(Debug, thiserror::Error)]
pub enum ViewerStatsError {
    /// Missing and non-sharing readers answer alike so neither is revealed.
    #[error("this reader isn't sharing their stats")]
    NotSharing,
    #[error(transparent)]
    Stats(#[from] StatsError),
    #[error(transparent)]
    Auth(#[from] crate::auth::AuthError),
}

/// Whether `viewer_id` may read `target_id`'s stats: always their own, else
/// only a sharing reader.
async fn may_view_stats(
    pool: &SqlitePool,
    viewer_id: i64,
    target_id: i64,
) -> Result<bool, crate::auth::AuthError> {
    if viewer_id == target_id {
        return Ok(true);
    }
    crate::auth::get_share_stats(pool, target_id).await
}

/// The caller first, then every other reader who shares their stats, by name.
pub async fn household_readers(
    pool: &SqlitePool,
    caller_id: i64,
) -> Result<Vec<HouseholdReader>, StatsError> {
    let rows = sqlx::query(
        "SELECT u.id AS id, COALESCE(u.display_name, u.username) AS name,
                EXISTS(SELECT 1 FROM user_avatars a WHERE a.user_id = u.id) AS has_avatar,
                (u.id = ?1) AS is_you
         FROM users u
         WHERE u.id = ?1 OR u.share_stats = 1
         ORDER BY is_you DESC, name COLLATE dictionary, u.id",
    )
    .bind(caller_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|row| HouseholdReader {
            id: row.get("id"),
            name: row.get("name"),
            has_avatar: row.get::<i64, _>("has_avatar") != 0,
            is_you: row.get::<i64, _>("is_you") != 0,
        })
        .collect())
}

/// `target_id`'s summary as `viewer_id` may see it; `None` or the viewer's
/// own id reads their own.
///
/// Days in another reader's summary are still cut on the viewer's own
/// calendar (rule 10) — resolving the offset against the target's history
/// would put the viewer on a calendar they aren't on.
pub async fn stats_for_viewer(
    pool: &SqlitePool,
    viewer_id: i64,
    target_id: Option<i64>,
    range: StatsRange,
    claimed_offset_minutes: Option<i64>,
) -> Result<StatsSummary, ViewerStatsError> {
    match target_id {
        Some(target) if target != viewer_id => {
            if !may_view_stats(pool, viewer_id, target).await? {
                return Err(ViewerStatsError::NotSharing);
            }
            let offset =
                crate::user_offset::resolve_offset_minutes(pool, viewer_id, claimed_offset_minutes)
                    .await
                    .map_err(StatsError::from)?;
            Ok(super::user_stats(pool, target, range, Some(offset)).await?)
        }
        _ => Ok(super::user_stats(pool, viewer_id, range, claimed_offset_minutes).await?),
    }
}

/// One page of `target_id`'s session log as `viewer_id` may see it; `None` or
/// the viewer's own id reads their own. Carries no offset — the log reports
/// each sitting's own recorded times rather than bucketing them by day.
pub async fn session_log_for_viewer(
    pool: &SqlitePool,
    viewer_id: i64,
    target_id: Option<i64>,
    book_uuid: Option<&str>,
    before: Option<&SessionCursor>,
    limit: i64,
) -> Result<SessionLogPage, ViewerStatsError> {
    let target = match target_id {
        Some(target) if target != viewer_id => {
            if !may_view_stats(pool, viewer_id, target).await? {
                return Err(ViewerStatsError::NotSharing);
            }
            target
        }
        _ => viewer_id,
    };
    Ok(super::session_log(pool, target, book_uuid, before, limit).await?)
}
