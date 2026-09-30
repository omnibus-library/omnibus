//! Discovery reads that back cross-cutting search surfaces: the tag and
//! genre clouds and the command-palette grouped search.

use dioxus::fullstack::{get, post};
use dioxus::prelude::*;
#[cfg(feature = "server")]
use omnibus_db as db;
use omnibus_shared::{GenreWeight, PaletteResults, TagWeight};

#[cfg(feature = "server")]
use super::{internal_rpc_error, AuthUser, PoolExt};

/// Return all tags with book counts for the tag cloud.
#[get("/api/rpc/tags", pool: PoolExt, _user: AuthUser)]
pub async fn rpc_get_tag_cloud() -> Result<Vec<TagWeight>> {
    Ok(db::get_tag_cloud(&pool.0)
        .await
        .map_err(|e| internal_rpc_error("get tag cloud", e))?)
}

/// Return all genres with book counts for the genre chip-editor pool.
#[get("/api/rpc/genres", pool: PoolExt, _user: AuthUser)]
pub async fn rpc_get_genre_cloud() -> Result<Vec<GenreWeight>> {
    Ok(db::get_genre_cloud(&pool.0)
        .await
        .map_err(|e| internal_rpc_error("get genre cloud", e))?)
}

/// Search palette — grouped results (books, authors, series, tags, genres)
/// for the command-palette overlay.
#[post("/api/rpc/search-palette", pool: PoolExt, _user: AuthUser)]
pub async fn rpc_search_palette(q: String) -> Result<PaletteResults> {
    Ok(search_palette(&pool.0, &q, None).await?)
}

/// The same grouped search with a raised per-category cap — the full results
/// page asking for a whole section behind its "Show all". Clamped server-side
/// to `db::MAX_SECTION_LIMIT`.
#[post("/api/rpc/search-results", pool: PoolExt, _user: AuthUser)]
pub async fn rpc_search_results(q: String, limit: u32) -> Result<PaletteResults> {
    Ok(search_palette(&pool.0, &q, Some(limit)).await?)
}

/// Server-side body of [`rpc_search_palette`] and [`rpc_search_results`],
/// extracted so the grouped search can be unit-tested without the server-fn
/// transport. `None` keeps the palette's own cap.
#[cfg(feature = "server")]
async fn search_palette(
    pool: &sqlx::SqlitePool,
    q: &str,
    limit: Option<u32>,
) -> Result<PaletteResults, ServerFnError> {
    if omnibus_shared::search_query_too_long(q) {
        return Err(ServerFnError::new("query too long"));
    }
    let settings = db::get_settings(pool)
        .await
        .map_err(|e| internal_rpc_error("get settings", e))?;
    let paths = db::collect_paths(
        settings.ebook_library_path.as_deref(),
        settings.audiobook_library_path.as_deref(),
    );
    if paths.is_empty() {
        return Ok(PaletteResults::default());
    }
    match limit {
        Some(limit) => db::search_palette_for_paths_limited(pool, &paths, q, limit).await,
        None => db::search_palette_for_paths(pool, &paths, q).await,
    }
    .map_err(|e| internal_rpc_error("search palette", e))
}

// `server`-gated: exercises the extracted server-side body against an
// in-memory DB. CI runs this via `cargo test -p omnibus-frontend --features
// server`.
#[cfg(all(test, feature = "server"))]
mod tests {
    use super::search_palette;
    use omnibus_db::test_support::seed_synced_ebook;
    use omnibus_shared::SEARCH_QUERY_MAX_LEN;

    #[tokio::test]
    async fn search_palette_groups_book_hits_for_a_configured_library() {
        let pool = omnibus_db::init_db("sqlite::memory:").await.unwrap();
        omnibus_db::set_settings(
            &pool,
            &omnibus_shared::Settings {
                ebook_library_path: Some("/ebooks".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        seed_synced_ebook(&pool, "dune.epub", "Dune", "Frank Herbert").await;

        let results = search_palette(&pool, "Dune", None).await.unwrap();
        assert_eq!(results.books.len(), 1);
        assert_eq!(results.books[0].title, "Dune".to_string());
    }

    #[tokio::test]
    async fn search_palette_with_a_limit_returns_more_than_the_palettes_five() {
        let pool = omnibus_db::init_db("sqlite::memory:").await.unwrap();
        omnibus_db::set_settings(
            &pool,
            &omnibus_shared::Settings {
                ebook_library_path: Some("/ebooks".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        for i in 0..7 {
            seed_synced_ebook(
                &pool,
                &format!("dune{i}.epub"),
                &format!("Dune {i}"),
                "Frank Herbert",
            )
            .await;
        }

        let capped = search_palette(&pool, "Dune", None).await.unwrap();
        let whole = search_palette(&pool, "Dune", Some(50)).await.unwrap();
        assert_eq!(capped.books.len(), 5);
        assert_eq!(whole.books.len(), 7);
        assert_eq!(whole.book_total, 7);
    }

    #[tokio::test]
    async fn search_palette_returns_empty_results_when_no_library_configured() {
        let pool = omnibus_db::init_db("sqlite::memory:").await.unwrap();
        let results = search_palette(&pool, "anything", None).await.unwrap();
        assert_eq!(results, omnibus_shared::PaletteResults::default());
    }

    #[tokio::test]
    async fn search_palette_rejects_query_over_the_length_cap() {
        let pool = omnibus_db::init_db("sqlite::memory:").await.unwrap();
        let oversized = "a".repeat(SEARCH_QUERY_MAX_LEN + 1);

        let result = search_palette(&pool, &oversized, None).await;

        assert!(result.is_err(), "oversized query must be rejected");
    }
}
