//! `upsert_koreader_progress_tx`: the device's XPointer is stored verbatim beside
//! the position, loses with it to a newer row, and any other writer clears it.

use omnibus_shared::ProgressUpdate;
use sqlx::SqlitePool;

use crate::init_db;
use crate::kobo::reading_state_for;

use super::super::*;
use super::{seed, seed_user};

const XPOINTER: &str = "/body/DocFragment[2]/body/p[2]/text().6";

fn percent_update(uuid: &str, percent: i64, at: i64) -> ProgressUpdate {
    ProgressUpdate {
        book_uuid: uuid.to_string(),
        format: ProgressFormat::Epub,
        epub_cfi: None,
        audio_position_seconds: None,
        progress_percent: Some(percent),
        kobo_location: None,
        book_file_id: None,
        client_updated_at: Some(at),
    }
}

async fn put_koreader(
    pool: &SqlitePool,
    user: i64,
    update: &ProgressUpdate,
    xpointer: Option<&str>,
) {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    upsert_koreader_progress_tx(&mut tx, user, update, xpointer)
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

async fn stored_xpointer(pool: &SqlitePool, user: i64, uuid: &str) -> Option<String> {
    let states = reading_state_for(pool, user, &[uuid.to_string()])
        .await
        .unwrap();
    states.get(uuid).and_then(|s| s.koreader_xpointer.clone())
}

#[tokio::test]
async fn upsert_koreader_progress_tx_stores_the_xpointer_verbatim() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "alice").await;
    let (_, uuid) = seed(&pool, "/lib", "Book A").await;

    put_koreader(
        &pool,
        user,
        &percent_update(&uuid, 40, 1_000),
        Some(XPOINTER),
    )
    .await;

    assert_eq!(
        stored_xpointer(&pool, user, &uuid).await.as_deref(),
        Some(XPOINTER)
    );
}

#[tokio::test]
async fn upsert_koreader_progress_tx_keeps_the_newer_row_and_its_xpointer_when_stale() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "alice").await;
    let (_, uuid) = seed(&pool, "/lib", "Book A").await;
    put_koreader(
        &pool,
        user,
        &percent_update(&uuid, 60, 2_000),
        Some(XPOINTER),
    )
    .await;

    put_koreader(
        &pool,
        user,
        &percent_update(&uuid, 10, 1_000),
        Some("/body/DocFragment[1]/body/p/text().0"),
    )
    .await;

    assert_eq!(
        stored_xpointer(&pool, user, &uuid).await.as_deref(),
        Some(XPOINTER)
    );
}

#[tokio::test]
async fn upsert_progress_tx_clears_a_stored_xpointer() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "alice").await;
    let (_, uuid) = seed(&pool, "/lib", "Book A").await;
    put_koreader(
        &pool,
        user,
        &percent_update(&uuid, 40, 1_000),
        Some(XPOINTER),
    )
    .await;

    upsert_progress(&pool, user, &percent_update(&uuid, 45, 2_000))
        .await
        .unwrap();

    assert_eq!(stored_xpointer(&pool, user, &uuid).await, None);
}

#[tokio::test]
async fn reading_state_for_returns_no_xpointer_for_a_web_only_row() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "alice").await;
    let (_, uuid) = seed(&pool, "/lib", "Book A").await;
    upsert_progress(&pool, user, &percent_update(&uuid, 45, 1_000))
        .await
        .unwrap();

    let states = reading_state_for(&pool, user, std::slice::from_ref(&uuid))
        .await
        .unwrap();

    assert_eq!(states[&uuid].percent, Some(45));
    assert_eq!(states[&uuid].koreader_xpointer, None);
}
