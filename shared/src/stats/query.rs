//! Query parameters of the `/api/stats*` routes: the stats summary, the session log and
//! the goal writes.

use serde::{Deserialize, Deserializer};

use super::StatsRange;

/// Read `utc_offset_minutes` leniently: anything that isn't a number becomes `None`, the
/// same answer an absent field gives. A plain `Option<i64>` would make axum's `Query`
/// reject the whole *request* on `?utc_offset_minutes=` or `=abc`, costing the reader
/// their stats page over an optional hint. Trimmed because `+` decodes to a space.
fn lenient_offset<'de, D: Deserializer<'de>>(de: D) -> Result<Option<i64>, D::Error> {
    Ok(Option::<String>::deserialize(de)?.and_then(|raw| raw.trim().parse().ok()))
}

/// Query parameters of `GET /api/stats`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct StatsQuery {
    /// The period the figures cover. Defaults to `month`.
    #[serde(default)]
    pub range: StatsRange,
    /// Your device's offset from UTC in minutes, east positive (`-300` for New York in
    /// winter). Every day boundary in the response is cut on it: the heatmap, the streak,
    /// the daily goals and where the period starts. Absent, unreadable, or outside -720 to
    /// 840, the server uses the offset of your most recent reading session, then UTC.
    #[serde(default, deserialize_with = "lenient_offset")]
    pub utc_offset_minutes: Option<i64>,
    /// Read another reader's stats instead of your own. They must share their stats.
    pub user_id: Option<i64>,
}

/// Query parameters of the goal writes, `PUT /api/stats/goal` and
/// `PUT /api/stats/goal/daily`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct GoalQuery {
    /// Your device's offset from UTC in minutes, east positive, which decides where today
    /// starts for the progress in the response. Absent, unreadable, or outside -720 to
    /// 840, the server uses the offset of your most recent reading session, then UTC.
    #[serde(default, deserialize_with = "lenient_offset")]
    pub utc_offset_minutes: Option<i64>,
}

/// Query parameters of `GET /api/stats/sessions`. With none set, the response is the
/// newest page of your whole log.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct SessionLogQuery {
    /// Only sessions in this book, by uuid. A uuid a merge retired still finds the
    /// sessions it had.
    pub book: Option<String>,
    /// Sessions per page, from 1 to 100. Defaults to 25; a value outside the range is moved
    /// to the nearest end.
    pub limit: Option<i64>,
    /// Where the page starts: the previous page's `next_before`, sent back unchanged.
    pub before: Option<String>,
    /// Read another reader's log instead of your own. They must share their stats.
    pub user_id: Option<i64>,
}
