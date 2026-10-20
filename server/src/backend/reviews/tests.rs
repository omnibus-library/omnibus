//! Tests for the book review REST handlers.
use axum::http::StatusCode;
use omnibus_shared::{BookReviews, Review};
use tower::ServiceExt;

use crate::backend::test_support::*;

fn patch(
    uuid: &str,
    token: &str,
    body: serde_json::Value,
) -> axum::http::Request<axum::body::Body> {
    request(
        "PATCH",
        &format!("/api/reviews/{uuid}"),
        Some(token),
        Some(body),
    )
}

#[tokio::test]
async fn api_patch_review_requires_auth() {
    let (app, _state, _pool) = fixture().await;
    let res = app
        .oneshot(request(
            "PATCH",
            "/api/reviews/x",
            None,
            Some(serde_json::json!({ "stars": 3 })),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_get_book_reviews_requires_auth() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;

    let res = app
        .oneshot(request("GET", &format!("/api/reviews/{uuid}"), None, None))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_delete_review_requires_auth_and_leaves_the_review_intact() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let (_, token) = reader(&pool, "alice").await;
    app.clone()
        .oneshot(patch(&uuid, &token, serde_json::json!({ "stars": 4 })))
        .await
        .unwrap();

    let res = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/api/reviews/{uuid}"),
            None,
            None,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let res = app
        .oneshot(get_with_bearer(&format!("/api/reviews/{uuid}"), &token))
        .await
        .unwrap();
    let reviews: BookReviews = body_json(res).await;
    assert_eq!(reviews.mine.unwrap().stars, Some(4.0));
}

#[tokio::test]
async fn api_patch_review_creates_then_changes_only_the_fields_sent() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let (_, token) = reader(&pool, "alice").await;

    let res = app
        .clone()
        .oneshot(patch(&uuid, &token, serde_json::json!({ "stars": 4.5 })))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .oneshot(patch(
            &uuid,
            &token,
            serde_json::json!({ "body_md": "*Great*", "notes_md": "mine", "spoiler": true }),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let review: Option<Review> = body_json(res).await;
    let review = review.unwrap();
    assert_eq!(review.stars, Some(4.5));
    assert_eq!(review.notes_md.as_deref(), Some("mine"));
    assert!(review.spoiler);
    assert!(review.body_html.unwrap().contains("<em>Great</em>"));
}

#[tokio::test]
async fn api_patch_review_returns_null_when_the_patch_empties_the_review() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let (_, token) = reader(&pool, "alice").await;
    app.clone()
        .oneshot(patch(&uuid, &token, serde_json::json!({ "stars": 2 })))
        .await
        .unwrap();

    let res = app
        .oneshot(patch(&uuid, &token, serde_json::json!({ "stars": null })))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let review: Option<Review> = body_json(res).await;
    assert_eq!(review, None);
}

#[tokio::test]
async fn api_patch_review_rejects_stars_off_the_half_star_scale() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let (_, token) = reader(&pool, "alice").await;

    let res = app
        .oneshot(patch(&uuid, &token, serde_json::json!({ "stars": 4.3 })))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn api_patch_review_returns_404_for_an_unknown_book() {
    let (app, _state, pool) = fixture().await;
    let (_, token) = reader(&pool, "alice").await;

    let res = app
        .oneshot(patch(
            "no-such-book",
            &token,
            serde_json::json!({ "stars": 3 }),
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_patch_review_returns_500_on_db_failure() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let (_, token) = reader(&pool, "alice").await;
    sqlx::query("DROP TABLE reviews")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(patch(&uuid, &token, serde_json::json!({ "stars": 3 })))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn api_get_book_reviews_hides_other_readers_notes() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let (_, alice) = reader(&pool, "alice").await;
    let (bob_id, bob) = reader(&pool, "bob").await;
    app.clone()
        .oneshot(patch(&uuid, &alice, serde_json::json!({ "stars": 3 })))
        .await
        .unwrap();
    app.clone()
        .oneshot(patch(
            &uuid,
            &bob,
            serde_json::json!({ "stars": 5, "body_md": "Loved it", "notes_md": "bob only" }),
        ))
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer(&format!("/api/reviews/{uuid}"), &alice))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let text = body_text(res).await;
    assert!(!text.contains("bob only"), "notes leaked: {text}");
    let reviews: BookReviews = serde_json::from_str(&text).unwrap();
    assert_eq!(reviews.mine.unwrap().stars, Some(3.0));
    assert_eq!(reviews.others.len(), 1);
    assert_eq!(reviews.others[0].user_id, bob_id);
    assert_eq!(reviews.summary.unwrap().average_stars, 4.0);
}

#[tokio::test]
async fn api_get_book_reviews_returns_404_for_an_unknown_book() {
    let (app, _state, pool) = fixture().await;
    let (_, token) = reader(&pool, "alice").await;

    let res = app
        .oneshot(get_with_bearer("/api/reviews/no-such-book", &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_get_book_reviews_returns_500_on_db_failure() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let (_, token) = reader(&pool, "alice").await;
    sqlx::query("DROP TABLE reviews")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer(&format!("/api/reviews/{uuid}"), &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn api_delete_review_removes_it_and_succeeds_when_absent() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let (_, token) = reader(&pool, "alice").await;
    app.clone()
        .oneshot(patch(&uuid, &token, serde_json::json!({ "body_md": "x" })))
        .await
        .unwrap();
    let delete = || {
        request(
            "DELETE",
            &format!("/api/reviews/{uuid}"),
            Some(&token),
            None,
        )
    };

    let first = app.clone().oneshot(delete()).await.unwrap();
    let second = app.clone().oneshot(delete()).await.unwrap();

    assert_eq!(first.status(), StatusCode::NO_CONTENT);
    assert_eq!(second.status(), StatusCode::NO_CONTENT);
    let res = app
        .oneshot(get_with_bearer(&format!("/api/reviews/{uuid}"), &token))
        .await
        .unwrap();
    let reviews: BookReviews = body_json(res).await;
    assert_eq!(reviews.mine, None);
}

#[tokio::test]
async fn api_delete_review_returns_500_on_db_failure() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let (_, token) = reader(&pool, "alice").await;
    sqlx::query("DROP TABLE reviews")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(request(
            "DELETE",
            &format!("/api/reviews/{uuid}"),
            Some(&token),
            None,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
