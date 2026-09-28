//! Who may see whose stats. Owns the one predicate the readers list and the
//! per-reader stats/session-log reads both apply, so they can't disagree
//! about what "shares" means.

use omnibus_shared::HouseholdReader;
use sqlx::{Row, SqlitePool};

use super::StatsError;

#[cfg(test)]
mod tests;

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
