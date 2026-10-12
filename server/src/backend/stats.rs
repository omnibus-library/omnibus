//! Reading-stats REST handlers for the mobile client: the readers list
//! (`GET /api/users`), the `db::stats` aggregate (`GET /api/stats`, windowed
//! by an optional snake_case `?range=`), the same data un-aggregated as a
//! keyset-paginated session log (`GET /api/stats/sessions`), the annual goal
//! (`PUT /api/stats/goal`) and the daily ones (`PUT /api/stats/goal/daily`),
//! and the collection's own scale and mix (`GET /api/library-size`,
//! `GET /api/library-composition` — the same for every reader).

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, stats::GoalError};
use omnibus_shared::{DailyGoalUpdate, ReadingGoalUpdate, SessionCursor, StatsRange};
use serde::{Deserialize, Deserializer};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// Read `utc_offset_minutes` leniently: anything that isn't a number becomes `None`, the
/// same answer an absent field gives. A plain `Option<i64>` would make axum's `Query`
/// reject the whole *request* on `?utc_offset_minutes=` or `=abc`, costing the reader
/// their stats page over an optional hint. Trimmed because `+` decodes to a space.
fn lenient_offset<'de, D: Deserializer<'de>>(de: D) -> Result<Option<i64>, D::Error> {
    Ok(Option::<String>::deserialize(de)?.and_then(|raw| raw.trim().parse().ok()))
}

/// Query shape for `GET /api/stats`. `range` is optional so a bare GET serves
/// the default window; an unknown value is a 400 from the extractor.
#[derive(Debug, Deserialize)]
pub(super) struct StatsQuery {
    #[serde(default)]
    range: StatsRange,
    /// Minutes east of UTC on the calling device, which every day boundary in the
    /// response is cut on: heatmap columns, the streak, both daily goals, and where the
    /// window opens. Optional: the server falls back to the offset of the caller's most
    /// recent session, then UTC. Unreadable ([`lenient_offset`]) or out-of-range values
    /// take that fallback too rather than 400-ing.
    #[serde(default, deserialize_with = "lenient_offset")]
    utc_offset_minutes: Option<i64>,
    /// Whose stats to read; absent or the caller's own id reads their own.
    /// Strict, unlike the offset above: an unparseable value is a 400 rather
    /// than a silent fall-back to the caller's own stats under another
    /// reader's name.
    user_id: Option<i64>,
}

/// Query shape for the goal writes: the same offset [`StatsQuery`] carries, on
/// the same lenient terms and for the same reason — the response reports today's
/// progress, so it has to know whose today. No `range`; a goal is not windowed.
#[derive(Debug, Deserialize)]
pub(super) struct GoalQuery {
    #[serde(default, deserialize_with = "lenient_offset")]
    utc_offset_minutes: Option<i64>,
}

/// `GET /api/users` — the readers whose stats the caller may view, the caller first.
pub(super) async fn get_household_readers(
    user: AuthUser,
    State(state): State<AppState>,
) -> Response {
    match db::stats::household_readers(&state.pool, user.id).await {
        Ok(readers) => Json(readers).into_response(),
        Err(e) => internal("get_household_readers", e),
    }
}

/// Fetch the caller's stats summary over the requested range, or a sharing
/// reader's with `user_id`.
pub(super) async fn get_stats(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<StatsQuery>,
) -> Response {
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

/// How big the library is in words, pages, and hours of audio. Not folded into
/// [`get_stats`]'s payload: the answer is library-wide and only moves on a reindex, so
/// carrying it there would recompute it on every period switch. The auth extractor still
/// applies, as the library isn't public.
pub(super) async fn get_library_size(_user: AuthUser, State(state): State<AppState>) -> Response {
    match db::stats::library_size(&state.pool).await {
        Ok(size) => Json(size).into_response(),
        Err(e) => internal("get_library_size", e),
    }
}

/// Set, change, or clear the caller's annual reading goal. `year` defaults to the server's
/// current calendar year and `kind` to `books`, so the usual body is `{"target": 24}`; a
/// `null` / absent `target` clears the goal. Returns the resulting goal (`null` once cleared)
/// with progress recomputed. Never queued offline (rule 08: account configuration).
pub(super) async fn put_stats_goal(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<GoalQuery>,
    Json(update): Json<ReadingGoalUpdate>,
) -> Response {
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

/// Set, change, or clear one of the caller's daily reading goals. The body names its `kind`
/// (`pages` or `minutes`); an absent `target` clears that kind, leaving the other and the
/// annual goal alone. Returns **both** daily goals with today's progress recomputed.
/// Never queued offline (rule 08: account configuration).
pub(super) async fn put_stats_daily_goal(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<GoalQuery>,
    Json(update): Json<DailyGoalUpdate>,
) -> Response {
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

/// What the library is made of — format, language, publisher, publication decade, and
/// genre. Its own route for the same reason as [`get_library_size`]; the auth
/// extractor still applies.
pub(super) async fn get_library_composition(
    _user: AuthUser,
    State(state): State<AppState>,
) -> Response {
    match db::stats::library_composition(&state.pool).await {
        Ok(composition) => Json(composition).into_response(),
        Err(e) => internal("get_library_composition", e),
    }
}

#[cfg(test)]
mod tests;

/// Query shape for `GET /api/stats/sessions`. Every field is optional: a bare
/// GET serves the newest page of the caller's whole log.
#[derive(Debug, Deserialize)]
pub(super) struct SessionLogQuery {
    /// Scope to one book. Resolved through the merge ledger, so a link into a
    /// book that was later merged away still finds its sittings.
    book: Option<String>,
    /// Page size, clamped by `db::stats` into
    /// `1..=SESSION_LOG_MAX_LIMIT`.
    limit: Option<i64>,
    /// The previous page's `next_before`, echoed back verbatim.
    before: Option<String>,
    /// Whose log to read; absent or the caller's own id reads their own.
    user_id: Option<i64>,
}

/// Fetch a page of the caller's session log, newest sitting first, or a sharing reader's
/// with `user_id`. A `before` that isn't a cursor this endpoint issued is a 400 checked
/// before the share gate, since a silent rewind to page one would loop a paging client.
pub(super) async fn get_session_log(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<SessionLogQuery>,
) -> Response {
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
