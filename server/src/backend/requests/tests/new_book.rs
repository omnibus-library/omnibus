//! Starting a request from a provider's record: the book is made with the request, or neither is.

use omnibus_db::test_support::{count_rows, external_meta};
use omnibus_shared::ExternalBookMeta;

use super::*;

const BOOKS: &str = "SELECT COUNT(*) FROM books";

mod post_start_request_from_meta {
    use super::*;

    fn piranesi() -> ExternalBookMeta {
        external_meta("Piranesi")
    }

    async fn start(app: &Router, token: &str, kind: &str, meta: &ExternalBookMeta) -> Response {
        let body = json!({"kind": kind, "meta": meta});
        send(app, "POST", "/api/requests", Some(token), Some(body)).await
    }

    #[tokio::test]
    async fn records_a_looking_ebook_request_on_a_new_book_with_201() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;

        let res = start(&app, &token, "ebook", &piranesi()).await;

        assert_eq!(res.status(), StatusCode::CREATED);
        let body: BookRequest = body_json(res).await;
        assert_eq!(body.user_id, ada);
        assert_eq!(body.kind, RequestKind::Ebook);
        assert_eq!(body.state, RequestState::Looking);
        let book = omnibus_db::get_book_by_uuid(&pool, &body.book_uuid)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(book.title.as_deref(), Some("Piranesi"));
        assert!(book.formats.is_empty());
    }

    #[tokio::test]
    async fn charges_the_start_to_the_reader_s_start_log() {
        let (app, state, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        for _ in 0..9 {
            state.request_starts().record(ada);
        }
        assert!(state.request_starts().has_room(ada));

        start(&app, &token, "ebook", &piranesi()).await;

        assert!(!state.request_starts().has_room(ada));
    }

    #[tokio::test]
    async fn answers_400_for_an_audiobook_and_makes_no_book() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;

        let res = start(&app, &token, "audiobook", &piranesi()).await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        assert_eq!(count_rows(&pool, BOOKS).await, 0);
    }

    #[tokio::test]
    async fn answers_400_when_a_field_of_meta_is_too_long() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        let meta = ExternalBookMeta {
            title: "x".repeat(ExternalBookMeta::TITLE_MAX_LEN + 1),
            ..piranesi()
        };

        let res = start(&app, &token, "ebook", &meta).await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        assert_eq!(count_rows(&pool, BOOKS).await, 0);
    }

    #[tokio::test]
    async fn answers_429_at_the_live_cap_and_makes_no_book() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        for n in 0..5 {
            let uuid = seed_book(&pool, &format!("Book {n}")).await;
            seed_request(&pool, ada, &uuid).await;
        }
        let before = count_rows(&pool, BOOKS).await;

        let res = start(&app, &token, "ebook", &piranesi()).await;

        assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(count_rows(&pool, BOOKS).await, before);
    }

    #[tokio::test]
    async fn answers_429_before_making_a_book_when_the_start_log_is_full() {
        let (app, state, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        for _ in 0..10 {
            state.request_starts().record(ada);
        }

        let res = start(&app, &token, "ebook", &piranesi()).await;

        assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(count_rows(&pool, BOOKS).await, 0);
    }

    #[tokio::test]
    async fn answers_500_when_the_database_fails() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        pool.close().await;

        let res = start(&app, &token, "ebook", &piranesi()).await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
