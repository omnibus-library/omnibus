//! Who may see whose stats: the caller always, else a reader who shares.
//! `household_readers` and `book_household` apply that rule directly in SQL;
//! the per-reader stats/session-log/in-progress reads apply it through the
//! private `may_view_stats` gate. Kept in one module so they can't disagree
//! about what "shares" means.

use omnibus_shared::{
    BookHouseholdReader, HouseholdReader, ResumePoint, SessionCursor, SessionLogPage, StatsRange,
    StatsSummary,
};
use sqlx::{Row, SqlitePool};

use super::{book::BOOK_SESSIONS, sessionize, StatsError};

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
    #[error(transparent)]
    Progress(#[from] crate::progress::ProgressError),
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

/// The `users u` rows other readers may see: those who share their stats.
const SHARES: &str = "u.share_stats = 1";

/// The caller first, then every other reader who shares their stats, by name.
pub async fn household_readers(
    pool: &SqlitePool,
    caller_id: i64,
) -> Result<Vec<HouseholdReader>, StatsError> {
    let rows = sqlx::query(&format!(
        "SELECT u.id AS id, COALESCE(u.display_name, u.username) AS name,
                EXISTS(SELECT 1 FROM user_avatars a WHERE a.user_id = u.id) AS has_avatar,
                (u.id = ?1) AS is_you
         FROM users u
         WHERE u.id = ?1 OR {SHARES}
         ORDER BY is_you DESC, name COLLATE dictionary, u.id"
    ))
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

/// Every other reader who shares their stats and has a sitting of at least
/// [`sessionize::MIN_SITTING_SECS`] in the book, newest `last_session_at` first, then
/// by name. `uuid` resolves to the canonical `books.uuid` first; `None` when no book has it.
pub async fn book_household(
    pool: &SqlitePool,
    caller_id: i64,
    uuid: &str,
) -> Result<Option<Vec<BookHouseholdReader>>, StatsError> {
    let Some(book_uuid) = crate::books::resolve_canonical_book_uuid(pool, uuid).await? else {
        return Ok(None);
    };
    let readers = sqlx::query(&format!(
        "SELECT u.id AS id, COALESCE(u.display_name, u.username) AS name,
                EXISTS(SELECT 1 FROM user_avatars a WHERE a.user_id = u.id) AS has_avatar
         FROM users u
         WHERE u.id != ? AND {SHARES}"
    ))
    .bind(caller_id)
    .fetch_all(pool)
    .await?;

    let sittings = sessionize::stitched(BOOK_SESSIONS);
    let min_secs = sessionize::MIN_SITTING_SECS;
    let sql = format!(
        "SELECT COALESCE(SUM(secs), 0) AS seconds, \
                COALESCE(SUM(CASE WHEN secs >= {min_secs} THEN 1 ELSE 0 END), 0) AS sessions, \
                MAX(CASE WHEN secs >= {min_secs} THEN ended_at END) AS last_session_at \
         FROM ({sittings})"
    );
    let mut household = Vec::new();
    // shortcut: one aggregate per sharing reader; a household is a handful of people,
    // fold user_id into the partition if that changes
    for reader in &readers {
        let id: i64 = reader.get("id");
        let row = sqlx::query(&sql)
            .bind(id)
            .bind(&book_uuid)
            .bind(id)
            .bind(&book_uuid)
            .fetch_one(pool)
            .await?;
        let sessions: i64 = row.get("sessions");
        if sessions == 0 {
            continue;
        }
        household.push(BookHouseholdReader {
            id,
            name: reader.get("name"),
            has_avatar: reader.get::<i64, _>("has_avatar") != 0,
            seconds: row.get("seconds"),
            sessions,
            last_session_at: row.get("last_session_at"),
        });
    }
    household.sort_by(|a, b| {
        b.last_session_at
            .cmp(&a.last_session_at)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(Some(household))
}

/// `target_id`'s summary as `viewer_id` may see it; `None` or the viewer's own id
/// reads their own. Days in another reader's summary are still cut on the viewer's
/// own calendar (rule 10).
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

/// `target_id`'s newest resume points as `viewer_id` may see it; `None` or
/// the viewer's own id reads their own. Carries no offset — a resume point
/// names a position, not a day.
pub async fn recent_progress_for_viewer(
    pool: &SqlitePool,
    viewer_id: i64,
    target_id: Option<i64>,
    limit: i64,
) -> Result<Vec<ResumePoint>, ViewerStatsError> {
    let target = match target_id {
        Some(target) if target != viewer_id => {
            if !may_view_stats(pool, viewer_id, target).await? {
                return Err(ViewerStatsError::NotSharing);
            }
            target
        }
        _ => viewer_id,
    };
    Ok(crate::progress::resume_points(pool, target, limit).await?)
}
