//! `GET /api/ebooks?stack_series=true`: a series with 2+ books folds into one
//! row carrying its members and the caller's reading state in `stacks`; every
//! other form of the request is unchanged.

use axum::{body::to_bytes, http::StatusCode, Router};
use omnibus_db::test_support::indexed;
use omnibus_shared::{SeriesStack, Settings, StackMemberState};
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

use super::super::*;

/// Point settings at `/lib` and index `books` there.
async fn seed_library(pool: &sqlx::SqlitePool, books: Vec<db::ebook::IndexedBook>) {
    db::set_settings(
        pool,
        &Settings {
            ebook_library_path: Some("/lib".into()),
            audiobook_library_path: None,
            scan_interval_hours: None,
        },
    )
    .await
    .unwrap();
    db::replace_books(pool, "/lib", books).await.unwrap();
}

/// An indexed book titled `title`, in `series` at its index when given.
fn book(file: &str, title: &str, series: Option<(&str, &str)>) -> db::ebook::IndexedBook {
    indexed(file, Some(title), &["Ann Author"], &[], series, None)
}

/// A two-book "Saga" series and one standalone book.
fn saga_and_lone() -> Vec<db::ebook::IndexedBook> {
    vec![
        book("saga-1.epub", "Saga One", Some(("Saga", "1"))),
        book("saga-2.epub", "Saga Two", Some(("Saga", "2"))),
        book("lone.epub", "Lone Book", None),
    ]
}

/// A new reader's id and bearer token.
async fn reader(pool: &sqlx::SqlitePool, name: &str) -> (i64, String) {
    let user = auth_test_support::create_user(pool, name).await;
    let token = auth_test_support::bearer_token(pool, user.id).await;
    (user.id, token)
}

/// One `GET /api/ebooks` response, unpacked.
struct Page {
    total: Option<String>,
    next: Option<String>,
    body: serde_json::Value,
}

impl Page {
    fn titles(&self) -> Vec<String> {
        self.body["books"]
            .as_array()
            .map(|books| {
                books
                    .iter()
                    .filter_map(|b| b["title"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn stacks(&self) -> Vec<SeriesStack> {
        self.body
            .get("stacks")
            .map(|s| serde_json::from_value(s.clone()).unwrap())
            .unwrap_or_default()
    }
}

/// GET `uri` as the bearer of `token`, asserting a 200.
async fn get_page(app: &Router, uri: &str, token: &str) -> Page {
    let resp = app
        .clone()
        .oneshot(get_with_bearer(uri, token))
        .await
        .expect("request should succeed");
    assert_eq!(resp.status(), StatusCode::OK, "{uri}");
    let header = |name: &str| {
        resp.headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let (total, next) = (header("X-Total-Count"), header("X-Next-Cursor"));
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    Page {
        total,
        next,
        body: serde_json::from_slice(&bytes).unwrap(),
    }
}

#[tokio::test]
async fn api_get_ebooks_with_stack_series_folds_a_series_into_its_first_sorting_member() {
    let (app, _state, pool) = fixture().await;
    let (_, token) = reader(&pool, "alice").await;
    seed_library(&pool, saga_and_lone()).await;

    let page = get_page(
        &app,
        "/api/ebooks?sort=title&dir=asc&stack_series=true",
        &token,
    )
    .await;

    assert_eq!(page.titles(), vec!["Lone Book", "Saga One"]);
    let stacks = page.stacks();
    assert_eq!(stacks.len(), 1);
    assert_eq!(stacks[0].name, "Saga");
    let members: Vec<_> = stacks[0]
        .members
        .iter()
        .filter_map(|m| m.title.as_deref())
        .collect();
    assert_eq!(members, vec!["Saga One", "Saga Two"]);
    assert_eq!(
        page.total.as_deref(),
        Some("3"),
        "X-Total-Count counts books, not tiles"
    );
}

#[tokio::test]
async fn api_get_ebooks_omits_stacks_unless_a_keyset_page_asks_for_them() {
    let (app, _state, pool) = fixture().await;
    let (_, token) = reader(&pool, "alice").await;
    seed_library(&pool, saga_and_lone()).await;

    // The last URI is the param-less full-library form, which ignores the flag.
    for uri in [
        "/api/ebooks?sort=title&dir=asc",
        "/api/ebooks?sort=title&dir=asc&stack_series=false",
        "/api/ebooks?stack_series=true",
    ] {
        let page = get_page(&app, uri, &token).await;
        assert_eq!(page.titles().len(), 3, "{uri}");
        assert!(
            page.body.get("stacks").is_none(),
            "{uri} carries no stacks key"
        );
    }
}

#[tokio::test]
async fn api_get_ebooks_stacked_second_page_still_carries_stacks() {
    let (app, _state, pool) = fixture().await;
    let (_, token) = reader(&pool, "alice").await;
    seed_library(&pool, saga_and_lone()).await;
    let uri = "/api/ebooks?sort=title&dir=asc&limit=1&stack_series=true";

    let first = get_page(&app, uri, &token).await;
    let cursor = first.next.expect("a second page");
    let second = get_page(&app, &format!("{uri}&cursor={cursor}"), &token).await;

    assert_eq!(second.titles(), vec!["Saga One"]);
    assert_eq!(second.stacks().len(), 1, "the cursor keeps the stacked form");
}

#[tokio::test]
async fn api_get_ebooks_stacked_reports_the_callers_reading_state_only() {
    let (app, _state, pool) = fixture().await;
    let (alice, token) = reader(&pool, "alice").await;
    let (bob, _) = reader(&pool, "bob").await;
    seed_library(&pool, saga_and_lone()).await;
    let two: String = sqlx::query_scalar("SELECT uuid FROM books WHERE title = 'Saga Two'")
        .fetch_one(&pool)
        .await
        .unwrap();
    for (user_id, status) in [(alice, "reading"), (bob, "finished")] {
        sqlx::query("INSERT INTO book_read_status (user_id, book_uuid, status) VALUES (?, ?, ?)")
            .bind(user_id)
            .bind(&two)
            .bind(status)
            .execute(&pool)
            .await
            .unwrap();
    }

    let page = get_page(
        &app,
        "/api/ebooks?sort=title&dir=asc&stack_series=true",
        &token,
    )
    .await;

    assert_eq!(
        page.stacks()[0].state_of(&two),
        Some(&StackMemberState {
            uuid: two.clone(),
            percent: None,
            started: true,
            finished: false,
        }),
        "alice is reading it; bob's finish is not hers"
    );
}
