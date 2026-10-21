//! Reading-stats aggregate fetch for the `/stats` page, the library-scale
//! totals beside it, and the per-book Insights-card counterpart for the
//! book-detail page.

use dioxus::fullstack::post;
use dioxus::prelude::*;
#[cfg(feature = "server")]
use omnibus_db as db;
#[cfg(feature = "server")]
use omnibus_shared::SessionCursor;
use omnibus_shared::{
    BookInsights, ChartResult, ChartSpec, DailyGoalUpdate, DailyGoals, HouseholdReader,
    LibraryComposition, LibrarySize, ReadingGoal, ReadingGoalUpdate, SessionLogPage, StatsRange,
    StatsSummary,
};

#[cfg(feature = "server")]
use super::{internal_rpc_error, AuthUser, PoolExt};

/// Fetch the readers whose stats the caller may view, the caller first.
/// Mobile uses the analogous `GET /api/users` REST route.
#[post("/api/rpc/household-readers", pool: PoolExt, user: AuthUser)]
pub async fn rpc_household_readers() -> Result<Vec<HouseholdReader>> {
    Ok(household_readers(&pool.0, user.id).await?)
}

/// Server-side body of [`rpc_household_readers`], extracted for testability.
#[cfg(feature = "server")]
async fn household_readers(
    pool: &sqlx::SqlitePool,
    caller_id: i64,
) -> Result<Vec<HouseholdReader>, ServerFnError> {
    db::stats::household_readers(pool, caller_id)
        .await
        .map_err(|e| internal_rpc_error("household readers", e))
}

/// Fetch the caller's stats summary over `range`, or a sharing reader's with
/// `user_id`. Served from the `db::stats` per-user cache (60s TTL, keyed on
/// the offset too). `utc_offset_minutes` is where the calling device is, and
/// every day boundary is cut on it (rule 10); `None` falls back to the
/// reader's latest session offset, then UTC. Mobile uses `GET /api/stats`.
#[post("/api/rpc/stats", pool: PoolExt, user: AuthUser)]
pub async fn rpc_stats(
    range: StatsRange,
    utc_offset_minutes: Option<i64>,
    user_id: Option<i64>,
) -> Result<StatsSummary> {
    Ok(reader_stats(&pool.0, user.id, range, utc_offset_minutes, user_id).await?)
}

/// Server-side body of [`rpc_stats`], extracted for testability.
#[cfg(feature = "server")]
async fn reader_stats(
    pool: &sqlx::SqlitePool,
    caller_id: i64,
    range: StatsRange,
    utc_offset_minutes: Option<i64>,
    user_id: Option<i64>,
) -> Result<StatsSummary, ServerFnError> {
    db::stats::stats_for_viewer(pool, caller_id, user_id, range, utc_offset_minutes)
        .await
        .map_err(|e| map_viewer_error("stats", e))
}

/// A refused read keeps its contract message and rides in a 404; anything
/// else is genericized.
#[cfg(feature = "server")]
pub(super) fn map_viewer_error(
    context: &'static str,
    e: db::stats::ViewerStatsError,
) -> ServerFnError {
    if matches!(e, db::stats::ViewerStatsError::NotSharing) {
        return ServerFnError::ServerError {
            message: e.to_string(),
            code: 404,
            details: None,
        };
    }
    internal_rpc_error(context, e)
}

/// Fetch the current user's Started/Time-read/Sessions insights for one book
/// — the book-detail page's Insights card. `None` when the book has no
/// recorded sessions yet, driving the card's em-dash empty state. Web-only:
/// the rail section that renders this card doesn't compile on mobile, so
/// there's no REST counterpart.
#[post("/api/rpc/book-insights", pool: PoolExt, user: AuthUser)]
pub async fn rpc_book_insights(
    uuid: String,
    utc_offset_minutes: Option<i64>,
) -> Result<Option<BookInsights>> {
    Ok(
        db::stats::book_insights(&pool.0, user.id, &uuid, utc_offset_minutes)
            .await
            .map_err(|e| internal_rpc_error("book insights", e))?,
    )
}

/// Fetch how big the library is in words, pages, and hours of audio. Its own
/// call rather than a field on [`rpc_stats`]'s payload: the answer is
/// library-wide and only moves on a reindex, so it isn't recomputed and re-sent
/// on every period switch. Mobile uses `GET /api/library-size`.
#[post("/api/rpc/library-size", pool: PoolExt, _user: AuthUser)]
pub async fn rpc_library_size() -> Result<LibrarySize> {
    Ok(db::stats::library_size(&pool.0)
        .await
        .map_err(|e| internal_rpc_error("library size", e))?)
}

/// Set, change, or clear the current user's annual reading goal, returning the
/// resulting goal (`None` once cleared) with its progress recomputed. Account
/// configuration under rule 08, never queued offline. `db::stats::set_goal`
/// drops this user's cached summaries, so the refetch after a save sees it.
#[post("/api/rpc/stats-goal", pool: PoolExt, user: AuthUser)]
pub async fn rpc_set_reading_goal(
    update: ReadingGoalUpdate,
    utc_offset_minutes: Option<i64>,
) -> Result<Option<ReadingGoal>> {
    Ok(
        db::stats::set_goal(&pool.0, user.id, &update, utc_offset_minutes)
            .await
            .map_err(|e| internal_rpc_error("set reading goal", e))?,
    )
}

/// Set, change, or clear one of the current user's daily reading goals,
/// returning **both** afterwards with today's progress recomputed, so the band
/// redraws from one response. The offset decides which day both kinds are
/// measured over. Account configuration under rule 08, never queued offline.
#[post("/api/rpc/stats-goal-daily", pool: PoolExt, user: AuthUser)]
pub async fn rpc_set_daily_goal(
    update: DailyGoalUpdate,
    utc_offset_minutes: Option<i64>,
) -> Result<DailyGoals> {
    Ok(
        db::stats::set_daily_goal(&pool.0, user.id, &update, utc_offset_minutes)
            .await
            .map_err(|e| internal_rpc_error("set daily reading goal", e))?,
    )
}

/// Fetch what the library is made of — its format, language, publisher,
/// decade, and genre mix. Its own call, for the same reason as
/// [`rpc_library_size`]: library-wide, moves only on a reindex. Mobile uses
/// `GET /api/library-composition`.
#[post("/api/rpc/library-composition", pool: PoolExt, _user: AuthUser)]
pub async fn rpc_library_composition() -> Result<LibraryComposition> {
    Ok(db::stats::library_composition(&pool.0)
        .await
        .map_err(|e| internal_rpc_error("library composition", e))?)
}

/// Fetch one page of the caller's session log, newest sitting first, or a
/// sharing reader's with `user_id`. `book` scopes it to a single book; `before`
/// is the previous page's `next_before`, echoed back verbatim. A `before` that
/// doesn't parse is an **error** (like the REST route's 400), not an empty
/// page, which would silently end the log early.
#[post("/api/rpc/stats/sessions", pool: PoolExt, user: AuthUser)]
pub async fn rpc_session_log(
    book: Option<String>,
    before: Option<String>,
    user_id: Option<i64>,
) -> Result<SessionLogPage> {
    Ok(reader_session_log(
        &pool.0,
        user.id,
        book.as_deref(),
        before.as_deref(),
        user_id,
    )
    .await?)
}

/// Server-side body of [`rpc_session_log`], extracted for testability.
#[cfg(feature = "server")]
async fn reader_session_log(
    pool: &sqlx::SqlitePool,
    caller_id: i64,
    book: Option<&str>,
    before: Option<&str>,
    user_id: Option<i64>,
) -> Result<SessionLogPage, ServerFnError> {
    let cursor = match before {
        Some(raw) => match SessionCursor::parse(raw) {
            Some(cursor) => Some(cursor),
            None => return Err(ServerFnError::new("invalid before cursor")),
        },
        None => None,
    };
    db::stats::session_log_for_viewer(
        pool,
        caller_id,
        user_id,
        book,
        cursor.as_ref(),
        db::stats::SESSION_LOG_DEFAULT_LIMIT,
    )
    .await
    .map_err(|e| map_viewer_error("session log", e))
}

/// Run a chart-builder spec and return its aligned series. Uncached, unlike
/// [`rpc_stats`] (the spec space is open). `POST /api/stats/chart` is the REST
/// counterpart over the same `db::stats::chart_series`. A rejected spec surfaces
/// its own message, since it describes the reader's selection; a DB failure is
/// logged and generalized. The spec is re-validated server-side inside that call.
#[post("/api/rpc/chart-series", pool: PoolExt, user: AuthUser)]
pub async fn rpc_chart_series(
    spec: ChartSpec,
    utc_offset_minutes: Option<i64>,
) -> Result<ChartResult> {
    Ok(
        db::stats::chart_series(&pool.0, user.id, &spec, utc_offset_minutes)
            .await
            .map_err(|e| match e {
                db::stats::ChartError::Spec(inner) => {
                    dioxus::prelude::ServerFnError::new(inner.to_string())
                }
                db::stats::ChartError::Stats(inner) => internal_rpc_error("chart series", inner),
            })?,
    )
}

#[cfg(all(test, feature = "server"))]
mod tests;
