//! A reader's two reviews folded into one across a merge: the per-field rules
//! in isolation, then end to end with the undo that splits them again, and the
//! image sweep that must not run past a review only an open snapshot holds —
//! nor keep one a cascaded snapshot no longer can.

use omnibus_shared::ReviewPatch;

use super::*;
use crate::journal_images::{self, journal_images_dir};
use crate::merge::{merge_books, undo_merge};
use crate::pool::init_db;
use crate::test_support::{
    count_rows as count, seed_synced_audiobook as seed_audiobook, seed_synced_ebook as seed_ebook,
    seed_user, EnvVarGuard,
};

/// A fresh journal image, and the Markdown that embeds it.
fn embedded_image() -> (String, String) {
    let name = journal_images::write_journal_image("image/png", b"bytes").unwrap();
    let embed = format!("![map]({IMAGE_URL_PREFIX}{name})");
    (name, embed)
}

fn notes_only(user_id: i64, notes: &str, ts: i64) -> ReviewRow {
    ReviewRow {
        half_stars: None,
        rated_at: None,
        notes_md: Some(notes.into()),
        ..rating(user_id, 1, ts)
    }
}

#[test]
fn settle_takes_the_stars_from_the_later_rating_and_never_from_a_side_without_any() {
    // The newer review by `updated_at` is not always the later rating: a text
    // edit moves one and not the other.
    let target = ReviewRow {
        rated_at: Some(500),
        ..rating(1, 8, 3_000)
    };
    let source = ReviewRow {
        rated_at: Some(900),
        ..rating(1, 4, 1_000)
    };
    let merged = ReviewRow::settle(&target, &source);
    assert_eq!((merged.half_stars, merged.rated_at), (Some(4), Some(900)));

    let unrated = ReviewRow {
        half_stars: None,
        rated_at: None,
        body_md: Some("words only".into()),
        ..rating(1, 1, 9_000)
    };
    let merged = ReviewRow::settle(&unrated, &source);
    assert_eq!((merged.half_stars, merged.rated_at), (Some(4), Some(900)));
}

#[test]
fn settle_keeps_the_only_text_with_its_spoiler_flag_even_from_the_older_review() {
    let newer = rating(1, 8, 3_000);
    let older = ReviewRow {
        body_md: Some("the only words".into()),
        spoiler: true,
        ..rating(1, 4, 1_000)
    };
    let merged = ReviewRow::settle(&newer, &older);
    assert_eq!(merged.body_md.as_deref(), Some("the only words"));
    assert!(merged.spoiler);
}

#[test]
fn settle_keeps_the_newer_reviews_text_and_both_sides_notes_newer_first() {
    let target = ReviewRow {
        body_md: Some("old take".into()),
        notes_md: Some("lent to Sam".into()),
        ..rating(1, 8, 1_000)
    };
    let source = ReviewRow {
        body_md: Some("new take".into()),
        notes_md: Some("reread in 2024".into()),
        ..rating(1, 4, 2_000)
    };
    let merged = ReviewRow::settle(&target, &source);
    assert_eq!(merged.body_md.as_deref(), Some("new take"));
    assert_eq!(
        merged.notes_md.as_deref(),
        Some("reread in 2024\n\nlent to Sam")
    );

    let same = ReviewRow::settle(&target, &target.clone());
    assert_eq!(same.notes_md.as_deref(), Some("lent to Sam"));
}

#[test]
fn settle_dates_a_text_review_from_its_text_and_never_from_a_notes_only_side() {
    // Others see the merged review's dates and sort by them, so a side holding
    // only private notes must not move them — however old or new its own are.
    let rated = rating(1, 8, 1_000);
    let written = ReviewRow {
        body_md: Some("words".into()),
        ..rating(1, 4, 2_000)
    };
    let private = notes_only(1, "mine", 5_000);
    let merged = ReviewRow::settle(&rated, &written);
    assert_eq!((merged.created_at, merged.updated_at), (Some(2_000), 2_000));

    let early_private = notes_only(1, "mine", 10);
    for side in [&private, &early_private] {
        let merged = ReviewRow::settle(&rated, side);
        assert_eq!((merged.created_at, merged.updated_at), (Some(1_000), 1_000));
        assert_eq!(merged.notes_md.as_deref(), Some("mine"));
    }
}

#[test]
fn settle_keeps_only_the_newer_notes_when_both_together_would_pass_the_text_cap() {
    // Joined past the cap, every later save resending the notes would be
    // refused. Each side fits on its own, so the newer one always does.
    let half = REVIEW_TEXT_MAX_LEN / 2;
    let older = ReviewRow {
        notes_md: Some("a".repeat(half)),
        ..rating(1, 8, 1_000)
    };
    let newer = ReviewRow {
        notes_md: Some("b".repeat(half)),
        ..rating(1, 4, 2_000)
    };

    let merged = ReviewRow::settle(&older, &newer);

    assert_eq!(merged.notes_md, newer.notes_md);
    let resent = ReviewPatch {
        notes_md: Some(merged.notes_md),
        ..Default::default()
    };
    assert!(resent.validate().is_ok());

    let fits = ReviewRow {
        notes_md: Some("b".repeat(half - 2)),
        ..newer
    };
    let joined = ReviewRow::settle(&older, &fits).notes_md.unwrap();
    assert_eq!(
        joined.len(),
        REVIEW_TEXT_MAX_LEN,
        "exactly at the cap still joins"
    );
}

#[tokio::test]
async fn merge_books_keeps_the_absorbed_reviews_text_when_only_the_losing_side_has_any() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;
    let rated = rating(user, 8, 3_000);
    let written = ReviewRow {
        body_md: Some("Better read aloud".into()),
        spoiler: true,
        ..rating(user, 6, 2_000)
    };
    seed_review(&pool, &target, &rated).await;
    seed_review(&pool, &source, &written).await;

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();

    assert_eq!(
        review_of(&pool, user, &target).await,
        Some(ReviewRow {
            body_md: Some("Better read aloud".into()),
            spoiler: true,
            created_at: Some(2_000),
            ..rated.clone()
        }),
        "the newer review's stars, the only text, dated from that text"
    );

    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(review_of(&pool, user, &target).await, Some(rated));
    assert_eq!(review_of(&pool, user, &source).await, Some(written));
}

#[tokio::test]
async fn merge_books_keeps_both_sides_private_notes_and_undo_splits_them_again() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;
    let ebook = ReviewRow {
        notes_md: Some("lent to Sam".into()),
        ..rating(user, 8, 1_000)
    };
    let audio = notes_only(user, "the narrator rushes", 2_000);
    seed_review(&pool, &target, &ebook).await;
    seed_review(&pool, &source, &audio).await;

    let out = merge_books(&pool, &source, &target, Some(user))
        .await
        .unwrap();

    assert_eq!(
        review_of(&pool, user, &target).await,
        Some(ReviewRow {
            notes_md: Some("the narrator rushes\n\nlent to Sam".into()),
            ..ebook.clone()
        }),
        "both notes kept, and no date moved by the notes-only side"
    );

    undo_merge(&pool, out.merge_log_id).await.unwrap();

    assert_eq!(review_of(&pool, user, &target).await, Some(ebook));
    assert_eq!(review_of(&pool, user, &source).await, Some(audio));
}

/// Merge `source` into `target` where both reviews have text and the
/// `image_side` one embeds an image but is the older, so its text lives on
/// only in the merge's snapshot. Returns the merge log id and the image name.
async fn merge_dropping_the_text_with_an_image(
    pool: &sqlx::SqlitePool,
    user: i64,
    target: &str,
    source: &str,
    image_side: &str,
) -> (i64, String, ReviewRow) {
    let (name, embed) = embedded_image();
    let pictured = ReviewRow {
        body_md: Some(embed),
        ..rating(user, 5, 2_000)
    };
    let plain = ReviewRow {
        body_md: Some("plain words".into()),
        ..rating(user, 8, 3_000)
    };
    let other_side = if image_side == target { source } else { target };
    seed_review(pool, image_side, &pictured).await;
    seed_review(pool, other_side, &plain).await;
    let out = merge_books(pool, source, target, Some(user)).await.unwrap();
    assert_eq!(
        review_of(pool, user, target)
            .await
            .unwrap()
            .body_md
            .as_deref(),
        Some("plain words"),
        "the newer text wins, so the image survives only in the snapshot"
    );
    (out.merge_log_id, name, pictured)
}

#[tokio::test]
async fn undo_merge_brings_back_a_review_image_an_unrelated_sweep_ran_past() {
    let tmp = tempfile::tempdir().unwrap();
    let _env = EnvVarGuard::set_os("OMNIBUS_JOURNAL_IMAGES_DIR", Some(tmp.path().as_os_str()));
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let source = seed_audiobook(&pool, "B/Drakula.m4b", "Drakula", "Bram Stoker").await;
    // Once with the image on the absorbed side (`source_ratings`), once on the
    // survivor's own older review (`target_ratings`).
    for image_side in [&source, &target] {
        let (log, name, pictured) =
            merge_dropping_the_text_with_an_image(&pool, user, &target, &source, image_side).await;

        // Any other write that drops the same name asks the sweep about it.
        crate::journals::cleanup_orphaned_images(&pool, HashSet::from([name.clone()])).await;
        assert!(
            journal_images_dir().join(&name).exists(),
            "a merge that can still be undone holds the image"
        );

        undo_merge(&pool, log).await.unwrap();
        assert_eq!(review_of(&pool, user, image_side).await, Some(pictured));
        assert!(journal_images_dir().join(&name).exists());
        sqlx::query("DELETE FROM reviews")
            .execute(&pool)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn merge_books_sweeps_an_image_only_a_merge_into_the_absorbed_book_held() {
    // Absorbing B deletes it, and its `merge_log` rows cascade with it: the
    // earlier A-into-B merge can never be undone, so an image only its
    // snapshot kept is garbage the moment the second merge commits.
    let tmp = tempfile::tempdir().unwrap();
    let _env = EnvVarGuard::set_os("OMNIBUS_JOURNAL_IMAGES_DIR", Some(tmp.path().as_os_str()));
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let a = seed_audiobook(&pool, "A/Drakula.m4b", "Drakula", "Bram Stoker").await;
    let b = seed_ebook(&pool, "B/Dracula.epub", "Dracula", "Bram Stoker").await;
    let c = seed_ebook(&pool, "C/Dracula rev.epub", "Draculla", "Bram Stoker").await;
    let (_, name, _) = merge_dropping_the_text_with_an_image(&pool, user, &b, &a, &a).await;

    merge_books(&pool, &b, &c, Some(user)).await.unwrap();

    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM merge_log").await,
        1,
        "only the B-into-C log is left"
    );
    assert!(!journal_images_dir().join(&name).exists());
}

#[tokio::test]
async fn undoable_review_markdown_reads_both_sides_of_open_merges_that_embed_an_image() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let target = seed_ebook(&pool, "A/Dracula.epub", "Dracula", "Bram Stoker").await;
    let target_id: i64 = sqlx::query_scalar("SELECT id FROM books WHERE uuid = ?")
        .bind(&target)
        .fetch_one(&pool)
        .await
        .unwrap();
    let pictured = format!("![m]({IMAGE_URL_PREFIX}x.png)");
    let snapshot = |body: &str, notes: &str| {
        serde_json::json!({ "curation": {
            "source_ratings": [{ "user_id": 1, "half_stars": null, "body_md": body, "updated_at": 1 }],
            "target_ratings": [{ "user_id": 2, "half_stars": null, "notes_md": notes, "updated_at": 1 }],
        }})
        .to_string()
    };
    for (json, undone) in [
        (snapshot(&pictured, "beside it"), None),
        (snapshot("no picture", "none here"), None),
        (snapshot(&pictured, "undone"), Some(5)),
    ] {
        sqlx::query(
            "INSERT INTO merge_log (target_book_id, source_uuid, source_metadata, undone_at)
             VALUES (?, 'gone', ?, ?)",
        )
        .bind(target_id)
        .bind(json)
        .bind(undone)
        .execute(&pool)
        .await
        .unwrap();
    }

    let mut held = crate::merge::undoable_review_markdown(&pool, None)
        .await
        .unwrap();
    held.sort();

    assert_eq!(held, vec![pictured, "beside it".to_string()]);
}
