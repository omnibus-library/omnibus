//! The cover a finished download brought: when a request's read offers it, who may fetch it,
//! and what taking or keeping it does to the book.

use axum::body::to_bytes;
use axum::http::header;
use omnibus_db::test_support::{book_with_png_cover, solid_color_png};
use omnibus_shared::{CoverOffer, RequestListing};

use crate::backend::test_support::CoversDirGuard;

use super::*;

/// A ready request of `user`'s for a book with a `current`-sized cover, whose download brought
/// a `candidate`-sized one kept as the request's file: the request's id and the book's uuid.
async fn ready_with_candidate(
    pool: &SqlitePool,
    user: i64,
    current: (u32, u32),
    candidate: (u32, u32),
) -> (i64, String) {
    let wished = book_with_png_cover(pool, "Dracula", "Bram Stoker", Some(current)).await;
    let id = seed_request(pool, user, &wished).await;
    let name = format!("request-{id}");
    let png = solid_color_png(10, 10, 200, candidate.0, candidate.1);
    std::fs::write(omnibus_db::covers_dir().join(format!("{name}.png")), png).unwrap();
    sqlx::query("UPDATE book_requests SET state = 'ready', cover_candidate = ? WHERE id = ?")
        .bind(name)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    (id, wished)
}

/// Whether request `id`'s candidate file is still on disk.
fn candidate_file_exists(id: i64) -> bool {
    omnibus_db::covers_dir()
        .join(format!("request-{id}.png"))
        .exists()
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
    async fn leaves_the_offer_out_for_a_reader_who_cannot_pick_versions_even_the_requester() {
        let _covers = CoversDirGuard::new("request_cover_offer_hidden");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, ada_token) = asker(&pool, "ada").await;
        let (_, grace) = asker(&pool, "grace").await;
        let (_, plain) = reader(&pool, "plain").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        for token in [&ada_token, &grace, &plain] {
            assert_eq!(read_request(&app, token, id).await.cover_offer, None);
        }
    }

    #[tokio::test]
    async fn carries_the_offer_for_a_chooser_and_an_admin_on_another_readers_request() {
        let _covers = CoversDirGuard::new("request_cover_offer_chooser");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = asker(&pool, "ada").await;
        let (_, picker) = chooser(&pool, "picker").await;
        let admin = admin_token(&pool).await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        for token in [&picker, &admin] {
            assert!(read_request(&app, token, id).await.cover_offer.is_some());
        }
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
    async fn serves_the_candidate_with_its_validators_to_the_requester() {
        let _covers = CoversDirGuard::new("request_cover_serve");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        let res = send(&app, "GET", &cover_uri(id), Some(&token), None).await;

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
    async fn answers_404_to_a_reader_who_cannot_pick_versions_even_the_requester() {
        let _covers = CoversDirGuard::new("request_cover_serve_who");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, ada_token) = asker(&pool, "ada").await;
        let (_, grace) = asker(&pool, "grace").await;
        let (_, plain) = reader(&pool, "plain").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        for token in [&ada_token, &grace, &plain] {
            let res = send(&app, "GET", &cover_uri(id), Some(token), None).await;
            assert_eq!(res.status(), StatusCode::NOT_FOUND);
        }
    }

    #[tokio::test]
    async fn serves_a_chooser_and_an_admin_another_readers_candidate() {
        let _covers = CoversDirGuard::new("request_cover_serve_chooser");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = asker(&pool, "ada").await;
        let (_, picker) = chooser(&pool, "picker").await;
        let admin = admin_token(&pool).await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        for token in [&picker, &admin] {
            let res = send(&app, "GET", &cover_uri(id), Some(token), None).await;
            assert_eq!(res.status(), StatusCode::OK);
        }
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
    async fn answers_404_when_the_download_cover_is_not_larger() {
        let _covers = CoversDirGuard::new("request_cover_not_larger");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (30, 20)).await;

        let res = send(&app, "GET", &cover_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn answers_500_when_the_database_fails() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        pool.close().await;

        let res = send(&app, "GET", &cover_uri(1), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
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
        assert!(!candidate_file_exists(id));
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
    async fn lets_a_chooser_take_another_readers_offer() {
        let _covers = CoversDirGuard::new("request_cover_take_chooser");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = asker(&pool, "ada").await;
        let (_, picker) = chooser(&pool, "picker").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        let res = send(&app, "POST", &cover_uri(id), Some(&picker), None).await;

        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn refuses_a_reader_who_cannot_pick_even_the_requester_and_leaves_the_offer() {
        let _covers = CoversDirGuard::new("request_cover_take_other");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, ada_token) = asker(&pool, "ada").await;
        let admin = admin_token(&pool).await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        let res = send(&app, "POST", &cover_uri(id), Some(&ada_token), None).await;

        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        assert!(read_request(&app, &admin, id).await.cover_offer.is_some());
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
        assert!(candidate_file_exists(id));
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
        assert!(!candidate_file_exists(id));
        let old = solid_color_png(10, 10, 200, 20, 30);
        assert_eq!(served_cover(&app, &token, &wished).await, old);
        assert_eq!(read_request(&app, &token, id).await.cover_offer, None);
    }

    #[tokio::test]
    async fn answers_500_when_the_database_fails() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        pool.close().await;

        let res = send(&app, "DELETE", &cover_uri(1), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn lets_a_chooser_keep_another_readers_offer() {
        let _covers = CoversDirGuard::new("request_cover_keep_chooser");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = asker(&pool, "ada").await;
        let (_, picker) = chooser(&pool, "picker").await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        let res = send(&app, "DELETE", &cover_uri(id), Some(&picker), None).await;

        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn refuses_a_reader_who_cannot_pick_even_the_requester_and_lets_an_admin_keep() {
        let _covers = CoversDirGuard::new("request_cover_keep_who");
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, ada_token) = asker(&pool, "ada").await;
        let admin = admin_token(&pool).await;
        let (id, _) = ready_with_candidate(&pool, ada, (20, 30), (40, 60)).await;

        let own = send(&app, "DELETE", &cover_uri(id), Some(&ada_token), None).await;
        let by_admin = send(&app, "DELETE", &cover_uri(id), Some(&admin), None).await;

        assert_eq!(own.status(), StatusCode::FORBIDDEN);
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
