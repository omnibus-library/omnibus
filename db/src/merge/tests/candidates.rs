//! `merge_candidates`: the cross-library dedup and the row cap.

use crate::merge::MERGE_CANDIDATE_CAP;
use crate::test_support::seed_synced_ebook;
use crate::{init_db, merge_candidates, set_settings};
use omnibus_shared::Settings;

async fn configured_pool(audiobook_path: Option<&str>) -> sqlx::SqlitePool {
    let pool = init_db("sqlite::memory:").await.unwrap();
    set_settings(
        &pool,
        &Settings {
            ebook_library_path: Some("/ebooks".into()),
            audiobook_library_path: audiobook_path.map(Into::into),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    pool
}

#[tokio::test]
async fn merge_candidates_finds_books_matching_the_query() {
    let pool = configured_pool(None).await;
    let wanted = seed_synced_ebook(&pool, "a.epub", "Piranesi", "Susanna Clarke").await;
    seed_synced_ebook(&pool, "b.epub", "Dune", "Frank Herbert").await;

    let out = merge_candidates(&pool, "Piranesi").await.unwrap();

    assert_eq!(out.len(), 1);
    assert_eq!(out[0].unique_identifier.as_deref(), Some(wanted.as_str()));
}

#[tokio::test]
async fn merge_candidates_dedups_shared_directory_hits_and_caps_the_list() {
    // Both library slots pointing at one directory is the documented dedup
    // case: every hit comes back once per path, so without the uuid dedup the
    // list would double.
    let pool = configured_pool(Some("/ebooks")).await;
    for i in 0..(MERGE_CANDIDATE_CAP + 5) {
        seed_synced_ebook(
            &pool,
            &format!("tome-{i}.epub"),
            &format!("Common Tome {i}"),
            "Prolific Author",
        )
        .await;
    }

    let out = merge_candidates(&pool, "Common").await.unwrap();

    assert_eq!(out.len(), MERGE_CANDIDATE_CAP);
    let mut seen = std::collections::HashSet::new();
    assert!(
        out.iter().all(|b| seen.insert(b.unique_identifier.clone())),
        "no duplicate unique_identifier may survive the dedup"
    );
}

#[tokio::test]
async fn merge_candidates_returns_nothing_when_no_library_is_configured() {
    let pool = init_db("sqlite::memory:").await.unwrap();

    let out = merge_candidates(&pool, "anything").await.unwrap();

    assert!(out.is_empty());
}

#[tokio::test]
async fn merge_candidates_errors_when_the_pool_is_closed() {
    let pool = configured_pool(None).await;
    pool.close().await;

    assert!(merge_candidates(&pool, "x").await.is_err());
}
