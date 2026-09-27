//! Merge then undo leaves both books as they were: their own credits in order,
//! series, tags, language and overrides, and every reader's positions,
//! sessions, annotations, bookmarks, journals and ledger buckets back on the
//! book they were written on. Plus the later-merge refusals that keep the
//! record honest when two merges into one book overlap.

use omnibus_shared::MetadataOverrides;

use super::super::*;
use super::{book_id_by_uuid, seed_user};
use crate::pool::init_db;
use crate::sync::{sync_books, SyncPlan};
use crate::test_support::{indexed, uuid_by_scan_key};

/// Index one EPUB with a language, returning its uuid.
async fn seed_book(
    pool: &sqlx::SqlitePool,
    file: &str,
    title: &str,
    authors: &[&str],
    tags: &[&str],
    series: (&str, &str),
    language: &str,
) -> String {
    let mut book = indexed(file, Some(title), authors, tags, Some(series), None);
    book.metadata.language = Some(language.into());
    sync_books(
        pool,
        "/ebooks",
        SyncPlan {
            new_books: vec![book],
            ..Default::default()
        },
    )
    .await
    .unwrap();
    uuid_by_scan_key(pool, &crate::helpers::scan_key_for(file)).await
}

async fn names(pool: &sqlx::SqlitePool, sql: &str, uuid: &str) -> Vec<String> {
    sqlx::query_scalar(sql)
        .bind(book_id_by_uuid(pool, uuid).await)
        .fetch_all(pool)
        .await
        .unwrap()
}

async fn authors(pool: &sqlx::SqlitePool, uuid: &str) -> Vec<String> {
    names(
        pool,
        "SELECT a.name FROM books_authors_link l JOIN authors a ON a.id = l.author
          WHERE l.book = ? ORDER BY l.position",
        uuid,
    )
    .await
}

async fn links(pool: &sqlx::SqlitePool, uuid: &str) -> (Vec<String>, Vec<String>, Vec<String>) {
    let tags = names(
        pool,
        "SELECT t.name FROM books_tags_link l JOIN tags t ON t.id = l.tag
          WHERE l.book = ? ORDER BY t.name",
        uuid,
    )
    .await;
    let series = names(
        pool,
        "SELECT s.name FROM books_series_link l JOIN series s ON s.id = l.series WHERE l.book = ?",
        uuid,
    )
    .await;
    let langs = names(
        pool,
        "SELECT g.code FROM books_languages_link l JOIN languages g ON g.id = l.language
          WHERE l.book = ?",
        uuid,
    )
    .await;
    (tags, series, langs)
}

async fn overrides_of(pool: &sqlx::SqlitePool, uuid: &str) -> Option<MetadataOverrides> {
    let json: Option<String> =
        sqlx::query_scalar("SELECT overrides FROM metadata_overrides WHERE book_uuid = ?")
            .bind(uuid)
            .fetch_optional(pool)
            .await
            .unwrap();
    json.map(|j| serde_json::from_str(&j).unwrap())
}

async fn seed_pair(pool: &sqlx::SqlitePool) -> (String, String) {
    let target = seed_book(
        pool,
        "A/cookbook.epub",
        "Cookbook",
        &["Kept Author"],
        &["cooking"],
        ("Kitchen", "1"),
        "en",
    )
    .await;
    let source = seed_book(
        pool,
        "B/tusk.epub",
        "Tusk Love",
        &["Absorbed Author", "Second Author"],
        &["romance"],
        ("Critical Role", "5"),
        "fr",
    )
    .await;
    (target, source)
}

#[tokio::test]
async fn merge_never_renames_relanguages_or_demotes_the_kept_entry() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool).await;
    let (target, source) = seed_pair(&pool).await;
    crate::metadata_overrides::upsert_metadata_overrides(
        &pool,
        &source,
        &MetadataOverrides {
            title: Some("Tusk Love (Edited)".into()),
            language: Some("de".into()),
            ..Default::default()
        },
        false,
        user,
    )
    .await
    .unwrap();

    merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();

    assert_eq!(overrides_of(&pool, &target).await, None);
    assert_eq!(
        authors(&pool, &target).await,
        ["Kept Author", "Absorbed Author", "Second Author"]
    );
    let (tags, series, langs) = links(&pool, &target).await;
    assert_eq!(tags, ["cooking", "romance"]);
    assert_eq!(series, ["Kitchen"]);
    assert_eq!(langs, ["en"]);
}

#[tokio::test]
async fn undo_merge_returns_each_book_its_own_links_and_overrides() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool).await;
    let (target, source) = seed_pair(&pool).await;
    let source_ov = MetadataOverrides {
        title: Some("Critical Role Novel 5".into()),
        series_index: Some("5".into()),
        genres: Some(vec!["Fantasy".into()]),
        ..Default::default()
    };
    crate::metadata_overrides::upsert_metadata_overrides(&pool, &source, &source_ov, false, user)
        .await
        .unwrap();
    let target_before = (authors(&pool, &target).await, links(&pool, &target).await);
    let source_before = (authors(&pool, &source).await, links(&pool, &source).await);

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    // The source's genres filled the kept entry's empty genre list.
    assert_eq!(
        overrides_of(&pool, &target).await.and_then(|o| o.genres),
        Some(vec!["Fantasy".to_string()])
    );
    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(
        (authors(&pool, &target).await, links(&pool, &target).await),
        target_before
    );
    assert_eq!(
        (authors(&pool, &source).await, links(&pool, &source).await),
        source_before
    );
    assert_eq!(overrides_of(&pool, &target).await, None);
    assert_eq!(overrides_of(&pool, &source).await, Some(source_ov));
}

#[tokio::test]
async fn undo_merge_keeps_an_override_edited_on_the_survivor_since() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool).await;
    let (target, source) = seed_pair(&pool).await;
    crate::metadata_overrides::upsert_metadata_overrides(
        &pool,
        &source,
        &MetadataOverrides {
            genres: Some(vec!["Fantasy".into()]),
            ..Default::default()
        },
        false,
        user,
    )
    .await
    .unwrap();
    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    let edited = MetadataOverrides {
        genres: Some(vec!["Cookery".into()]),
        ..Default::default()
    };
    crate::metadata_overrides::upsert_metadata_overrides(&pool, &target, &edited, false, user)
        .await
        .unwrap();

    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(overrides_of(&pool, &target).await, Some(edited));
}

async fn insert(pool: &sqlx::SqlitePool, sql: &str, user: i64, uuid: &str) {
    sqlx::query(sql)
        .bind(user)
        .bind(uuid)
        .execute(pool)
        .await
        .unwrap();
}

async fn uuids(pool: &sqlx::SqlitePool, table: &str) -> Vec<String> {
    sqlx::query_scalar(&format!("SELECT book_uuid FROM {table} ORDER BY rowid"))
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn undo_merge_returns_reader_state_to_the_book_it_was_written_on() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool).await;
    let (target, source) = seed_pair(&pool).await;
    let progress =
        "INSERT INTO reading_progress (user_id, book_uuid, format, progress_percent, updated_at)
                    VALUES (?, ?, 'epub', ?, ?)";
    for (uuid, pct, ts) in [(&target, 10, 1000), (&source, 60, 2000)] {
        sqlx::query(progress)
            .bind(user)
            .bind(uuid)
            .bind(pct)
            .bind(ts)
            .execute(&pool)
            .await
            .unwrap();
    }
    insert(
        &pool,
        "INSERT INTO reading_sessions (user_id, book_uuid, started_at, ended_at, seconds_read)
         VALUES (?, ?, 100, 200, 100)",
        user,
        &source,
    )
    .await;
    insert(
        &pool,
        "INSERT INTO annotations (user_id, book_uuid, epub_cfi_range) VALUES (?, ?, 'epubcfi(/6/2)')",
        user,
        &source,
    )
    .await;
    insert(
        &pool,
        "INSERT INTO bookmarks (user_id, book_uuid, position) VALUES (?, ?, 'epubcfi(/6/4)')",
        user,
        &source,
    )
    .await;
    insert(
        &pool,
        "INSERT INTO journal_entries (user_id, book_uuid, body_md) VALUES (?, ?, 'thoughts')",
        user,
        &source,
    )
    .await;

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    // A session read on the merged book belongs to the survivor.
    insert(
        &pool,
        "INSERT INTO reading_sessions (user_id, book_uuid, started_at, ended_at, seconds_read)
         VALUES (?, ?, 300, 400, 100)",
        user,
        &target,
    )
    .await;
    undo_merge(&pool, out.merge_log_id).await.unwrap();

    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT book_uuid, progress_percent FROM reading_progress ORDER BY progress_percent",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows, [(target.clone(), 10), (source.clone(), 60)]);
    assert_eq!(
        uuids(&pool, "reading_sessions").await,
        [source.clone(), target]
    );
    for table in ["annotations", "bookmarks", "journal_entries"] {
        assert_eq!(uuids(&pool, table).await, [source.clone()], "{table}");
    }
}

#[tokio::test]
async fn undo_merge_takes_folded_ledger_buckets_back_off_the_target() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool).await;
    let (target, source) = seed_pair(&pool).await;
    for (uuid, gained) in [(&target, 5), (&source, 7)] {
        sqlx::query(
            "INSERT INTO reading_progress_slots (user_id, book_uuid, format, slot, percent_gained)
             VALUES (?, ?, 'epub', 42, ?)",
        )
        .bind(user)
        .bind(uuid)
        .bind(gained)
        .execute(&pool)
        .await
        .unwrap();
    }
    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    undo_merge(&pool, out.merge_log_id).await.unwrap();

    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT book_uuid, percent_gained FROM reading_progress_slots ORDER BY percent_gained",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows, [(target, 5), (source, 7)]);
}

#[tokio::test]
async fn undo_merge_skips_a_deleted_row_whose_reader_is_gone() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let admin = seed_user(&pool).await;
    let reader: i64 = sqlx::query_scalar(
        "INSERT INTO users (username, password_hash) VALUES ('reader', 'x') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let (target, source) = seed_pair(&pool).await;
    for (uuid, ts) in [(&target, 1000), (&source, 2000)] {
        sqlx::query(
            "INSERT INTO audiobook_playback_preferences (user_id, book_uuid, playback_rate, updated_at)
             VALUES (?, ?, 1.5, ?)",
        )
        .bind(reader)
        .bind(uuid)
        .bind(ts)
        .execute(&pool)
        .await
        .unwrap();
    }
    let out = merge_books(&pool, &source, &target, Some(admin))
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(reader)
        .execute(&pool)
        .await
        .unwrap();

    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert!(uuids(&pool, "audiobook_playback_preferences")
        .await
        .is_empty());
}

#[tokio::test]
async fn undo_merge_refuses_when_a_later_merge_replaced_a_moved_row() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool).await;
    let (target, first) = seed_pair(&pool).await;
    let second = seed_book(
        &pool,
        "C/third.epub",
        "Third",
        &["Other"],
        &[],
        ("Kitchen", "2"),
        "en",
    )
    .await;
    for (uuid, ts) in [(&first, 1000), (&second, 2000)] {
        sqlx::query(
            "INSERT INTO reading_progress (user_id, book_uuid, format, progress_percent, updated_at)
             VALUES (?, ?, 'epub', 50, ?)",
        )
        .bind(user)
        .bind(uuid)
        .bind(ts)
        .execute(&pool)
        .await
        .unwrap();
    }
    let earlier = merge_books(&pool, &first, &target, Some(user))
        .await
        .unwrap();
    let later = merge_books(&pool, &second, &target, Some(user))
        .await
        .unwrap();

    let err = undo_merge(&pool, earlier.merge_log_id).await.unwrap_err();
    assert!(matches!(err, MergeError::UndoConflict(_)), "{err:?}");

    // Last in, first out settles it, and the first book gets its row back.
    undo_merge(&pool, later.merge_log_id).await.unwrap();
    undo_merge(&pool, earlier.merge_log_id).await.unwrap();
    assert_eq!(
        uuids(&pool, "reading_progress").await.len(),
        2,
        "both absorbed books hold their own position again"
    );
}

#[tokio::test]
async fn undo_merge_refuses_when_a_later_merge_supplies_an_added_link() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (target, first) = seed_pair(&pool).await;
    let second = seed_book(
        &pool,
        "C/third.epub",
        "Third",
        &["Other"],
        &["romance"],
        ("Kitchen", "2"),
        "en",
    )
    .await;
    let earlier = merge_books(&pool, &first, &target, None).await.unwrap();
    merge_books(&pool, &second, &target, None).await.unwrap();

    let err = undo_merge(&pool, earlier.merge_log_id).await.unwrap_err();
    assert!(matches!(err, MergeError::UndoConflict(_)), "{err:?}");
}
