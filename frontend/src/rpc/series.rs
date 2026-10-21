//! Series detail fetch and the series index.

use dioxus::fullstack::{get, post};
use dioxus::prelude::*;
#[cfg(feature = "server")]
use omnibus_db as db;
use omnibus_shared::{SeriesDetail, SeriesReading, SeriesSummary};

#[cfg(feature = "server")]
use super::{internal_rpc_error, AuthUser, PoolExt};

/// Fetch a single series and all its books (ordered by series index);
/// `reading` carries the caller's own state on them.
#[post("/api/rpc/series", pool: PoolExt, user: AuthUser)]
pub async fn rpc_get_series(id: i64) -> Result<Option<SeriesDetail>> {
    let mut series = db::get_series(&pool.0, id)
        .await
        .map_err(|e| internal_rpc_error("get series", e))?;
    if let Some(s) = series.as_mut() {
        s.reading = db::book_reading(&pool.0, user.id, &db::book_uuids(&s.books))
            .await
            .map_err(|e| internal_rpc_error("series book reading", e))?;
    }
    Ok(series)
}

/// `/series` index: every series across both ebook and audiobook libraries.
#[get("/api/rpc/series-list", pool: PoolExt, _user: AuthUser)]
pub async fn rpc_list_series() -> Result<Vec<SeriesSummary>> {
    let settings = db::get_settings(&pool.0)
        .await
        .map_err(|e| internal_rpc_error("get settings", e))?;
    let paths = db::collect_paths(
        settings.ebook_library_path.as_deref(),
        settings.audiobook_library_path.as_deref(),
    );
    Ok(db::list_series(&pool.0, &paths)
        .await
        .map_err(|e| internal_rpc_error("list series", e))?)
}

/// The caller's progress through each series, for the `/series` list.
#[get("/api/rpc/series/reading", pool: PoolExt, user: AuthUser)]
pub async fn rpc_list_series_reading() -> Result<Vec<SeriesReading>> {
    let settings = db::get_settings(&pool.0)
        .await
        .map_err(|e| internal_rpc_error("get settings", e))?;
    let paths = db::collect_paths(
        settings.ebook_library_path.as_deref(),
        settings.audiobook_library_path.as_deref(),
    );
    Ok(db::series_reading(&pool.0, user.id, &paths)
        .await
        .map_err(|e| internal_rpc_error("series reading", e))?)
}
