//! Reading-stats REST handlers for the mobile client: the readers list
//! (`GET /api/users`), the `db::stats` aggregate (`GET /api/stats`, windowed
//! by an optional snake_case `?range=`), the same data un-aggregated as a
//! keyset-paginated session log (`GET /api/stats/sessions`), the annual goal
//! (`PUT /api/stats/goal`) and the daily ones (`PUT /api/stats/goal/daily`),
//! one book's insights (`GET /api/books/{uuid}/insights`), and the collection's
//! own scale and mix (`GET /api/library-size`, `GET /api/library-composition` —
//! the same for every reader), and the chart builder (`POST /api/stats/chart`).

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{
    self as db,
    stats::{ChartError, GoalError},
};
use omnibus_shared::{
    BookInsights, BookInsightsQuery, ChartQuery, ChartResult, ChartSpec, DailyGoalUpdate,
    DailyGoals, GoalQuery, HouseholdReader, LibraryComposition, LibrarySize, ReadingGoal,
    ReadingGoalUpdate, SessionCursor, SessionLogPage, SessionLogQuery, StatsQuery, StatsSummary,
};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// List the readers whose stats you can see
///
/// You first, then every other reader who shares their stats, by name. Pass a reader's
/// `id` as `user_id` to the stats routes to read theirs.
#[utoipa::path(
    get,
    path = "/api/users",
    tag = "Stats",
    responses((status = 200, description = "You, then the readers who share their stats.", body = Vec<HouseholdReader>)),
)]
pub(super) async fn get_household_readers(
    user: AuthUser,
    State(state): State<AppState>,
) -> Response {
    match db::stats::household_readers(&state.pool, user.id).await {
        Ok(readers) => Json(readers).into_response(),
        Err(e) => internal("get_household_readers", e),
    }
}

/// Get your reading stats
///
/// Your reading over one period: totals, the daily heatmap, your streak, top authors and
/// tags, finished books and goals. Send `user_id` for another reader's stats; days are
/// still cut on your `utc_offset_minutes`.
#[utoipa::path(
    get,
    path = "/api/stats",
    tag = "Stats",
    params(StatsQuery),
    responses(
        (status = 200, description = "The stats.", body = StatsSummary),
        (status = 400, description = "`range` isn't `week`, `month`, `year` or `all_time`, or `user_id` isn't a whole number."),
        (status = 404, description = "`user_id` names no reader, or one who doesn't share their stats."),
    ),
)]
pub(super) async fn get_stats(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<StatsQuery>,
) -> Response {
    // An unreadable `user_id` is a 400 rather than a silent fall-back to the caller's own
    // stats under another reader's name; the offset, by contrast, degrades quietly.
    match db::stats::stats_for_viewer(
        &state.pool,
        user.id,
        query.user_id,
        query.range,
        query.utc_offset_minutes,
    )
    .await
    {
        Ok(summary) => Json(summary).into_response(),
        Err(e) => viewer_error("get_stats", e),
    }
}

/// A refused read is the contract's 404; anything else is a 500.
pub(super) fn viewer_error(context: &'static str, e: db::stats::ViewerStatsError) -> Response {
    if matches!(e, db::stats::ViewerStatsError::NotSharing) {
        return (StatusCode::NOT_FOUND, e.to_string()).into_response();
    }
    internal(context, e)
}

/// Get the library's size
///
/// How big the whole library is in words, pages and seconds of audio, with how many books
/// each figure could measure. The same for every user.
#[utoipa::path(
    get,
    path = "/api/library-size",
    tag = "Stats",
    responses((status = 200, description = "The library's size.", body = LibrarySize)),
)]
pub(super) async fn get_library_size(_user: AuthUser, State(state): State<AppState>) -> Response {
    // Not folded into `get_stats`: library-wide and only moves on a reindex, so carrying it
    // there would recompute it on every period switch.
    match db::stats::library_size(&state.pool).await {
        Ok(size) => Json(size).into_response(),
        Err(e) => internal("get_library_size", e),
    }
}

/// Set your yearly goal
///
/// Sets, changes or clears how many books you aim to finish in a year. `year` defaults to
/// this year and `kind` to `books`, the only kind, so the usual body is `{"target": 24}`.
/// A null or absent `target` clears the goal.
#[utoipa::path(
    put,
    path = "/api/stats/goal",
    tag = "Stats",
    params(GoalQuery),
    request_body = ReadingGoalUpdate,
    responses(
        (status = 200, description = "The goal with your progress toward it, or `null` once cleared.", body = Option<ReadingGoal>),
        (status = 400, description = "`kind` isn't `books`, `target` is outside 1 to 10,000, or `year` is outside 1900 to 2999."),
    ),
)]
pub(super) async fn put_stats_goal(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<GoalQuery>,
    Json(update): Json<ReadingGoalUpdate>,
) -> Response {
    // Never queued offline (rule 08: account configuration).
    match db::stats::set_goal(&state.pool, user.id, &update, query.utc_offset_minutes).await {
        Ok(goal) => Json(goal).into_response(),
        Err(GoalError::Sqlx(e)) => internal("set_reading_goal", e),
        // The remaining variants are all boundary checks on the payload, and
        // each `#[error]` message names the bound it failed.
        // `InvalidDailyTarget` is unreachable here — `set_goal` bounds against
        // the annual maximum — but it is a 400 wherever it does arise, so it is
        // answered rather than left to widen this match into a catch-all.
        Err(
            e @ (GoalError::UnsupportedKind(_)
            | GoalError::InvalidTarget(_)
            | GoalError::InvalidDailyTarget { .. }
            | GoalError::InvalidYear(_)),
        ) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

/// Set a daily goal
///
/// Sets, changes or clears one of your two daily goals: `pages` or `minutes`. A null or
/// absent `target` clears that one; the other daily goal and the yearly goal stay as they
/// are. The response holds both daily goals.
#[utoipa::path(
    put,
    path = "/api/stats/goal/daily",
    tag = "Stats",
    params(GoalQuery),
    request_body = DailyGoalUpdate,
    responses(
        (status = 200, description = "Both daily goals, with today's progress.", body = DailyGoals),
        (status = 400, description = "`kind` isn't `pages` or `minutes`, or `target` is outside 1 to 2,000 pages or 1 to 1,440 minutes."),
    ),
)]
pub(super) async fn put_stats_daily_goal(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<GoalQuery>,
    Json(update): Json<DailyGoalUpdate>,
) -> Response {
    // Never queued offline (rule 08: account configuration).
    match db::stats::set_daily_goal(&state.pool, user.id, &update, query.utc_offset_minutes).await {
        Ok(goals) => Json(goals).into_response(),
        Err(GoalError::Sqlx(e)) => internal("set_daily_reading_goal", e),
        // As above: every other variant is a boundary check the payload failed.
        Err(
            e @ (GoalError::UnsupportedKind(_)
            | GoalError::InvalidTarget(_)
            | GoalError::InvalidDailyTarget { .. }
            | GoalError::InvalidYear(_)),
        ) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

/// Get the library's composition
///
/// What the whole library is made of: its mix of formats, languages, publishers,
/// publication decades and genres. The same for every user.
#[utoipa::path(
    get,
    path = "/api/library-composition",
    tag = "Stats",
    responses((status = 200, description = "The library's composition.", body = LibraryComposition)),
)]
pub(super) async fn get_library_composition(
    _user: AuthUser,
    State(state): State<AppState>,
) -> Response {
    match db::stats::library_composition(&state.pool).await {
        Ok(composition) => Json(composition).into_response(),
        Err(e) => internal("get_library_composition", e),
    }
}

/// Chart your reading
///
/// Runs a chart you composed: one or two measures over a period, bucketed by day, week,
/// month or year, optionally split by genre. Each series lines up with `buckets`, and a
/// null value means no data, which for an average is not zero. Days are cut on your
/// `utc_offset_minutes`. Nothing is saved.
#[utoipa::path(
    post,
    path = "/api/stats/chart",
    tag = "Stats",
    params(ChartQuery),
    request_body = ChartSpec,
    responses(
        (status = 200, description = "The chart's series, aligned on its buckets.", body = ChartResult),
        (status = 422, description = "The spec describes a chart that can't be drawn: a measure twice, a third scale, or a split of anything but one per-book measure. The body says which."),
    ),
)]
pub(super) async fn post_stats_chart(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<ChartQuery>,
    Json(spec): Json<ChartSpec>,
) -> Response {
    match db::stats::chart_series(&state.pool, user.id, &spec, query.utc_offset_minutes).await {
        Ok(chart) => Json(chart).into_response(),
        Err(ChartError::Spec(e)) => {
            (StatusCode::UNPROCESSABLE_ENTITY, e.to_string()).into_response()
        }
        Err(ChartError::Stats(e)) => internal("post_stats_chart", e),
    }
}

#[cfg(test)]
mod tests;

/// List your reading sessions
///
/// Your reading and listening sessions one page at a time, newest first. Follow
/// `next_before` to the next page. Send `user_id` for another reader's log.
#[utoipa::path(
    get,
    path = "/api/stats/sessions",
    tag = "Stats",
    params(SessionLogQuery),
    responses(
        (status = 200, description = "A page of sessions, newest first.", body = SessionLogPage),
        (status = 400, description = "`before` isn't a `next_before` this route returned, or `limit` or `user_id` isn't a whole number."),
        (status = 404, description = "`user_id` names no reader, or one who doesn't share their stats."),
    ),
)]
pub(super) async fn get_session_log(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<SessionLogQuery>,
) -> Response {
    // A bad cursor is a 400 checked before the share gate: a silent rewind to page one
    // would loop a paging client.
    let before = match query.before.as_deref() {
        Some(raw) => match SessionCursor::parse(raw) {
            Some(cursor) => Some(cursor),
            None => {
                return (axum::http::StatusCode::BAD_REQUEST, "invalid before cursor")
                    .into_response()
            }
        },
        None => None,
    };
    let limit = query.limit.unwrap_or(db::stats::SESSION_LOG_DEFAULT_LIMIT);
    match db::stats::session_log_for_viewer(
        &state.pool,
        user.id,
        query.user_id,
        query.book.as_deref(),
        before.as_ref(),
        limit,
    )
    .await
    {
        Ok(page) => Json(page).into_response(),
        Err(e) => viewer_error("get_session_log", e),
    }
}

/// Get your insights into a book
///
/// How you have read and listened to one book: when you started, the time you have spent
/// in it, how often you picked it up, your longest sitting and a per-day strip. `null`
/// when you have no sitting of a minute or more in it. Days are cut on your
/// `utc_offset_minutes`.
#[utoipa::path(
    get,
    path = "/api/books/{uuid}/insights",
    tag = "Stats",
    params(("uuid" = String, Path, description = "The book's uuid."), BookInsightsQuery),
    responses(
        (status = 200, description = "Your insights, or `null` without a sitting in the book.", body = Option<BookInsights>),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn get_book_insights(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Query(query): Query<BookInsightsQuery>,
) -> Response {
    // `book_insights` answers `None` both for an unknown book and for one with no sitting,
    // so the unknown book is told apart first.
    match db::resolve_canonical_book_uuid(&state.pool, &uuid).await {
        Ok(Some(_)) => {}
        Ok(None) => return (StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => return internal("get_book_insights", e),
    }
    match db::stats::book_insights(&state.pool, user.id, &uuid, query.utc_offset_minutes).await {
        Ok(insights) => Json(insights).into_response(),
        Err(e) => internal("get_book_insights", e),
    }
}
