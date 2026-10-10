//! The `filter` query param on `GET /api/ebooks`: include/exclude clauses
//! narrowing the page and its total, the keyset trigger, the 400s a bad value
//! earns, and the shelf boundary a clause may not cross.

use axum::{body::to_bytes, http::StatusCode};
use omnibus_shared::{
    CreateShelfRequest, EbookLibrary, FilterClause, FilterField, FilterMode, Settings, ShelfKind,
    Visibility,
};
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

use super::super::*;

const ALL_TITLES: [&str; 4] = ["Alpha", "Bravo", "Charlie", "Delta"];

fn clause(field: FilterField, mode: FilterMode, values: &[&str]) -> FilterClause {
    FilterClause {
        field,
        mode,
        values: values.iter().map(|v| v.to_string()).collect(),
    }
}

/// The `filter=` query value for `clauses`, percent-encoded.
fn filter_param(clauses: &[FilterClause]) -> String {
    urlencoding::encode(&serde_json::to_string(clauses).unwrap()).into_owned()
}

/// Index `/lib` with an EPUB and an M4B tagged fantasy, an EPUB tagged
/// horror and an untagged EPUB, and point the ebook library at it.
async fn seed_tagged_library(pool: &sqlx::SqlitePool) {
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
    let book = |filename, title, tags: &[&str]| {
        db::test_support::indexed(filename, Some(title), &[], tags, None, None)
    };
    db::replace_books(
        pool,
        "/lib",
        vec![
            book("alpha.epub", "Alpha", &["fantasy"]),
            book("bravo.m4b", "Bravo", &["fantasy"]),
            book("charlie.epub", "Charlie", &["horror"]),
            book("delta.epub", "Delta", &[]),
        ],
    )
    .await
    .unwrap();
}

async fn book_uuid(pool: &sqlx::SqlitePool, title: &str) -> String {
    let books = db::list_books(pool, "/lib").await.unwrap();
    let book = books
        .iter()
        .find(|b| b.title.as_deref() == Some(title))
        .unwrap();
    book.unique_identifier.clone().unwrap()
}

struct Page {
    titles: Vec<String>,
    total: Option<String>,
    next: Option<String>,
}

async fn get_page(app: &axum::Router, token: &str, query: &str) -> Page {
    let response = app
        .clone()
        .oneshot(get_with_bearer(&format!("/api/ebooks?{query}"), token))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK, "GET /api/ebooks?{query}");
    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let (total, next) = (header("X-Total-Count"), header("X-Next-Cursor"));
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let lib: EbookLibrary = serde_json::from_slice(&bytes).unwrap();
    Page {
        titles: lib.books.into_iter().filter_map(|b| b.title).collect(),
        total,
        next,
    }
}

async fn get_status(app: &axum::Router, token: &str, query: &str) -> (StatusCode, String) {
    let response = app
        .clone()
        .oneshot(get_with_bearer(&format!("/api/ebooks?{query}"), token))
        .await
        .unwrap();
    (response.status(), body_text(response).await)
}

#[tokio::test]
async fn api_get_ebooks_filter_param_applies_include_and_exclude_clauses() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    seed_tagged_library(&pool).await;
    let filter = filter_param(&[
        clause(FilterField::Format, FilterMode::Include, &["epub"]),
        clause(FilterField::Tag, FilterMode::Exclude, &["horror"]),
    ]);

    let page = get_page(&app, &token, &format!("sort=title&dir=asc&filter={filter}")).await;

    assert_eq!(page.titles, vec!["Alpha", "Delta"]);
    assert_eq!(page.total.as_deref(), Some("2"));
}

#[tokio::test]
async fn api_get_ebooks_filter_param_keeps_later_pages_filtered() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    seed_tagged_library(&pool).await;
    let filter = filter_param(&[clause(FilterField::Tag, FilterMode::Exclude, &["horror"])]);

    let mut titles = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..ALL_TITLES.len() {
        let query = match &cursor {
            Some(c) => format!("sort=title&dir=asc&limit=1&filter={filter}&cursor={c}"),
            None => format!("sort=title&dir=asc&limit=1&filter={filter}"),
        };
        let page = get_page(&app, &token, &query).await;
        titles.extend(page.titles);
        cursor = page.next;
        if cursor.is_none() {
            break;
        }
    }

    assert_eq!(titles, vec!["Alpha", "Bravo", "Delta"]);
}

#[tokio::test]
async fn api_get_ebooks_filter_param_alone_switches_to_the_keyset_form() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    seed_tagged_library(&pool).await;
    let filter = filter_param(&[clause(FilterField::Tag, FilterMode::Include, &["fantasy"])]);

    let page = get_page(&app, &token, &format!("filter={filter}")).await;

    let mut titles = page.titles;
    titles.sort();
    assert_eq!(titles, vec!["Alpha", "Bravo"]);
    assert_eq!(page.total.as_deref(), Some("2"));
}

#[tokio::test]
async fn api_get_ebooks_filter_param_rejects_malformed_json_with_400() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    seed_tagged_library(&pool).await;

    let (status, body) = get_status(&app, &token, "filter=%5B%7B").await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.starts_with("invalid filter: "), "{body}");
}

#[tokio::test]
async fn api_get_ebooks_filter_param_rejects_too_many_clauses_with_400() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    seed_tagged_library(&pool).await;
    let clauses = vec![
        clause(FilterField::Tag, FilterMode::Include, &["fantasy"]);
        omnibus_shared::MAX_FILTER_CLAUSES + 1
    ];

    let (status, body) =
        get_status(&app, &token, &format!("filter={}", filter_param(&clauses))).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, "invalid filter: a filter may have at most 16 clauses");
}

#[tokio::test]
async fn api_get_ebooks_formats_param_still_applies_beside_a_filter_param() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    seed_tagged_library(&pool).await;
    let filter = filter_param(&[clause(FilterField::Tag, FilterMode::Include, &["fantasy"])]);

    let page = get_page(&app, &token, &format!("formats=epub&filter={filter}")).await;

    assert_eq!(page.titles, vec!["Alpha"]);
    assert_eq!(page.total.as_deref(), Some("1"));
}

#[tokio::test]
async fn api_get_ebooks_filter_param_ignores_another_readers_private_shelf() {
    let (app, _state, pool) = fixture().await;
    let alice = auth_test_support::create_user(&pool, "alice").await;
    let alice_token = auth_test_support::bearer_token(&pool, alice.id).await;
    let bob = auth_test_support::create_user(&pool, "bob").await;
    let bob_token = auth_test_support::bearer_token(&pool, bob.id).await;
    seed_tagged_library(&pool).await;
    let shelf = db::create_shelf(
        &pool,
        alice.id,
        &CreateShelfRequest {
            kind: ShelfKind::Manual,
            name: "Secret".into(),
            description: None,
            visibility: Visibility::Private,
            match_mode: None,
            rules: vec![],
            book_uuids: vec![book_uuid(&pool, "Alpha").await],
        },
    )
    .await
    .unwrap()
    .id
    .to_string();
    let on_shelf = filter_param(&[clause(FilterField::Shelf, FilterMode::Include, &[&shelf])]);
    let off_shelf = filter_param(&[clause(FilterField::Shelf, FilterMode::Exclude, &[&shelf])]);

    let owners = get_page(&app, &alice_token, &format!("filter={on_shelf}")).await;
    let included = get_page(&app, &bob_token, &format!("filter={on_shelf}")).await;
    let excluded = get_page(&app, &bob_token, &format!("filter={off_shelf}")).await;

    assert_eq!(owners.titles, vec!["Alpha"]);
    assert_eq!(included.titles, Vec::<String>::new());
    assert_eq!(included.total.as_deref(), Some("0"));
    assert_eq!(excluded.total.as_deref(), Some("4"));
}
