//! Tests for the curation snapshot, its replay and the review settlement,
//! split by sub-topic into the sibling modules below; the row builders and the
//! seed and read fixtures they share live here.

mod planner;
mod settle;
mod undo;

use super::*;

/// A bare rating, every date the one `ts`.
fn rating(user_id: i64, half_stars: i64, ts: i64) -> ReviewRow {
    ReviewRow {
        user_id,
        half_stars: Some(half_stars),
        body_md: None,
        notes_md: None,
        spoiler: false,
        rated_at: Some(ts),
        created_at: Some(ts),
        updated_at: ts,
    }
}

/// A review saying everything a review can, its three dates set apart so a
/// restore that swaps one for another shows. Even `half_stars` mark spoilers.
fn review(user_id: i64, half_stars: i64, ts: i64) -> ReviewRow {
    ReviewRow {
        user_id,
        half_stars: Some(half_stars),
        body_md: Some(format!("text {ts}")),
        notes_md: Some(format!("notes {ts}")),
        spoiler: half_stars % 2 == 0,
        rated_at: Some(ts - 10),
        created_at: Some(ts - 20),
        updated_at: ts,
    }
}

fn status(user_id: i64, status: &str, ts: i64) -> ReadStatusRow {
    ReadStatusRow {
        user_id,
        status: status.into(),
        updated_at: ts,
        finished_at: (status == "finished").then_some(ts),
    }
}

/// Owns the two id sets a [`PlanContext`] borrows, so a test can keep them
/// alive across the call.
struct Ctx {
    live: HashSet<i64>,
    claimed: HashSet<i64>,
}

impl Ctx {
    fn new(live: &[i64], claimed: &[i64]) -> Self {
        Ctx {
            live: live.iter().copied().collect(),
            claimed: claimed.iter().copied().collect(),
        }
    }

    fn plan(&self) -> PlanContext<'_> {
        PlanContext {
            live_users: &self.live,
            claimed_by_later_merges: &self.claimed,
        }
    }
}

async fn seed_status(pool: &sqlx::SqlitePool, book_uuid: &str, row: &ReadStatusRow) {
    sqlx::query(
        "INSERT INTO book_read_status (user_id, book_uuid, status, updated_at, finished_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(row.user_id)
    .bind(book_uuid)
    .bind(&row.status)
    .bind(row.updated_at)
    .bind(row.finished_at)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_review(pool: &sqlx::SqlitePool, book_uuid: &str, row: &ReviewRow) {
    sqlx::query(
        "INSERT INTO reviews (user_id, book_uuid, half_stars, body_md, notes_md, spoiler,
                              rated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(row.user_id)
    .bind(book_uuid)
    .bind(row.half_stars)
    .bind(&row.body_md)
    .bind(&row.notes_md)
    .bind(row.spoiler)
    .bind(row.rated_at)
    .bind(row.created_at)
    .bind(row.updated_at)
    .execute(pool)
    .await
    .unwrap();
}

/// Stamp the two things a merge settles per reader — a read status and a full
/// [`review`] — on `book_uuid`, both stamped `ts` so a test can say which side
/// the merge should treat as newer.
async fn seed_curation(
    pool: &sqlx::SqlitePool,
    user: i64,
    book_uuid: &str,
    read_status: &str,
    half_stars: i64,
    ts: i64,
) {
    seed_status(pool, book_uuid, &status(user, read_status, ts)).await;
    seed_review(pool, book_uuid, &review(user, half_stars, ts)).await;
}

async fn review_of(pool: &sqlx::SqlitePool, user: i64, book_uuid: &str) -> Option<ReviewRow> {
    sqlx::query_as(
        "SELECT user_id, half_stars, body_md, notes_md, spoiler, rated_at, created_at, updated_at
           FROM reviews WHERE user_id = ? AND book_uuid = ?",
    )
    .bind(user)
    .bind(book_uuid)
    .fetch_optional(pool)
    .await
    .unwrap()
}

/// One reader's whole curation on a book, each `None` where the row is absent.
/// Every column is compared, so a restore that recovers the stars but loses
/// the notes or a date still fails the assertion.
type Curation = (Option<ReadStatusRow>, Option<ReviewRow>);

async fn curation_of(pool: &sqlx::SqlitePool, user: i64, book_uuid: &str) -> Curation {
    let read_status = sqlx::query_as(
        "SELECT user_id, status, updated_at, finished_at FROM book_read_status
          WHERE user_id = ? AND book_uuid = ?",
    )
    .bind(user)
    .bind(book_uuid)
    .fetch_optional(pool)
    .await
    .unwrap();
    (read_status, review_of(pool, user, book_uuid).await)
}

/// The curation `seed_curation(_, user, _, read_status, half_stars, ts)` produced.
fn curated(user: i64, read_status: &str, half_stars: i64, ts: i64) -> Curation {
    (
        Some(status(user, read_status, ts)),
        Some(review(user, half_stars, ts)),
    )
}

const NONE: Curation = (None, None);
