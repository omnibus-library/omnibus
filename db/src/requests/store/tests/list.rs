//! The requests a list shows: every reader's, or one book's, one reader's or one state's.

use sqlx::{QueryBuilder, Row};

use crate::{create_fileless_book, FilelessBook};

use super::super::list::push_select;
use super::*;

async fn seed_book(pool: &SqlitePool, title: &str) -> String {
    create_fileless_book(
        pool,
        FilelessBook {
            title: title.to_string(),
            authors: vec!["Bram Stoker".to_string()],
            isbn: None,
            pubdate: None,
            description: None,
            cover: None,
        },
    )
    .await
    .unwrap()
}

async fn seed_request(pool: &SqlitePool, user: i64, book_uuid: &str) -> i64 {
    start(pool, user, book_uuid, RequestKind::Ebook, MAX_LIVE)
        .await
        .unwrap()
        .request
        .id
}

fn ids(listed: &[Listed]) -> Vec<i64> {
    listed.iter().map(|l| l.request.id).collect()
}

#[tokio::test]
async fn returns_every_readers_requests_newest_first_with_the_book_and_requester() {
    let pool = pool().await;
    let ada = seed_user(&pool, "ada").await;
    let grace = seed_user(&pool, "grace").await;
    let dracula = seed_book(&pool, "Dracula").await;
    let carmilla = seed_book(&pool, "Carmilla").await;
    let first = seed_request(&pool, ada, &dracula).await;
    let second = seed_request(&pool, grace, &carmilla).await;

    let listed = list(&pool, ListFilter::default()).await.unwrap();

    assert_eq!(ids(&listed), [second, first]);
    assert_eq!(listed[0].book.title.as_deref(), Some("Carmilla"));
    assert_eq!(listed[0].requester_name, "grace");
    assert_eq!(listed[1].requester_name, "ada");
}

#[tokio::test]
async fn narrows_to_one_book() {
    let pool = pool().await;
    let ada = seed_user(&pool, "ada").await;
    let dracula = seed_book(&pool, "Dracula").await;
    let carmilla = seed_book(&pool, "Carmilla").await;
    let wanted = seed_request(&pool, ada, &dracula).await;
    seed_request(&pool, ada, &carmilla).await;

    let filter = ListFilter {
        book_uuid: Some(&dracula),
        ..ListFilter::default()
    };
    let listed = list(&pool, filter).await.unwrap();

    assert_eq!(ids(&listed), [wanted]);
}

#[tokio::test]
async fn narrows_to_one_reader() {
    let pool = pool().await;
    let ada = seed_user(&pool, "ada").await;
    let grace = seed_user(&pool, "grace").await;
    let dracula = seed_book(&pool, "Dracula").await;
    let wanted = seed_request(&pool, grace, &dracula).await;
    seed_request(&pool, ada, &dracula).await;

    let filter = ListFilter {
        user_id: Some(grace),
        ..ListFilter::default()
    };
    let listed = list(&pool, filter).await.unwrap();

    assert_eq!(ids(&listed), [wanted]);
}

#[tokio::test]
async fn narrows_to_one_state() {
    let pool = pool().await;
    let ada = seed_user(&pool, "ada").await;
    let dracula = seed_book(&pool, "Dracula").await;
    let carmilla = seed_book(&pool, "Carmilla").await;
    let wanted = seed_request(&pool, ada, &dracula).await;
    seed_request(&pool, ada, &carmilla).await;
    cancel(&pool, wanted, ada, NOW).await.unwrap();

    let filter = ListFilter {
        state: Some(RequestState::Cancelled),
        ..ListFilter::default()
    };
    let listed = list(&pool, filter).await.unwrap();

    assert_eq!(ids(&listed), [wanted]);
}

#[tokio::test]
async fn names_who_cancelled_a_request() {
    let pool = pool().await;
    let ada = seed_user(&pool, "ada").await;
    let admin = seed_user(&pool, "root").await;
    sqlx::query("UPDATE users SET display_name = 'The Admin' WHERE id = ?")
        .bind(admin)
        .execute(&pool)
        .await
        .unwrap();
    let dracula = seed_book(&pool, "Dracula").await;
    let id = seed_request(&pool, ada, &dracula).await;
    cancel(&pool, id, admin, NOW).await.unwrap();

    let listed = list(&pool, ListFilter::default()).await.unwrap();

    assert_eq!(listed[0].cancelled_by_name.as_deref(), Some("The Admin"));
}

#[tokio::test]
async fn carries_the_picked_version_and_those_given_up_but_no_other() {
    let pool = pool().await;
    let (id, picked, other) = on_its_way_with_two_versions(&pool).await;
    let dracula = seed_book(&pool, "Dracula").await;
    sqlx::query("UPDATE book_requests SET book_uuid = ? WHERE id = ?")
        .bind(&dracula)
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    seed_result(&pool, id, "never tried", 700.0, 0).await;
    swap(&pool, id, NOW, None).await.unwrap();
    choose(&pool, id, other).await.unwrap();

    let listed = list(&pool, ListFilter::default()).await.unwrap();

    let versions: Vec<(i64, bool)> = listed[0]
        .versions
        .iter()
        .map(|v| (v.id, v.rejected))
        .collect();
    assert_eq!(versions, [(other, false), (picked, true)]);
}

#[tokio::test]
async fn finds_one_books_requests_through_its_index() {
    let pool = pool().await;
    let filter = ListFilter {
        book_uuid: Some("book-1"),
        ..ListFilter::default()
    };
    let mut explain = QueryBuilder::new("EXPLAIN QUERY PLAN ");
    push_select(&mut explain, filter);

    let plan: Vec<String> = explain
        .build()
        .fetch_all(&pool)
        .await
        .unwrap()
        .iter()
        .map(|row| row.get("detail"))
        .collect();

    assert!(
        plan.iter()
            .any(|step| step.contains("USING INDEX idx_book_requests_book")),
        "{plan:?}"
    );
}
