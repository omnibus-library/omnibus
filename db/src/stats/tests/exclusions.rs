//! A reader's stats exclusion rule: books matching it contribute nothing to
//! their figures (finishes, time, streak, goals, pages, ratings, the session
//! log), the rule is the target reader's whoever asks, and book pages stay
//! unfiltered. Each test claims its own user ids, since `user_stats` reads
//! through the process-wide cache.

use omnibus_shared::{
    ChartBreakdown, ChartBucket, ChartMeasure, ChartSpec, FilterClause, FilterField, FilterMode,
    ReadingGoalUpdate, ViewFilters,
};

use crate::auth::set_stats_exclusions;
use crate::init_db;
use crate::test_support::seed_minimal_books;

use super::super::*;
use super::{
    book_id, finish_journal, link_tag, listening_session, rate_book, reading_session,
    seed_user_with_id, this_month_secs, DAY, T0,
};

const SPORTS: &str = "Sports";

fn include(field: FilterField, value: &str) -> ViewFilters {
    ViewFilters {
        clauses: vec![FilterClause::new(field, FilterMode::Include, &[value])],
    }
}

/// A pool with two books, `uuid-2` tagged [`SPORTS`], and one reader whose rule
/// leaves out [`SPORTS`] books, already materialized into their excluded set.
async fn pool_with_sports_rule(user_id: i64) -> (SqlitePool, i64) {
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_minimal_books(&pool, 2).await;
    let id = book_id(&pool, "uuid-2").await;
    link_tag(&pool, id, SPORTS).await;
    let user = seed_user_with_id(&pool, user_id, "reader").await;
    set_stats_exclusions(&pool, user, &include(FilterField::Tag, SPORTS))
        .await
        .unwrap();
    // Book-scoped reads never refresh, so the set must exist before they run.
    refresh_exclusions(&pool, user).await.unwrap();
    (pool, user)
}

async fn all_time(pool: &SqlitePool, user: i64) -> StatsSummary {
    user_stats(pool, user, StatsRange::AllTime, Some(0))
        .await
        .unwrap()
}

#[tokio::test]
async fn user_stats_leaves_matching_book_out_of_books_finished() {
    let (pool, user) = pool_with_sports_rule(9960).await;
    finish_journal(&pool, user, "uuid-1", T0).await;
    finish_journal(&pool, user, "uuid-2", T0).await;

    let s = all_time(&pool, user).await;

    assert_eq!(s.books_finished, 1);
    let rail: Vec<&str> = s
        .finished_books
        .iter()
        .map(|b| b.book_uuid.as_str())
        .collect();
    assert_eq!(rail, ["uuid-1"]);
}

#[tokio::test]
async fn user_stats_leaves_matching_book_out_of_reading_seconds() {
    let (pool, user) = pool_with_sports_rule(9961).await;
    reading_session(&pool, user, "uuid-1", T0, 600).await;
    reading_session(&pool, user, "uuid-2", T0 + 1_000, 900).await;
    listening_session(&pool, user, "uuid-1", T0 + 2_000, 300).await;
    listening_session(&pool, user, "uuid-2", T0 + 3_000, 450).await;

    let s = all_time(&pool, user).await;

    assert_eq!(s.reading_seconds, 600);
    assert_eq!(s.listening_seconds, 300);
}

#[tokio::test]
async fn user_stats_leaves_matching_book_out_of_heatmap() {
    let (pool, user) = pool_with_sports_rule(9980).await;
    reading_session(&pool, user, "uuid-1", T0, 600).await;
    reading_session(&pool, user, "uuid-2", T0 + 1_000, 900).await;

    let s = all_time(&pool, user).await;

    assert_eq!(s.heatmap.iter().map(|d| d.seconds).sum::<i64>(), 600);
}

#[tokio::test]
async fn chart_series_leaves_matching_book_out_of_reading_minutes() {
    let (pool, user) = pool_with_sports_rule(9981).await;
    reading_session(&pool, user, "uuid-1", T0, 600).await;
    reading_session(&pool, user, "uuid-2", T0 + 1_000, 900).await;
    let spec = ChartSpec {
        measures: vec![ChartMeasure::ReadingMinutes],
        bucket: ChartBucket::Year,
        range: StatsRange::AllTime,
        breakdown: ChartBreakdown::None,
    };

    let r = chart_series(&pool, user, &spec, Some(0)).await.unwrap();

    // The year axis runs through today, so later buckets are present and zero.
    let total: f64 = r.series[0].values.iter().flatten().sum();
    assert_eq!(total, 10.0);
}

#[tokio::test]
async fn user_stats_counts_every_book_when_rule_is_empty() {
    let (pool, user) = pool_with_sports_rule(9962).await;
    set_stats_exclusions(&pool, user, &ViewFilters::default())
        .await
        .unwrap();
    finish_journal(&pool, user, "uuid-1", T0).await;
    finish_journal(&pool, user, "uuid-2", T0).await;

    assert_eq!(all_time(&pool, user).await.books_finished, 2);
}

#[tokio::test]
async fn user_stats_counts_every_book_when_rule_has_no_usable_value() {
    let (pool, user) = pool_with_sports_rule(9963).await;
    // Bypasses the setter, which would reject a blank value, to reach the
    // `MATCH_ALL` predicate: it must leave nothing out, not everything.
    sqlx::query("UPDATE users SET stats_exclusions = ? WHERE id = ?")
        .bind(r#"{"clauses":[{"field":"tag","mode":"include","values":[" "]}]}"#)
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    finish_journal(&pool, user, "uuid-1", T0).await;
    finish_journal(&pool, user, "uuid-2", T0).await;

    assert_eq!(all_time(&pool, user).await.books_finished, 2);
}

#[tokio::test]
async fn user_stats_drops_book_once_it_gains_excluded_tag() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_minimal_books(&pool, 2).await;
    let user = seed_user_with_id(&pool, 9964, "reader").await;
    set_stats_exclusions(&pool, user, &include(FilterField::Tag, SPORTS))
        .await
        .unwrap();
    finish_journal(&pool, user, "uuid-1", T0).await;
    finish_journal(&pool, user, "uuid-2", T0).await;
    // Warms the cache with nothing matching yet.
    assert_eq!(all_time(&pool, user).await.books_finished, 2);

    let id = book_id(&pool, "uuid-2").await;
    link_tag(&pool, id, SPORTS).await;

    assert_eq!(all_time(&pool, user).await.books_finished, 1);
}

#[tokio::test]
async fn user_stats_counts_book_again_once_it_loses_excluded_tag() {
    let (pool, user) = pool_with_sports_rule(9965).await;
    finish_journal(&pool, user, "uuid-1", T0).await;
    finish_journal(&pool, user, "uuid-2", T0).await;
    assert_eq!(all_time(&pool, user).await.books_finished, 1);

    sqlx::query("DELETE FROM books_tags_link")
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(all_time(&pool, user).await.books_finished, 2);
}

#[tokio::test]
async fn user_stats_leaves_other_readers_stats_unfiltered() {
    let (pool, user) = pool_with_sports_rule(9966).await;
    let other = seed_user_with_id(&pool, 9967, "other").await;
    for reader in [user, other] {
        finish_journal(&pool, reader, "uuid-1", T0).await;
        finish_journal(&pool, reader, "uuid-2", T0).await;
    }

    assert_eq!(all_time(&pool, user).await.books_finished, 1);
    assert_eq!(all_time(&pool, other).await.books_finished, 2);
}

#[tokio::test]
async fn streak_leaves_days_read_only_in_matching_books_out_of_streak() {
    let (pool, user) = pool_with_sports_rule(9968).await;
    let day0 = 19_675 * DAY; // 2023-11-14 00:00 UTC
    reading_session(&pool, user, "uuid-1", day0 + 3_600, 600).await;
    reading_session(&pool, user, "uuid-2", day0 + DAY + 3_600, 600).await;
    reading_session(&pool, user, "uuid-2", day0 + 2 * DAY + 3_600, 600).await;

    let s = all_time(&pool, user).await;

    assert_eq!(s.active_days, 1);
    assert_eq!(s.longest_streak_days, 1);
}

#[tokio::test]
async fn goal_for_year_leaves_matching_finishes_out_of_goal_progress() {
    let (pool, user) = pool_with_sports_rule(9969).await;
    let when = this_month_secs(&pool).await;
    finish_journal(&pool, user, "uuid-1", when).await;
    finish_journal(&pool, user, "uuid-2", when).await;
    let year = current_year(&pool, 0).await.unwrap();
    set_goal(&pool, user, &ReadingGoalUpdate::books(24), Some(0))
        .await
        .unwrap();

    let goal = goal_for_year(&pool, user, year, Some(0))
        .await
        .unwrap()
        .unwrap();

    assert_eq!(goal.current, 1);
}

#[tokio::test]
async fn daily_goals_leaves_matching_sessions_out_of_daily_minutes() {
    let (pool, user) = pool_with_sports_rule(9970).await;
    let today_open: i64 =
        sqlx::query_scalar("SELECT CAST(strftime('%s', 'now', 'start of day') AS INTEGER)")
            .fetch_one(&pool)
            .await
            .unwrap();
    reading_session(&pool, user, "uuid-1", today_open, 1_200).await;
    reading_session(&pool, user, "uuid-2", today_open, 1_800).await;

    let goals = daily_goals(&pool, user, Some(0)).await.unwrap();

    assert_eq!(goals.minutes_today, Some(20));
}

#[tokio::test]
async fn pages_read_leaves_matching_books_pages_out() {
    let (pool, user) = pool_with_sports_rule(9971).await;
    sqlx::query("UPDATE books SET page_count = 200")
        .execute(&pool)
        .await
        .unwrap();
    for uuid in ["uuid-1", "uuid-2"] {
        sqlx::query(
            "INSERT INTO reading_progress_daily (user_id, book_uuid, format, day, percent_gained)
             VALUES (?, ?, 'epub', '2023-11-14', 50)",
        )
        .bind(user)
        .bind(uuid)
        .execute(&pool)
        .await
        .unwrap();
    }

    assert_eq!(all_time(&pool, user).await.pages_read, Some(100));
}

#[tokio::test]
async fn ratings_leaves_matching_books_out_of_average_rating() {
    let (pool, user) = pool_with_sports_rule(9972).await;
    rate_book(&pool, user, "uuid-1", 8, T0).await;
    rate_book(&pool, user, "uuid-2", 2, T0).await;

    assert_eq!(all_time(&pool, user).await.avg_stars, Some(4.0));
}

#[tokio::test]
async fn session_log_leaves_sessions_on_matching_books_out() {
    let (pool, user) = pool_with_sports_rule(9973).await;
    reading_session(&pool, user, "uuid-1", T0, 600).await;
    reading_session(&pool, user, "uuid-2", T0 + DAY, 600).await;

    let log = session_log(&pool, user, None, None, 25).await.unwrap();

    let books: Vec<&str> = log.entries.iter().map(|e| e.book_uuid.as_str()).collect();
    assert_eq!(books, ["uuid-1"]);
}

#[tokio::test]
async fn session_log_keeps_sessions_on_matching_book_when_scoped_to_it() {
    let (pool, user) = pool_with_sports_rule(9974).await;
    reading_session(&pool, user, "uuid-2", T0, 600).await;

    let log = session_log(&pool, user, Some("uuid-2"), None, 25)
        .await
        .unwrap();

    assert_eq!(log.entries.len(), 1);
}

#[tokio::test]
async fn book_insights_still_reports_time_on_excluded_book() {
    let (pool, user) = pool_with_sports_rule(9975).await;
    reading_session(&pool, user, "uuid-2", T0, 600).await;

    let insights = book_insights(&pool, user, "uuid-2", Some(0))
        .await
        .unwrap()
        .expect("the book page keeps its sittings");

    assert_eq!(insights.seconds_total, 600);
}

#[tokio::test]
async fn stats_for_viewer_applies_target_readers_rule_for_viewer() {
    let (pool, target) = pool_with_sports_rule(9976).await;
    let viewer = seed_user_with_id(&pool, 9977, "viewer").await;
    finish_journal(&pool, target, "uuid-1", T0).await;
    finish_journal(&pool, target, "uuid-2", T0).await;

    let s = stats_for_viewer(&pool, viewer, Some(target), StatsRange::AllTime, Some(0))
        .await
        .unwrap();

    assert_eq!(s.books_finished, 1);
}

#[tokio::test]
async fn stats_for_viewer_evaluates_shelf_clause_as_target_reader() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_minimal_books(&pool, 2).await;
    let target = seed_user_with_id(&pool, 9978, "target").await;
    let viewer = seed_user_with_id(&pool, 9979, "viewer").await;
    // The target's private shelf: the viewer can't see it, so a rule read as
    // the viewer would match nothing.
    let shelf: i64 = sqlx::query_scalar(
        "INSERT INTO shelves (owner_user_id, kind, name) VALUES (?, 'manual', 'private') RETURNING id",
    )
    .bind(target)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO shelf_books (shelf_id, book_uuid) VALUES (?, 'uuid-2')")
        .bind(shelf)
        .execute(&pool)
        .await
        .unwrap();
    set_stats_exclusions(
        &pool,
        target,
        &include(FilterField::Shelf, &shelf.to_string()),
    )
    .await
    .unwrap();
    finish_journal(&pool, target, "uuid-1", T0).await;
    finish_journal(&pool, target, "uuid-2", T0).await;

    let s = stats_for_viewer(&pool, viewer, Some(target), StatsRange::AllTime, Some(0))
        .await
        .unwrap();

    assert_eq!(s.books_finished, 1);
}
