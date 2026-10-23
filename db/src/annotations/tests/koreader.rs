//! The KOReader channel: `koreader_annotations_since` (minted ids, the cursor
//! window and its cap, tombstones from every delete path),
//! `upsert_koreader_annotation` (insert, last-write-wins, delete-wins) and
//! `delete_koreader_annotations`.

use super::super::*;
use super::{seed, seed_user};
use crate::init_db;

const CFI: &str = "epubcfi(/6/2!/4/48,/1:43,/1:53)";

async fn now(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT CAST(strftime('%s','now') AS INTEGER)")
        .fetch_one(pool)
        .await
        .unwrap()
}

fn web_highlight(book_uuid: &str, client_id: Option<&str>) -> CreateHighlight {
    CreateHighlight {
        client_id: client_id.map(Into::into),
        book_uuid: book_uuid.into(),
        epub_cfi_range: CFI.into(),
        color: HighlightColor::Rose,
        text: Some("the passage".into()),
    }
}

async fn stamp(pool: &SqlitePool, client_id: &str, updated_at: i64) {
    sqlx::query("UPDATE annotations SET updated_at = ? WHERE client_id = ?")
        .bind(updated_at)
        .bind(client_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn listed(pool: &SqlitePool, user: i64, uuid: &str, since: i64) -> KoreaderListing {
    koreader_annotations_since(pool, user, uuid, since)
        .await
        .unwrap()
}

fn ids(listing: &KoreaderListing) -> Vec<&str> {
    listing
        .annotations
        .iter()
        .map(|a| a.client_id.as_str())
        .collect()
}

fn device_upsert(client_id: &str, event_at: i64) -> KoreaderUpsert {
    KoreaderUpsert {
        client_id: client_id.into(),
        epub_cfi_range: CFI.into(),
        color: HighlightColor::Green,
        text: Some("device text".into()),
        note: Some("device note".into()),
        created_at: event_at,
        event_at,
    }
}

async fn upsert(
    pool: &SqlitePool,
    user: i64,
    uuid: &str,
    a: &KoreaderUpsert,
) -> Result<UpsertOutcome, HighlightError> {
    let mut tx = pool.begin().await.unwrap();
    let outcome = upsert_koreader_annotation(&mut tx, user, uuid, a).await;
    tx.commit().await.unwrap();
    outcome
}

async fn delete(pool: &SqlitePool, user: i64, uuid: &str, ids: &[&str]) {
    let ids: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
    let mut tx = pool.begin().await.unwrap();
    delete_koreader_annotations(&mut tx, user, uuid, &ids)
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

async fn stored(
    pool: &SqlitePool,
    user: i64,
    client_id: &str,
) -> Option<(String, Option<String>, i64)> {
    sqlx::query_as(
        "SELECT color, note, updated_at FROM annotations WHERE user_id = ? AND client_id = ?",
    )
    .bind(user)
    .bind(client_id)
    .fetch_optional(pool)
    .await
    .unwrap()
}

mod koreader_annotations_since {
    use super::*;

    #[tokio::test]
    async fn mints_a_client_id_for_a_web_highlight_and_keeps_it() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        let h = create_highlight(&pool, user, &web_highlight(&uuid, None))
            .await
            .unwrap();
        sqlx::query("UPDATE annotations SET updated_at = 1234 WHERE id = ?")
            .bind(h.id)
            .execute(&pool)
            .await
            .unwrap();

        let first = listed(&pool, user, &uuid, 0).await;
        let second = listed(&pool, user, &uuid, 0).await;

        assert_eq!(first.annotations.len(), 1);
        let minted = &first.annotations[0];
        assert_eq!(minted.client_id.len(), 32);
        assert_eq!(minted.updated_at, 1234, "minting must not touch updated_at");
        assert_eq!(ids(&second), vec![minted.client_id.as_str()]);
    }

    #[tokio::test]
    async fn returns_only_rows_changed_at_or_after_the_cursor() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        for (id, at) in [("old", 100), ("edge", 200), ("new", 300)] {
            create_highlight(&pool, user, &web_highlight(&uuid, Some(id)))
                .await
                .unwrap();
            stamp(&pool, id, at).await;
        }

        let listing = listed(&pool, user, &uuid, 200).await;

        assert_eq!(ids(&listing), vec!["edge", "new"]);
    }

    #[tokio::test]
    async fn answers_a_cursor_taken_before_the_read() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        let before = now(&pool).await;

        let listing = listed(&pool, user, &uuid, 0).await;

        assert!((before..=now(&pool).await).contains(&listing.cursor));
    }

    #[tokio::test]
    async fn omits_rows_without_a_cfi() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        create_highlight(&pool, user, &web_highlight(&uuid, Some("web")))
            .await
            .unwrap();
        let kobo_only = IngestKoboAnnotation {
            client_id: "kobo".into(),
            color: HighlightColor::Green,
            text: None,
            note: None,
            kobo_location: r#"{"span":{"startPath":"span#kobo\\.1\\.2","startChar":3}}"#.into(),
            epub_cfi_range: None,
        };
        ingest_kobo_annotations(&pool, user, &uuid, &[kobo_only], &[])
            .await
            .unwrap();

        let listing = listed(&pool, user, &uuid, 0).await;

        assert_eq!(ids(&listing), vec!["web"]);
    }

    #[tokio::test]
    async fn scopes_the_listing_to_the_user_and_book() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let alice = seed_user(&pool, "alice").await;
        let bob = seed_user(&pool, "bob").await;
        let (_, book_a) = seed(&pool, "/lib", "Book A").await;
        let (_, book_b) = seed(&pool, "/lib", "Book B").await;
        for (user, uuid, id) in [
            (alice, &book_a, "mine"),
            (alice, &book_b, "other-book"),
            (bob, &book_a, "other-user"),
        ] {
            create_highlight(&pool, user, &web_highlight(uuid, Some(id)))
                .await
                .unwrap();
        }

        let listing = listed(&pool, alice, &book_a, 0).await;

        assert_eq!(ids(&listing), vec!["mine"]);
    }

    #[tokio::test]
    async fn lists_a_deleted_web_highlight_as_a_tombstone_until_the_cursor_passes_it() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        let h = create_highlight(&pool, user, &web_highlight(&uuid, Some("gone")))
            .await
            .unwrap();
        delete_highlight(&pool, user, h.id).await.unwrap();
        sqlx::query("UPDATE annotation_tombstones SET deleted_at = 500")
            .execute(&pool)
            .await
            .unwrap();

        let at_the_deletion = listed(&pool, user, &uuid, 500).await;
        let after_it = listed(&pool, user, &uuid, 501).await;

        assert_eq!(at_the_deletion.deleted, vec!["gone"]);
        assert!(at_the_deletion.annotations.is_empty());
        assert!(after_it.deleted.is_empty());
    }

    #[tokio::test]
    async fn lists_a_kobo_deleted_annotation_as_a_tombstone() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        create_highlight(&pool, user, &web_highlight(&uuid, Some("kobo-1")))
            .await
            .unwrap();

        ingest_kobo_annotations(&pool, user, &uuid, &[], &["kobo-1".to_string()])
            .await
            .unwrap();

        let listing = listed(&pool, user, &uuid, 0).await;
        assert_eq!(listing.deleted, vec!["kobo-1"]);
        assert!(listing.annotations.is_empty());
    }

    #[tokio::test]
    async fn answers_the_last_row_time_as_the_cursor_when_the_cap_is_hit() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        sqlx::query(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i <= ?)
             INSERT INTO annotations (user_id, book_uuid, epub_cfi_range, client_id, updated_at)
             SELECT ?, ?, 'epubcfi(/6/2!/4/2,/1:0,/1:1)', 'c' || i, 10000 + i FROM n",
        )
        .bind(LIST_HIGHLIGHTS_LIMIT)
        .bind(user)
        .bind(&uuid)
        .execute(&pool)
        .await
        .unwrap();

        let listing = listed(&pool, user, &uuid, 0).await;

        assert_eq!(listing.annotations.len() as i64, LIST_HIGHLIGHTS_LIMIT);
        assert_eq!(listing.cursor, 10000 + LIST_HIGHLIGHTS_LIMIT);
    }
}

mod delete_highlight {
    use super::*;

    #[tokio::test]
    async fn writes_no_tombstone_for_a_row_without_a_client_id() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        let h = create_highlight(&pool, user, &web_highlight(&uuid, None))
            .await
            .unwrap();

        delete_highlight(&pool, user, h.id).await.unwrap();

        let tombstones: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM annotation_tombstones")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(tombstones, 0);
    }

    #[tokio::test]
    async fn returns_not_found_and_keeps_another_users_row() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let alice = seed_user(&pool, "alice").await;
        let bob = seed_user(&pool, "bob").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        let h = create_highlight(&pool, alice, &web_highlight(&uuid, Some("a1")))
            .await
            .unwrap();

        let by_bob = delete_highlight(&pool, bob, h.id).await.unwrap_err();
        let unknown = delete_highlight(&pool, alice, h.id + 100)
            .await
            .unwrap_err();

        assert!(matches!(by_bob, HighlightError::NotFound));
        assert!(matches!(unknown, HighlightError::NotFound));
        assert!(stored(&pool, alice, "a1").await.is_some());
        assert!(listed(&pool, alice, &uuid, 0).await.deleted.is_empty());
    }
}

mod upsert_koreader_annotation {
    use super::*;

    #[tokio::test]
    async fn inserts_a_new_row_dated_by_the_device() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        let before = now(&pool).await;
        let device_time = before - 3600;

        let outcome = upsert(&pool, user, &uuid, &device_upsert("k1", device_time))
            .await
            .unwrap();

        let UpsertOutcome::Applied(row) = outcome else {
            panic!("expected Applied, got {outcome:?}");
        };
        assert_eq!(row.client_id, "k1");
        assert_eq!(row.epub_cfi_range, CFI);
        assert_eq!(row.color, HighlightColor::Green);
        assert_eq!(row.text.as_deref(), Some("device text"));
        assert_eq!(row.note.as_deref(), Some("device note"));
        assert_eq!(row.created_at, device_time);
        assert!((before..=now(&pool).await).contains(&row.updated_at));
    }

    #[tokio::test]
    async fn applies_a_newer_edit_and_stamps_the_receipt_time() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        upsert(&pool, user, &uuid, &device_upsert("k1", 1000))
            .await
            .unwrap();
        stamp(&pool, "k1", 5000).await;
        let before = now(&pool).await;
        let edit = KoreaderUpsert {
            color: HighlightColor::Violet,
            note: Some("edited".into()),
            ..device_upsert("k1", 6000)
        };

        let outcome = upsert(&pool, user, &uuid, &edit).await.unwrap();

        let UpsertOutcome::Applied(row) = outcome else {
            panic!("expected Applied, got {outcome:?}");
        };
        assert_eq!(row.color, HighlightColor::Violet);
        assert_eq!(row.note.as_deref(), Some("edited"));
        assert!(row.updated_at >= before);
        assert_eq!(row.created_at, 1000, "an edit keeps the creation time");
    }

    #[tokio::test]
    async fn keeps_a_newer_stored_row_as_stale() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        upsert(&pool, user, &uuid, &device_upsert("k1", 1000))
            .await
            .unwrap();
        stamp(&pool, "k1", 5000).await;
        let older = KoreaderUpsert {
            color: HighlightColor::Violet,
            note: Some("older edit".into()),
            ..device_upsert("k1", 4000)
        };

        let outcome = upsert(&pool, user, &uuid, &older).await.unwrap();

        let UpsertOutcome::Stale(row) = outcome else {
            panic!("expected Stale, got {outcome:?}");
        };
        assert_eq!(row.note.as_deref(), Some("device note"));
        assert_eq!(row.color, HighlightColor::Green);
        assert_eq!(row.updated_at, 5000);
        assert_eq!(
            stored(&pool, user, "k1").await,
            Some(("green".into(), Some("device note".into()), 5000))
        );
    }

    #[tokio::test]
    async fn clamps_a_future_event_time_to_now_so_it_lands() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        upsert(&pool, user, &uuid, &device_upsert("k1", 1000))
            .await
            .unwrap();
        stamp(&pool, "k1", 5000).await;
        let skewed = KoreaderUpsert {
            note: Some("from the future".into()),
            ..device_upsert("k1", now(&pool).await + 86_400)
        };

        let outcome = upsert(&pool, user, &uuid, &skewed).await.unwrap();

        let UpsertOutcome::Applied(row) = outcome else {
            panic!("expected Applied, got {outcome:?}");
        };
        assert!(
            row.updated_at <= now(&pool).await,
            "stamped with receipt time"
        );
        assert_eq!(row.note.as_deref(), Some("from the future"));
    }

    #[tokio::test]
    async fn answers_deleted_for_a_tombstoned_id_and_writes_nothing() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        let h = create_highlight(&pool, user, &web_highlight(&uuid, Some("k1")))
            .await
            .unwrap();
        delete_highlight(&pool, user, h.id).await.unwrap();

        let outcome = upsert(&pool, user, &uuid, &device_upsert("k1", now(&pool).await))
            .await
            .unwrap();

        assert!(matches!(outcome, UpsertOutcome::Deleted));
        assert_eq!(stored(&pool, user, "k1").await, None);
    }

    async fn kobo_location_after_upsert(new_cfi: &str) -> Option<String> {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, uuid) = seed(&pool, "/lib", "Book A").await;
        let from_kobo = IngestKoboAnnotation {
            client_id: "k1".into(),
            color: HighlightColor::Green,
            text: None,
            note: None,
            kobo_location: r#"{"span":{"startPath":"span#kobo\\.1\\.2","startChar":3}}"#.into(),
            epub_cfi_range: Some(CFI.into()),
        };
        ingest_kobo_annotations(&pool, user, &uuid, &[from_kobo], &[])
            .await
            .unwrap();
        stamp(&pool, "k1", 5000).await;
        let moved = KoreaderUpsert {
            epub_cfi_range: new_cfi.into(),
            ..device_upsert("k1", 6000)
        };

        upsert(&pool, user, &uuid, &moved).await.unwrap();

        sqlx::query_scalar("SELECT kobo_location FROM annotations WHERE client_id = 'k1'")
            .fetch_one(&pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn clears_the_kobo_anchor_when_the_cfi_moves() {
        let moved = kobo_location_after_upsert("epubcfi(/6/2!/4/50,/1:0,/1:5)").await;

        assert_eq!(moved, None);
    }

    #[tokio::test]
    async fn keeps_the_kobo_anchor_when_the_cfi_is_unchanged() {
        let kept = kobo_location_after_upsert(CFI).await;

        assert!(kept.is_some_and(|location| location.contains("startPath")));
    }

    #[tokio::test]
    async fn returns_not_found_for_an_id_that_belongs_to_another_book() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let user = seed_user(&pool, "alice").await;
        let (_, book_a) = seed(&pool, "/lib", "Book A").await;
        let (_, book_b) = seed(&pool, "/lib", "Book B").await;
        create_highlight(&pool, user, &web_highlight(&book_a, Some("k1")))
            .await
            .unwrap();

        let err = upsert(&pool, user, &book_b, &device_upsert("k1", now(&pool).await))
            .await
            .unwrap_err();

        assert!(matches!(err, HighlightError::NotFound));
        assert_eq!(
            stored(&pool, user, "k1").await.map(|(color, ..)| color),
            Some("rose".to_string()),
            "the other book's row is untouched"
        );
    }
}

mod delete_koreader_annotations {
    use super::*;

    #[tokio::test]
    async fn deletes_only_this_users_rows_in_this_book_and_tombstones_them() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let alice = seed_user(&pool, "alice").await;
        let bob = seed_user(&pool, "bob").await;
        let (_, book_a) = seed(&pool, "/lib", "Book A").await;
        let (_, book_b) = seed(&pool, "/lib", "Book B").await;
        for (user, uuid, id) in [
            (alice, &book_a, "mine"),
            (alice, &book_b, "other-book"),
            (bob, &book_a, "mine"),
        ] {
            create_highlight(&pool, user, &web_highlight(uuid, Some(id)))
                .await
                .unwrap();
        }

        delete(&pool, alice, &book_a, &["mine", "other-book", "unknown"]).await;

        assert!(stored(&pool, alice, "mine").await.is_none());
        assert!(stored(&pool, alice, "other-book").await.is_some());
        assert!(stored(&pool, bob, "mine").await.is_some());
        assert_eq!(listed(&pool, alice, &book_a, 0).await.deleted, vec!["mine"]);
        assert!(listed(&pool, alice, &book_b, 0).await.deleted.is_empty());
        assert!(listed(&pool, bob, &book_a, 0).await.deleted.is_empty());
    }
}
