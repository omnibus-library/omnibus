//! Override writes and the suggestions cache: an edit to title, authors or
//! ISBNs drops the book's cached read-alikes (the next view looks again), and
//! an edit to anything else keeps them.

use omnibus_shared::{BulkMetadataEdit, Contributor, MetadataOverrides};

use crate::pool::init_db;
use crate::suggestions::{
    get_suggestions, replace_suggestions, suggestion_state, NewSuggestion, SuggestionState,
};
use crate::test_support::seed_synced_ebook;

use super::super::*;

async fn seed_book_with_cached_suggestion(pool: &sqlx::SqlitePool) -> (String, i64) {
    let user_id = crate::auth::create_user(pool, "admin", "securepassword1")
        .await
        .unwrap()
        .id;
    let uuid = seed_synced_ebook(pool, "src.epub", "Test Source", "Source Author").await;
    cache_one_suggestion(pool, &uuid).await;
    (uuid, user_id)
}

async fn cache_one_suggestion(pool: &sqlx::SqlitePool, uuid: &str) {
    let row = NewSuggestion {
        hardcover_id: 7,
        hardcover_slug: None,
        title: "Alpha".to_string(),
        author: "Author A".to_string(),
        list_count: 3,
        cover_mime: None,
        cover_bytes: None,
    };
    replace_suggestions(pool, uuid, &[row], SuggestionState::Resolved)
        .await
        .unwrap();
}

async fn cache_is_kept(pool: &sqlx::SqlitePool, uuid: &str) -> bool {
    let marker = suggestion_state(pool, uuid).await.unwrap();
    let rows = get_suggestions(pool, uuid).await.unwrap();
    matches!(marker, Some((SuggestionState::Resolved, _))) && rows.len() == 1
}

async fn cache_is_cleared(pool: &sqlx::SqlitePool, uuid: &str) -> bool {
    suggestion_state(pool, uuid).await.unwrap().is_none()
        && get_suggestions(pool, uuid).await.unwrap().is_empty()
}

#[tokio::test]
async fn merge_metadata_overrides_clears_suggestions_when_the_title_changes() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (uuid, user_id) = seed_book_with_cached_suggestion(&pool).await;
    let edit = MetadataOverrides {
        title: Some("Fixed Title".into()),
        ..Default::default()
    };

    merge_metadata_overrides(&pool, &uuid, &edit, user_id)
        .await
        .unwrap();

    assert!(cache_is_cleared(&pool, &uuid).await);
}

#[tokio::test]
async fn merge_metadata_overrides_keeps_suggestions_when_only_tags_change() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (uuid, user_id) = seed_book_with_cached_suggestion(&pool).await;
    let edit = MetadataOverrides {
        subjects: Some(vec!["fantasy".into()]),
        ..Default::default()
    };

    merge_metadata_overrides(&pool, &uuid, &edit, user_id)
        .await
        .unwrap();

    assert!(cache_is_kept(&pool, &uuid).await);
}

#[tokio::test]
async fn merge_metadata_overrides_keeps_suggestions_when_the_title_is_set_to_its_stored_value() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (uuid, user_id) = seed_book_with_cached_suggestion(&pool).await;
    let edit = MetadataOverrides {
        title: Some("Fixed Title".into()),
        ..Default::default()
    };
    merge_metadata_overrides(&pool, &uuid, &edit, user_id)
        .await
        .unwrap();
    cache_one_suggestion(&pool, &uuid).await;

    merge_metadata_overrides(&pool, &uuid, &edit, user_id)
        .await
        .unwrap();

    assert!(cache_is_kept(&pool, &uuid).await);
}

#[tokio::test]
async fn bulk_merge_metadata_overrides_clears_suggestions_when_the_authors_change() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (uuid, user_id) = seed_book_with_cached_suggestion(&pool).await;
    let edit = BulkMetadataEdit {
        authors: Some(vec!["Real Author".into()]),
        ..Default::default()
    };

    bulk_merge_metadata_overrides(&pool, std::slice::from_ref(&uuid), &edit, user_id)
        .await
        .unwrap();

    assert!(cache_is_cleared(&pool, &uuid).await);
}

#[tokio::test]
async fn upsert_metadata_overrides_clears_suggestions_when_the_isbn_changes() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (uuid, user_id) = seed_book_with_cached_suggestion(&pool).await;
    let edit = MetadataOverrides {
        isbn13: Some("9781649374042".into()),
        ..Default::default()
    };

    upsert_metadata_overrides(&pool, &uuid, &edit, false, user_id)
        .await
        .unwrap();

    assert!(cache_is_cleared(&pool, &uuid).await);
}

#[tokio::test]
async fn upsert_metadata_overrides_keeps_suggestions_when_it_rewrites_the_same_match_fields() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (uuid, user_id) = seed_book_with_cached_suggestion(&pool).await;
    let edit = MetadataOverrides {
        creators: Some(vec![Contributor {
            name: "Real Author".into(),
            ..Default::default()
        }]),
        ..Default::default()
    };
    upsert_metadata_overrides(&pool, &uuid, &edit, false, user_id)
        .await
        .unwrap();
    cache_one_suggestion(&pool, &uuid).await;

    upsert_metadata_overrides(&pool, &uuid, &edit, true, user_id)
        .await
        .unwrap();

    assert!(cache_is_kept(&pool, &uuid).await);
}

#[tokio::test]
async fn delete_metadata_overrides_clears_suggestions_when_a_title_override_is_reverted() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (uuid, user_id) = seed_book_with_cached_suggestion(&pool).await;
    let edit = MetadataOverrides {
        title: Some("Fixed Title".into()),
        ..Default::default()
    };
    upsert_metadata_overrides(&pool, &uuid, &edit, false, user_id)
        .await
        .unwrap();
    cache_one_suggestion(&pool, &uuid).await;

    delete_metadata_overrides(&pool, &uuid).await.unwrap();

    assert!(cache_is_cleared(&pool, &uuid).await);
}

#[tokio::test]
async fn upsert_metadata_overrides_replaces_a_row_whose_stored_json_is_corrupt() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (uuid, user_id) = seed_book_with_cached_suggestion(&pool).await;
    sqlx::query(
        "INSERT INTO metadata_overrides (book_uuid, overrides, has_cover_override, updated_by)
         VALUES (?, '{not json', 0, ?)",
    )
    .bind(&uuid)
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    let edit = MetadataOverrides {
        title: Some("Fixed Title".into()),
        ..Default::default()
    };

    upsert_metadata_overrides(&pool, &uuid, &edit, false, user_id)
        .await
        .unwrap();

    assert!(cache_is_cleared(&pool, &uuid).await);
}
