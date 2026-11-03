//! The books a reader leaves out of their stats. Their rule (`users.stats_exclusions`)
//! is materialized into `stats_excluded_books` at the start of each stats request, so
//! every per-user stats source filters on [`kept!`] with one indexed lookup instead of
//! compiling the rule into each query.

use sqlx::{Row, SqlitePool};

use crate::shelves::filter::{bind_all, filter_predicate, Viewer, MATCH_ALL};

use super::StatsError;

/// A `WHERE` term keeping only rows of per-user table `$t` whose book is not excluded.
/// A literal builds a `const`; any other expression builds a `String`.
macro_rules! kept {
    ($t:literal) => {
        concat!(
            "NOT EXISTS (SELECT 1 FROM stats_excluded_books ex \
             WHERE ex.user_id = ",
            $t,
            ".user_id AND ex.book_uuid = ",
            $t,
            ".book_uuid)"
        )
    };
    ($t:expr) => {
        format!(
            "NOT EXISTS (SELECT 1 FROM stats_excluded_books ex \
             WHERE ex.user_id = {0}.user_id AND ex.book_uuid = {0}.book_uuid)",
            $t
        )
    };
}

/// Rebuild the reader's excluded-book set from their rule, dropping their cached
/// summaries when it changed. Writes only when the stored set differs, so a steady-state
/// stats request stays read-only.
pub async fn refresh_exclusions(pool: &SqlitePool, user_id: i64) -> Result<(), StatsError> {
    let user: Option<(Option<String>, i64)> =
        sqlx::query_as("SELECT stats_exclusions, is_admin FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    let (raw, is_admin) = user.unwrap_or_default();
    let rule = crate::auth::parse_stats_exclusions(raw);
    let mut pred = filter_predicate(
        &rule,
        Viewer {
            user_id,
            is_admin: is_admin != 0,
        },
    );
    // An empty rule excludes nothing, where `MATCH_ALL` would exclude every book.
    if pred.sql == MATCH_ALL {
        pred.sql = "0".to_string();
    }

    let matching = format!("SELECT b.uuid FROM books b WHERE {}", pred.sql);
    let stored = "SELECT book_uuid FROM stats_excluded_books WHERE user_id = ?";
    let differs =
        format!("SELECT EXISTS({matching} EXCEPT {stored}) OR EXISTS({stored} EXCEPT {matching})");
    let q = bind_all(sqlx::query(&differs), &pred.binds)
        .bind(user_id)
        .bind(user_id);
    let row = bind_all(q, &pred.binds).fetch_one(pool).await?;
    if row.get::<i64, _>(0) == 0 {
        return Ok(());
    }

    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM stats_excluded_books WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    let insert = format!(
        "INSERT INTO stats_excluded_books (user_id, book_uuid) SELECT ?, b.uuid FROM books b WHERE {}",
        pred.sql
    );
    bind_all(sqlx::query(&insert).bind(user_id), &pred.binds)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    super::invalidate_user(user_id);
    Ok(())
}
