//! Merge then undo, end to end: read status and reviews back on the book they
//! came from with every column intact, the refusals, older snapshots, and the
//! identifier tuples that travel with them.

use super::*;
use crate::merge::{merge_books, undo_merge, MergeError};
use crate::pool::init_db;
use crate::test_support::{
    count_rows as count, seed_synced_audiobook as seed_audiobook, seed_synced_ebook as seed_ebook,
    seed_user,
};

#[tokio::test]
async fn undo_merge_returns_curation_to_each_book_when_the_absorbed_side_won() {
    // #2234: undo left curation wherever the merge had put it, so the survivor
    // kept the absorbed book's read status and the absorbed book came back
    // carrying none. Both sides hold a *different* status and a full review
    // here, with the absorbed book's the newer.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;

    seed_curation(&pool, user, &target, "reading", 8, 1_000).await;
    seed_curation(&pool, user, &source, "finished", 5, 2_000).await;

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    // The newer side's status wins; the two reviews fold into one.
    let absorbed = review(user, 5, 2_000);
    assert_eq!(
        curation_of(&pool, user, &target).await,
        (
            Some(status(user, "finished", 2_000)),
            Some(ReviewRow {
                notes_md: Some("notes 2000\n\nnotes 1000".into()),
                created_at: Some(980),
                ..absorbed
            })
        )
    );

    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(
        curation_of(&pool, user, &target).await,
        curated(user, "reading", 8, 1_000),
        "the survivor must get its own pre-merge curation back, every column included"
    );
    assert_eq!(
        curation_of(&pool, user, &source).await,
        curated(user, "finished", 5, 2_000),
        "the restored book must come back with its own, not with nothing"
    );
}

#[tokio::test]
async fn undo_merge_recreates_curation_the_merge_deleted_when_the_survivor_won() {
    // The mirror direction, and the harder one: the survivor's rows were newer,
    // so the merge *deleted* the absorbed book's outright. Undo can only put
    // them back from the snapshot, which is why the merge has to record both
    // sides rather than just the surviving one.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;

    seed_curation(&pool, user, &target, "reading", 8, 3_000).await;
    seed_curation(&pool, user, &source, "finished", 5, 2_000).await;

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    let survivor = review(user, 8, 3_000);
    assert_eq!(
        curation_of(&pool, user, &target).await,
        (
            Some(status(user, "reading", 3_000)),
            Some(ReviewRow {
                notes_md: Some("notes 3000\n\nnotes 2000".into()),
                created_at: Some(1_980),
                ..survivor
            })
        )
    );

    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(
        curation_of(&pool, user, &target).await,
        curated(user, "reading", 8, 3_000)
    );
    assert_eq!(
        curation_of(&pool, user, &source).await,
        curated(user, "finished", 5, 2_000)
    );
}

#[tokio::test]
async fn undo_merge_clears_the_survivors_curation_when_only_the_absorbed_book_had_any() {
    // Nothing to restore on the survivor means the row has to *go*, not stay:
    // leaving it is exactly how the absorbed book's read status ended up
    // permanently attributed to the wrong book.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;

    seed_curation(&pool, user, &source, "finished", 5, 2_000).await;

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(curation_of(&pool, user, &target).await, NONE);
    assert_eq!(
        curation_of(&pool, user, &source).await,
        curated(user, "finished", 5, 2_000)
    );
}

#[tokio::test]
async fn undo_merge_leaves_a_reader_the_merge_never_moved_a_row_for_alone() {
    // A reader who curated only the survivor was untouched by the merge, so its
    // undo must not touch them either — including when they have curated it
    // since, which is not a conflict because nothing of theirs ever moved.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let mover = seed_user(&pool, "mover").await;
    let bystander = seed_user(&pool, "bystander").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;

    seed_curation(&pool, mover, &source, "finished", 5, 2_000).await;
    seed_curation(&pool, bystander, &target, "reading", 3, 1_000).await;

    let out = merge_books(&pool, &source, &target, Some(mover))
        .await
        .unwrap();
    sqlx::query("UPDATE reviews SET half_stars = 10 WHERE user_id = ?")
        .bind(bystander)
        .execute(&pool)
        .await
        .unwrap();

    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(
        curation_of(&pool, bystander, &target).await,
        (
            Some(status(bystander, "reading", 1_000)),
            Some(ReviewRow {
                half_stars: Some(10),
                ..review(bystander, 3, 1_000)
            })
        )
    );
    assert_eq!(curation_of(&pool, mover, &target).await, NONE);
}

#[tokio::test]
async fn undo_merge_survives_a_reader_whose_account_was_deleted_after_the_merge() {
    // Both tables cascade on `users(id)`, so deleting the account took the row
    // off the survivor. Treating that as a re-curation would refuse the undo
    // forever, naming a user that no longer exists — and before the curation
    // snapshot existed this undo simply worked.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "departing").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;
    seed_curation(&pool, user, &source, "finished", 5, 2_000).await;

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();

    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(count(&pool, "SELECT COUNT(*) FROM books").await, 2);
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM book_read_status").await,
        0,
        "the departed reader's rows must not be resurrected against a dead FK"
    );
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM reviews").await, 0);
}

#[tokio::test]
async fn undo_merge_allows_a_timestamp_only_touch_of_the_survivor() {
    // Opening the merged book auto-writes `reading`, which bumps `updated_at`
    // without deciding anything. Refusing there would make undo unusable in
    // the ordinary case of looking at the book you just merged.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;
    seed_curation(&pool, user, &target, "reading", 8, 1_000).await;
    seed_curation(&pool, user, &source, "reading", 5, 2_000).await;

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    for table in ["book_read_status", "reviews"] {
        sqlx::query(&format!(
            "UPDATE {table} SET updated_at = 9000 WHERE book_uuid = ?"
        ))
        .bind(&target)
        .execute(&pool)
        .await
        .unwrap();
    }

    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(
        curation_of(&pool, user, &target).await,
        curated(user, "reading", 8, 1_000)
    );
    assert_eq!(
        curation_of(&pool, user, &source).await,
        curated(user, "reading", 5, 2_000)
    );
}

#[tokio::test]
async fn undo_merge_refuses_when_the_survivors_read_status_was_recurated() {
    // The reader marked the merged book finished, then asked to undo. The
    // pre-merge value and that later decision are both real and undo has no
    // basis to choose, so it fails loudly and changes nothing.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;

    seed_curation(&pool, user, &target, "reading", 8, 1_000).await;
    seed_curation(&pool, user, &source, "unread", 5, 2_000).await;

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    sqlx::query("UPDATE book_read_status SET status = 'finished' WHERE book_uuid = ?")
        .bind(&target)
        .execute(&pool)
        .await
        .unwrap();

    let err = undo_merge(&pool, out.merge_log_id).await.unwrap_err();
    assert!(matches!(err, MergeError::UndoConflict(_)), "got {err:?}");
    assert!(err.to_string().contains("read status"), "got {err}");

    // The whole undo rolled back — the source book is still absorbed and the
    // log is still open, so the admin can resolve the two rows and retry.
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM books").await, 1);
    let undone: Option<i64> = sqlx::query_scalar("SELECT undone_at FROM merge_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(undone.is_none());
}

#[tokio::test]
async fn undo_merge_refuses_when_only_the_survivors_rating_was_recurated() {
    // The rating half has its own planner call and its own message; a refusal
    // that only ever fires for read status would leave it unproven.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;

    seed_curation(&pool, user, &target, "reading", 8, 1_000).await;
    seed_curation(&pool, user, &source, "reading", 5, 2_000).await;

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    // Read status left exactly as the merge produced it, so only the rating
    // planner can raise.
    sqlx::query("UPDATE reviews SET half_stars = 2 WHERE book_uuid = ?")
        .bind(&target)
        .execute(&pool)
        .await
        .unwrap();

    let err = undo_merge(&pool, out.merge_log_id).await.unwrap_err();
    assert!(matches!(err, MergeError::UndoConflict(_)), "got {err:?}");
    assert!(err.to_string().contains("review"), "got {err}");
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM books").await, 1);
}

#[tokio::test]
async fn undo_merge_refuses_when_a_later_open_merge_moved_the_same_readers_row() {
    // Two books merged into one. The second merge's dedupe deleted its own
    // source's row, which the first merge's snapshot cannot see — so undoing
    // the first would clear the survivor's row and destroy a value that then
    // exists nowhere, with the second undo permanently unable to restore it.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let first = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;
    let second = seed_ebook(&pool, "C/Dracula rev.epub", "Draculla", "Bram Stoker").await;

    seed_curation(&pool, user, &first, "finished", 10, 3_000).await;
    seed_curation(&pool, user, &second, "reading", 4, 1_000).await;

    let one = merge_books(&pool, &first, &target, Some(user))
        .await
        .unwrap();
    merge_books(&pool, &second, &target, Some(user))
        .await
        .unwrap();
    let merged = curation_of(&pool, user, &target).await;

    let err = undo_merge(&pool, one.merge_log_id).await.unwrap_err();
    assert!(matches!(err, MergeError::UndoConflict(_)), "got {err:?}");
    assert!(err.to_string().contains("later merge"), "got {err}");

    // Nothing was destroyed: the survivor still carries what both merges left,
    // and the second merge's own undo is still available to recover the rest.
    assert_eq!(curation_of(&pool, user, &target).await, merged);
}

#[tokio::test]
async fn undo_merge_allows_it_when_a_later_merge_moved_only_the_other_curation_table() {
    // The two tables collide independently. A later merge that moved only this
    // reader's *rating* says nothing about their read status, so folding both
    // into one claimed-reader set would refuse an undo that was never
    // ambiguous.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let first = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;
    let second = seed_ebook(&pool, "C/Dracula rev.epub", "Draculla", "Bram Stoker").await;

    // Read status only on the first book, rating only on the second.
    seed_status(&pool, &first, &status(user, "finished", 2_000)).await;
    seed_review(&pool, &second, &rating(user, 7, 2_000)).await;

    let one = merge_books(&pool, &first, &target, Some(user))
        .await
        .unwrap();
    merge_books(&pool, &second, &target, Some(user))
        .await
        .unwrap();

    undo_merge(&pool, one.merge_log_id).await.unwrap();

    assert_eq!(
        curation_of(&pool, user, &first).await,
        (Some(status(user, "finished", 2_000)), None),
        "the restored book gets its read status back"
    );
    assert_eq!(
        curation_of(&pool, user, &target).await,
        (None, Some(rating(user, 7, 2_000))),
        "and the survivor keeps the rating the still-open second merge moved"
    );
}

/// Rewrite merge `id`'s snapshot through `edit`, standing in for a `merge_log`
/// row an older build wrote.
async fn rewrite_snapshot(
    pool: &sqlx::SqlitePool,
    id: i64,
    edit: impl FnOnce(&mut serde_json::Map<String, serde_json::Value>),
) {
    let json: String = sqlx::query_scalar("SELECT source_metadata FROM merge_log WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&json).unwrap();
    edit(value.as_object_mut().unwrap());
    sqlx::query("UPDATE merge_log SET source_metadata = ? WHERE id = ?")
        .bind(value.to_string())
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn undo_merge_leaves_curation_and_identifiers_alone_for_an_older_merge_log() {
    // `curation` / `identifiers_added_to_target` are `#[serde(default)]`, so a
    // merge recorded before they existed still replays — undoing it leaves both
    // where the old undo left them rather than failing to decode.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;
    seed_curation(&pool, user, &source, "finished", 5, 2_000).await;
    seed_identifier(&pool, &source, "isbn", "999").await;

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    rewrite_snapshot(&pool, out.merge_log_id, |obj| {
        assert!(obj.remove("curation").is_some());
        assert!(obj.remove("identifiers_added_to_target").is_some());
    })
    .await;

    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(count(&pool, "SELECT COUNT(*) FROM books").await, 2);
    assert_eq!(
        curation_of(&pool, user, &target).await,
        curated(user, "finished", 5, 2_000),
        "an old snapshot carries no curation to restore, so it stays put"
    );
    assert_eq!(
        identifiers_of(&pool, &target).await,
        vec![ident("isbn", "999")],
        "and no record of what it added, so the survivor keeps the tuple"
    );
}

#[tokio::test]
async fn undo_merge_dates_a_rating_from_a_snapshot_written_before_reviews_existed() {
    // A merge recorded while ratings were their own table snapshotted each as
    // `{user_id, half_stars, updated_at}`. Undo must still restore it, setting
    // `rated_at` with the stars — the table's CHECK demands both or neither —
    // and both missing dates from the one it has.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;
    seed_review(&pool, &target, &rating(user, 8, 1_000)).await;
    seed_review(&pool, &source, &rating(user, 5, 2_000)).await;

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();
    rewrite_snapshot(&pool, out.merge_log_id, |obj| {
        let curation = obj["curation"].as_object_mut().unwrap();
        for side in ["source_ratings", "target_ratings", "merged_ratings"] {
            for row in curation[side].as_array_mut().unwrap() {
                row.as_object_mut()
                    .unwrap()
                    .retain(|k, _| ["user_id", "half_stars", "updated_at"].contains(&k.as_str()));
            }
        }
    })
    .await;
    // The two dates the old shape lacks, moved off `updated_at` on the live
    // rows, so only a restore that derives them can land on `updated_at`.
    sqlx::query("UPDATE reviews SET rated_at = 1, created_at = 1")
        .execute(&pool)
        .await
        .unwrap();

    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(
        review_of(&pool, user, &target).await,
        Some(rating(user, 8, 1_000))
    );
    assert_eq!(
        review_of(&pool, user, &source).await,
        Some(rating(user, 5, 2_000))
    );
}

// --- identifiers ---

/// Stamp an identifier tuple on the book with `book_uuid`.
async fn seed_identifier(pool: &sqlx::SqlitePool, book_uuid: &str, scheme: &str, value: &str) {
    sqlx::query(
        "INSERT INTO book_identifiers (book_id, scheme, value)
         VALUES ((SELECT id FROM books WHERE uuid = ?), ?, ?)",
    )
    .bind(book_uuid)
    .bind(scheme)
    .bind(value)
    .execute(pool)
    .await
    .unwrap();
}

/// A book's `(scheme, value)` identifier tuples, ordered for comparison.
async fn identifiers_of(pool: &sqlx::SqlitePool, book_uuid: &str) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT scheme, value FROM book_identifiers
          WHERE book_id = (SELECT id FROM books WHERE uuid = ?)
          ORDER BY scheme, value",
    )
    .bind(book_uuid)
    .fetch_all(pool)
    .await
    .unwrap()
}

fn ident(scheme: &str, value: &str) -> (String, String) {
    (scheme.to_string(), value.to_string())
}

#[tokio::test]
async fn undo_merge_takes_back_only_the_identifiers_the_merge_added() {
    // #2234: the absorbed book's ISBN stayed stamped on the survivor forever,
    // where the check-in exact-identifier rung then resolved it to the wrong
    // book. The shared `amazon` tuple is the control — it was on the survivor
    // already, so the merge did not add it and undo has no claim on it.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;

    seed_identifier(&pool, &target, "isbn", "111").await;
    seed_identifier(&pool, &target, "amazon", "shared").await;
    seed_identifier(&pool, &source, "isbn", "999").await;
    seed_identifier(&pool, &source, "amazon", "shared").await;

    let out = merge_books(&pool, &source, &target, None).await.unwrap();
    assert_eq!(
        identifiers_of(&pool, &target).await,
        vec![
            ident("amazon", "shared"),
            ident("isbn", "111"),
            ident("isbn", "999")
        ]
    );

    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(
        identifiers_of(&pool, &target).await,
        vec![ident("amazon", "shared"), ident("isbn", "111")],
        "the absorbed book's ISBN must not outlive the merge on the survivor"
    );
    assert_eq!(
        identifiers_of(&pool, &source).await,
        vec![ident("amazon", "shared"), ident("isbn", "999")]
    );
}

#[tokio::test]
async fn undo_merge_refuses_out_of_order_when_a_later_merge_supplies_the_same_identifier() {
    // Two copies of one edition merged into a third book, both carrying the
    // same ISBN. Only the *first* merge records it as added, so out of order
    // there is no right answer: stripping it leaves the survivor with no ISBN
    // while it still holds the second book, and skipping leaks the tuple
    // forever — the second merge's undo has nothing recorded to remove.
    // Reverse order settles both.
    let pool = init_db("sqlite::memory:").await.unwrap();
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let first = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;
    let second = seed_ebook(&pool, "C/Dracula rev.epub", "Draculla", "Bram Stoker").await;
    seed_identifier(&pool, &first, "isbn", "9780000000001").await;
    seed_identifier(&pool, &second, "isbn", "9780000000001").await;

    let one = merge_books(&pool, &first, &target, None).await.unwrap();
    let two = merge_books(&pool, &second, &target, None).await.unwrap();

    let err = undo_merge(&pool, one.merge_log_id).await.unwrap_err();
    assert!(matches!(err, MergeError::UndoConflict(_)), "got {err:?}");
    assert!(err.to_string().contains("identifier"), "got {err}");

    // In reverse the survivor keeps the ISBN while it still holds the first
    // book, then loses it with that book — and never keeps one it never had.
    undo_merge(&pool, two.merge_log_id).await.unwrap();
    assert_eq!(
        identifiers_of(&pool, &target).await,
        vec![ident("isbn", "9780000000001")],
        "the still-absorbed first book keeps supplying the ISBN"
    );
    undo_merge(&pool, one.merge_log_id).await.unwrap();
    assert!(
        identifiers_of(&pool, &target).await.is_empty(),
        "with both books restored the survivor keeps nothing it never had"
    );
    for book in [&first, &second] {
        assert_eq!(
            identifiers_of(&pool, book).await,
            vec![ident("isbn", "9780000000001")]
        );
    }
}
