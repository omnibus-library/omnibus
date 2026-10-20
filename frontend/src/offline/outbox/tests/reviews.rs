//! Review ops in the queue: patches of one book merge field by field, a
//! delete supersedes them, and both apply to the cached reviews optimistically.

use omnibus_shared::{BookReviews, Review, ReviewBucket, ReviewPatch, ReviewSummary};

use crate::offline::outbox::reviews::merged_patch;

use super::*;

fn stars(value: f32) -> ReviewPatch {
    ReviewPatch {
        stars: Some(Some(value)),
        ..Default::default()
    }
}

fn text(body: &str) -> ReviewPatch {
    ReviewPatch {
        body_md: Some(Some(body.to_string())),
        ..Default::default()
    }
}

fn review(uuid: &str) -> Review {
    Review {
        book_uuid: uuid.to_string(),
        stars: Some(3.0),
        body_md: Some("Fine".into()),
        body_html: Some("<p>Fine</p>".into()),
        notes_md: None,
        notes_html: None,
        spoiler: false,
        rated_at: Some(10),
        created_at: 10,
        updated_at: 10,
        rated_at_iso: None,
        created_at_iso: None,
        updated_at_iso: None,
    }
}

fn summary() -> ReviewSummary {
    ReviewSummary {
        average_stars: 3.5,
        ratings: 2,
        buckets: (1..=10)
            .map(|half_stars| ReviewBucket {
                half_stars,
                readers: i64::from(half_stars == 6 || half_stars == 8),
            })
            .collect(),
    }
}

fn cache_reviews(uuid: &str, mine: Option<Review>) -> BookReviews {
    let reviews = BookReviews {
        mine,
        others: Vec::new(),
        summary: Some(summary()),
    };
    cache::put_json(&cache::keys::reviews(uuid), &reviews);
    reviews
}

async fn queued() -> Vec<Op> {
    let st = store::store().expect("store");
    st.ops_list()
        .await
        .iter()
        .map(|row| serde_json::from_str(&row.payload).expect("op"))
        .collect()
}

#[test]
fn merged_patch_keeps_each_fields_later_value_and_counts_an_explicit_null_as_one() {
    let older = ReviewPatch {
        stars: Some(Some(4.0)),
        body_md: Some(Some("Draft".into())),
        notes_md: None,
        spoiler: Some(true),
    };
    let newer = ReviewPatch {
        stars: Some(None),
        body_md: None,
        notes_md: Some(Some("Mine".into())),
        spoiler: None,
    };

    assert_eq!(
        merged_patch(&older, &newer),
        ReviewPatch {
            stars: Some(None),
            body_md: Some(Some("Draft".into())),
            notes_md: Some(Some("Mine".into())),
            spoiler: Some(true),
        }
    );
}

#[tokio::test]
async fn queued_patches_of_one_review_merge_into_one_op_and_other_books_queue_apart() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    queue_update_review("review-merge-a", &stars(4.0))
        .await
        .expect("q1");
    queue_update_review("review-merge-b", &stars(2.0))
        .await
        .expect("q2");
    queue_update_review("review-merge-a", &text("Loved it"))
        .await
        .expect("q3");

    let ops = queued().await;
    assert_eq!(ops.len(), 2, "one op per book");
    assert_eq!(
        ops[1],
        Op::UpdateReview {
            uuid: "review-merge-a".into(),
            patch: ReviewPatch {
                stars: Some(Some(4.0)),
                body_md: Some(Some("Loved it".into())),
                ..Default::default()
            },
        },
        "the text edit must not drop the queued stars"
    );
    clear_ops().await;
}

#[tokio::test]
async fn a_queued_delete_supersedes_the_books_patches_and_a_later_patch_queues_after_it() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    let uuid = "review-supersede";

    queue_update_review(uuid, &stars(4.0)).await.expect("q1");
    assert!(queue_delete_review(uuid).await);
    assert_eq!(queued().await, vec![Op::DeleteReview { uuid: uuid.into() }]);

    queue_update_review(uuid, &text("Second go"))
        .await
        .expect("q2");
    queue_update_review(uuid, &stars(5.0)).await.expect("q3");
    let ops = queued().await;
    assert_eq!(ops.len(), 2, "the delete stays ahead of the merged patch");
    assert_eq!(ops[0], Op::DeleteReview { uuid: uuid.into() });
    assert!(
        matches!(&ops[1], Op::UpdateReview { patch, .. }
            if patch.stars == Some(Some(5.0)) && patch.body_md == Some(Some("Second go".into()))),
        "got {:?}",
        ops[1]
    );
    clear_ops().await;
}

#[tokio::test]
async fn queue_update_review_draws_the_patch_on_the_cached_review_and_leaves_the_summary() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    let uuid = "review-apply";
    cache_reviews(uuid, Some(review(uuid)));

    let mine = queue_update_review(uuid, &text("Better on a reread\n\n<b>truly</b>"))
        .await
        .expect("queued")
        .expect("a review is left");

    assert_eq!(mine.stars, Some(3.0), "untouched fields stay");
    assert_eq!(
        mine.body_md.as_deref(),
        Some("Better on a reread\n\n<b>truly</b>")
    );
    // The source, escaped, until the server renders it.
    assert_eq!(
        mine.body_html.as_deref(),
        Some("<p>Better on a reread</p><p>&lt;b&gt;truly&lt;/b&gt;</p>")
    );
    let cached: BookReviews = cache::get_json(&cache::keys::reviews(uuid))
        .await
        .expect("cached");
    assert_eq!(cached.mine, Some(mine));
    assert_eq!(cached.summary, Some(summary()));
    clear_ops().await;
}

#[tokio::test]
async fn queue_delete_review_drops_your_review_from_the_cached_reviews() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    let uuid = "review-apply-delete";
    cache_reviews(uuid, Some(review(uuid)));

    assert!(queue_delete_review(uuid).await);

    let cached: BookReviews = cache::get_json(&cache::keys::reviews(uuid))
        .await
        .expect("cached");
    assert_eq!(cached.mine, None);
    assert_eq!(cached.summary, Some(summary()));
    clear_ops().await;
}

#[test]
fn patch_review_reads_blank_text_as_cleared_and_an_emptied_review_as_none() {
    let uuid = "review-pure";
    let blank = ReviewPatch {
        body_md: Some(Some("  \n ".into())),
        ..Default::default()
    };
    let cleared = apply::patch_review(Some(review(uuid)), &blank, uuid, 50).expect("stars left");
    assert_eq!((cleared.body_md, cleared.body_html), (None, None));
    assert_eq!(cleared.updated_at, 50);

    let no_stars = ReviewPatch {
        stars: Some(None),
        body_md: Some(None),
        ..Default::default()
    };
    assert_eq!(
        apply::patch_review(Some(review(uuid)), &no_stars, uuid, 50),
        None
    );
}

#[test]
fn patch_review_starts_a_review_from_nothing_and_leaves_updated_at_on_a_notes_edit() {
    let uuid = "review-pure-new";
    let rated = apply::patch_review(None, &stars(4.5), uuid, 70).expect("rated");
    assert_eq!(rated.stars, Some(4.5));
    assert_eq!((rated.rated_at, rated.created_at), (Some(70), 70));

    let notes = ReviewPatch {
        notes_md: Some(Some("Only for me".into())),
        ..Default::default()
    };
    let noted = apply::patch_review(Some(rated), &notes, uuid, 90).expect("noted");
    assert_eq!(noted.notes_html.as_deref(), Some("<p>Only for me</p>"));
    assert_eq!(
        noted.updated_at, 70,
        "notes are private, so they don't date the review"
    );
}

#[tokio::test]
async fn review_queued_counts_a_retired_rating_op_for_the_same_book_only() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    assert!(
        enqueue(Op::ClearRating {
            uuid: "review-legacy".into()
        })
        .await
    );

    assert!(review_queued("review-legacy").await);
    assert!(!review_queued("review-legacy-other").await);
    clear_ops().await;
}

#[tokio::test]
async fn review_replayed_stores_the_answer_only_when_no_other_write_to_the_review_is_queued() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    let uuid = "review-replayed";
    let key = cache::keys::reviews(uuid);
    cache_reviews(uuid, None);
    let rated = Op::UpdateReview {
        uuid: uuid.into(),
        patch: stars(4.0),
    };
    queue_update_review(uuid, &stars(4.0)).await.expect("q1");
    // A text edit merges into the queued patch while the drain replays it.
    queue_update_review(uuid, &text("Mid-flight"))
        .await
        .expect("q2");
    let answer = Review {
        stars: Some(4.0),
        body_md: None,
        body_html: None,
        ..review(uuid)
    };

    review_replayed(&rated, Some(&answer)).await;
    let cached: BookReviews = cache::get_json(&key).await.expect("cached");
    assert_eq!(
        cached.mine.and_then(|r| r.body_md).as_deref(),
        Some("Mid-flight"),
        "the merged write's optimistic text must survive the older answer"
    );

    clear_ops().await;
    review_replayed(&rated, Some(&answer)).await;
    let cached: BookReviews = cache::get_json(&key).await.expect("cached");
    assert_eq!(
        cached.mine,
        Some(answer),
        "nothing queued: the answer is kept"
    );
    let st = store::store().expect("store");
    assert_eq!(st.kv_get(&key).await.expect("row").fetched_at, 0);
}
