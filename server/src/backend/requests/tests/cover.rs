//! The cover a finished download brought: when a request's read offers it, who may fetch it,
//! and what taking or keeping it does to the book.

use axum::body::to_bytes;
use axum::http::header;
use omnibus_db::test_support::solid_color_png;
use omnibus_shared::{CoverOffer, RequestListing};

use crate::backend::test_support::CoversDirGuard;

use super::*;

/// A library book with a cover of `size` pixels: its uuid.
async fn book_with_cover(pool: &SqlitePool, title: &str, size: (u32, u32)) -> String {
    omnibus_db::create_fileless_book(
        pool,
        omnibus_db::FilelessBook {
            title: title.to_string(),
            authors: vec!["Bram Stoker".to_string()],
            isbn: None,
            pubdate: None,
            description: None,
            cover: Some(omnibus_db::FilelessCover {
                mime: "image/png".to_string(),
                bytes: solid_color_png(10, 10, 200, size.0, size.1),
            }),
        },
    )
    .await
    .unwrap()
}

/// A ready request of `user`'s for a book with a `current`-sized cover, whose download brought
/// a `candidate`-sized one: the request's id and the book's uuid.
async fn ready_with_candidate(
    pool: &SqlitePool,
    user: i64,
    current: (u32, u32),
    candidate: (u32, u32),
) -> (i64, String) {
    let wished = book_with_cover(pool, "Dracula", current).await;
    let downloaded = book_with_cover(pool, "Dracula (download)", candidate).await;
    let id = seed_request(pool, user, &wished).await;
    sqlx::query("UPDATE book_requests SET state = 'ready', cover_candidate = ? WHERE id = ?")
        .bind(&downloaded)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    (id, wished)
}

mod get_request {
    use super::*;

    #[tokio::test]
    async fn carries_the_offer_with_both_cover_sizes_when_the_download_cover_is_larger() {
        let _covers = CoversDirGuard::new("request_cover_offer");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        let res = send(
            &app,
            "GET",
            &format!("/api/requests/{id}"),
            Some(&token),
            None,
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: BookRequest = body_json(res).await;
        let expected = CoverOffer {
            width: 40,
            height: 60,
            current_width: 20,
            current_height: 30,
        };
        assert_eq!(body.cover_offer, Some(expected));
    }

    #[tokio::test]
    async fn leaves_the_offer_out_of_both_lists() {
        let _covers = CoversDirGuard::new("request_cover_offer_lists");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, wished) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        for uri in ["/api/requests".to_string(), start_uri(&wished)] {
            let res = send(&app, "GET", &uri, Some(&token), None).await;
            let listed: Vec<RequestListing> = body_json(res).await;
            assert_eq!(listed[0].request.id, id, "{uri}");
            assert_eq!(listed[0].request.cover_offer, None, "{uri}");
        }
    }
}

fn cover_uri(id: i64) -> String {
    format!("/api/requests/{id}/cover")
}

mod get_request_cover {
    use super::*;

    #[tokio::test]
    async fn serves_the_candidate_with_its_validators_to_any_signed_in_reader() {
        let _covers = CoversDirGuard::new("request_cover_serve");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let (_, plain) = reader(&pool, "plain").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        let res = send(&app, "GET", &cover_uri(id), Some(&plain), None).await;

        assert_eq!(res.status(), StatusCode::OK);
        let headers = res.headers().clone();
        assert_eq!(headers[header::CONTENT_TYPE], "image/png");
        assert_eq!(headers[header::VARY], "Cookie, Authorization");
        assert_eq!(headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert!(headers.contains_key(header::ETAG));
        let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        assert_eq!(&bytes[..], solid_color_png(10, 10, 200, 40, 60));
    }

    #[tokio::test]
    async fn answers_304_with_the_same_vary_when_the_validator_matches() {
        let _covers = CoversDirGuard::new("request_cover_304");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;
        let first = send(&app, "GET", &cover_uri(id), Some(&token), None).await;
        let etag = first.headers()[header::ETAG].clone();

        let mut again = request("GET", &cover_uri(id), Some(&token), None);
        again.headers_mut().insert(header::IF_NONE_MATCH, etag);
        let res = app.clone().oneshot(again).await.unwrap();

        assert_eq!(res.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(res.headers()[header::VARY], "Cookie, Authorization");
    }

    #[tokio::test]
    async fn answers_404_when_no_candidate_is_recorded() {
        let _covers = CoversDirGuard::new("request_cover_none");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;
        sqlx::query("UPDATE book_requests SET cover_candidate = NULL WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let res = send(&app, "GET", &cover_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn answers_404_when_the_candidate_file_is_gone() {
        let _covers = CoversDirGuard::new("request_cover_gone");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;
        let candidate = store::get(&pool, id)
            .await
            .unwrap()
            .unwrap()
            .cover_candidate;
        std::fs::remove_file(omnibus_db::covers_dir().join(format!("{}.png", candidate.unwrap())))
            .unwrap();

        let res = send(&app, "GET", &cover_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }
}

/// The bytes `GET /api/covers/{uuid}` serves `token`.
async fn served_cover(app: &Router, token: &str, uuid: &str) -> Vec<u8> {
    let res = send(
        app,
        "GET",
        &format!("/api/covers/{uuid}"),
        Some(token),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec()
}

async fn read_request(app: &Router, token: &str, id: i64) -> BookRequest {
    let res = send(
        app,
        "GET",
        &format!("/api/requests/{id}"),
        Some(token),
        None,
    )
    .await;
    body_json(res).await
}

mod post_take_request_cover {
    use super::*;

    #[tokio::test]
    async fn replaces_the_books_cover_with_the_download_s_and_moves_its_validators() {
        let _covers = CoversDirGuard::new("request_cover_take");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, wished) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;
        sqlx::query("UPDATE books SET last_modified = 1 WHERE uuid = ?")
            .bind(&wished)
            .execute(&pool)
            .await
            .unwrap();

        let res = send(&app, "POST", &cover_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: BookRequest = body_json(res).await;
        assert_eq!(body.cover_offer, None);
        let taken = solid_color_png(10, 10, 200, 40, 60);
        assert_eq!(served_cover(&app, &token, &wished).await, taken);
        let (flagged, modified): (i64, i64) = sqlx::query_as(
            "SELECT mo.has_cover_override, b.last_modified
               FROM books b JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
              WHERE b.uuid = ?",
        )
        .bind(&wished)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(flagged, 1);
        assert!(modified > 1);
        assert_eq!(read_request(&app, &token, id).await.cover_offer, None);
    }

    #[tokio::test]
    async fn lets_an_admin_take_another_readers_offer() {
        let _covers = CoversDirGuard::new("request_cover_take_admin");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let admin = admin_token(&pool).await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        let res = send(&app, "POST", &cover_uri(id), Some(&admin), None).await;

        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn refuses_another_reader_and_leaves_the_offer() {
        let _covers = CoversDirGuard::new("request_cover_take_other");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, ada_token) = requester(&pool, "ada").await;
        let (_, grace) = requester(&pool, "grace").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        let res = send(&app, "POST", &cover_uri(id), Some(&grace), None).await;

        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        assert!(read_request(&app, &ada_token, id)
            .await
            .cover_offer
            .is_some());
    }

    #[tokio::test]
    async fn answers_404_for_a_request_that_does_not_exist() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;

        let res = send(&app, "POST", &cover_uri(999), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn answers_409_when_nothing_is_on_offer() {
        let _covers = CoversDirGuard::new("request_cover_take_409");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (taken, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;
        let (kept, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;
        let (stuck, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;
        let (equal, _) = ready_with_candidate(&pool, ada, (20, 30), (30, 20)).await;
        sqlx::query("UPDATE book_requests SET state = 'stuck' WHERE id = ?")
            .bind(stuck)
            .execute(&pool)
            .await
            .unwrap();
        send(&app, "POST", &cover_uri(taken), Some(&token), None).await;
        send(&app, "DELETE", &cover_uri(kept), Some(&token), None).await;

        for id in [taken, kept, stuck, equal] {
            let res = send(&app, "POST", &cover_uri(id), Some(&token), None).await;
            assert_eq!(res.status(), StatusCode::CONFLICT, "request {id}");
        }
    }

    #[tokio::test]
    async fn keeps_the_offer_and_the_old_cover_when_the_new_one_cannot_be_stored() {
        let _covers = CoversDirGuard::new("request_cover_take_fails");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, wished) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;
        // A directory where the override file goes makes the write fail.
        std::fs::create_dir(omnibus_db::covers_dir().join(format!("override-{wished}.png")))
            .unwrap();

        let res = send(&app, "POST", &cover_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(read_request(&app, &token, id).await.cover_offer.is_some());
        let old = solid_color_png(10, 10, 200, 20, 30);
        assert_eq!(served_cover(&app, &token, &wished).await, old);
    }
}

mod delete_keep_request_cover {
    use super::*;

    #[tokio::test]
    async fn dismisses_the_offer_and_leaves_the_books_cover_alone() {
        let _covers = CoversDirGuard::new("request_cover_keep");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, wished) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        let res = send(&app, "DELETE", &cover_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: BookRequest = body_json(res).await;
        assert_eq!(body.cover_offer, None);
        let old = solid_color_png(10, 10, 200, 20, 30);
        assert_eq!(served_cover(&app, &token, &wished).await, old);
        assert_eq!(read_request(&app, &token, id).await.cover_offer, None);
    }

    #[tokio::test]
    async fn lets_an_admin_keep_and_refuses_another_reader() {
        let _covers = CoversDirGuard::new("request_cover_keep_who");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let (_, grace) = requester(&pool, "grace").await;
        let admin = admin_token(&pool).await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        let other = send(&app, "DELETE", &cover_uri(id), Some(&grace), None).await;
        let by_admin = send(&app, "DELETE", &cover_uri(id), Some(&admin), None).await;

        assert_eq!(other.status(), StatusCode::FORBIDDEN);
        assert_eq!(by_admin.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn answers_409_once_the_offer_is_settled_and_404_for_no_such_request() {
        let _covers = CoversDirGuard::new("request_cover_keep_409");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;
        send(&app, "DELETE", &cover_uri(id), Some(&token), None).await;

        let again = send(&app, "DELETE", &cover_uri(id), Some(&token), None).await;
        let missing = send(&app, "DELETE", &cover_uri(999), Some(&token), None).await;

        assert_eq!(again.status(), StatusCode::CONFLICT);
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }
}
