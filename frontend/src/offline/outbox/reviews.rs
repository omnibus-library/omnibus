//! The review ops' queue side. A patch of your review is field-level, so a
//! queued one merges with the next (each field takes its later value, an
//! explicit null included) instead of being replaced by it; a delete clears
//! every queued patch of the book. Both share the `review:<uuid>` coalesce
//! key, so one book queues at most a delete followed by one merged patch.

use omnibus_shared::{Review, ReviewPatch};

use crate::offline::{cache, store};

use super::{apply, enqueue, Op};

/// `older` then `newer` as one patch: every field takes the value the later
/// of the two gave it, so a field `newer` leaves out keeps `older`'s.
pub(crate) fn merged_patch(older: &ReviewPatch, newer: &ReviewPatch) -> ReviewPatch {
    ReviewPatch {
        stars: newer.stars.or(older.stars),
        body_md: newer.body_md.clone().or_else(|| older.body_md.clone()),
        notes_md: newer.notes_md.clone().or_else(|| older.notes_md.clone()),
        spoiler: newer.spoiler.or(older.spoiler),
    }
}

/// The payload a queued op becomes once `newer` folds into it, or `None`
/// when it isn't a patch of the same review: a delete stays queued ahead.
pub(crate) fn merge_queued(older: &str, newer: &Op) -> Option<String> {
    let Ok(Op::UpdateReview {
        uuid,
        patch: queued,
    }) = serde_json::from_str::<Op>(older)
    else {
        return None;
    };
    let Op::UpdateReview {
        uuid: newer_uuid,
        patch,
    } = newer
    else {
        return None;
    };
    if uuid != *newer_uuid {
        return None;
    }
    let patch = merged_patch(&queued, patch);
    serde_json::to_string(&Op::UpdateReview { uuid, patch }).ok()
}

/// Queue a patch of your review of `uuid`. Answers your review as the
/// replica now holds it (`None` once the patch empties it), or `None`
/// outright without a store.
pub(crate) async fn queue_update_review(uuid: &str, patch: &ReviewPatch) -> Option<Option<Review>> {
    let queued = enqueue(Op::UpdateReview {
        uuid: uuid.to_string(),
        patch: patch.clone(),
    })
    .await;
    if !queued {
        return None;
    }
    Some(apply::review_patched(uuid, patch, store::now_secs()).await)
}

/// Queue a delete of your review of `uuid`.
pub(crate) async fn queue_delete_review(uuid: &str) -> bool {
    let queued = enqueue(Op::DeleteReview {
        uuid: uuid.to_string(),
    })
    .await;
    if queued {
        apply::review_deleted(uuid).await;
    }
    queued
}

/// Whether a write to your review of `uuid` is queued, the retired rating
/// ops included. A new write for the book must queue behind it: landing
/// first, it would be undone when the older one replays.
pub(crate) async fn review_queued(uuid: &str) -> bool {
    review_ops_queued(uuid, None).await > 0
}

/// How many queued ops write your review of `uuid`, leaving out `except`.
async fn review_ops_queued(uuid: &str, except: Option<&Op>) -> usize {
    let Some(st) = store::store() else { return 0 };
    st.ops_list()
        .await
        .iter()
        .filter_map(|row| serde_json::from_str::<Op>(&row.payload).ok())
        .filter(|op| review_target(op) == Some(uuid) && Some(op) != except)
        .count()
}

/// The book whose review `op` writes, if it writes one.
pub(crate) fn review_target(op: &Op) -> Option<&str> {
    match op {
        Op::UpdateReview { uuid, .. } | Op::DeleteReview { uuid } | Op::ClearRating { uuid } => {
            Some(uuid)
        }
        Op::SetRating { update } => Some(&update.book_uuid),
        _ => None,
    }
}

/// Settle the replica after `replayed`, a queued write to your review, landed
/// and the server answered `mine`. The answer is stored only while no other
/// write to the review is queued (a later one, or one merged into `replayed`
/// while it was in flight), whose optimistic copy it would undo. Either way
/// the book's reviews are re-read on their next view, for the household.
pub(crate) async fn review_replayed(replayed: &Op, mine: Option<&Review>) {
    let Some(uuid) = review_target(replayed) else {
        return;
    };
    // A delete may have taken stars with it.
    let stars = match replayed {
        Op::UpdateReview { patch, .. } => patch.stars.is_some(),
        _ => true,
    };
    if review_ops_queued(uuid, Some(replayed)).await == 0 {
        apply::review_landed(uuid, mine, stars).await;
    } else if stars {
        apply::ratings_moved();
    }
    cache::expire(&cache::keys::reviews(uuid));
}

/// [`review_replayed`] for a retired rating op, whose answer isn't a review.
pub(crate) fn rating_replayed(uuid: &str) {
    apply::ratings_moved();
    cache::expire(&cache::keys::reviews(uuid));
}
