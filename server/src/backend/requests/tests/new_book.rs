//! Starting a request from a provider's record: the book is made with the request, or neither is.

use omnibus_shared::metadata_lookup::MetadataProvider;
use omnibus_shared::ExternalBookMeta;

use super::*;

mod post_start_request_from_meta {
    use super::*;

    fn piranesi() -> ExternalBookMeta {
        ExternalBookMeta {
            isbn13: "9781635575637".into(),
            title: "Piranesi".into(),
            authors: vec!["Susanna Clarke".into()],
            year: Some("2020".into()),
            pages: None,
            publisher: Some("Bloomsbury".into()),
            description: None,
            cover_url: None,
            series: None,
            first_publish_year: None,
            format: None,
            source: MetadataProvider::OpenLibrary,
        }
    }

    async fn start(app: &Router, token: &str, kind: &str, meta: &ExternalBookMeta) -> Response {
        let body = json!({"kind": kind, "meta": meta});
        send(app, "POST", "/api/requests", Some(token), Some(body)).await
    }

    async fn books(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM books")
            .fetch_one(pool)
            .await
            .unwrap()
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
    async fn answers_400_for_an_audiobook_and_makes_no_book() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;

        let res = start(&app, &token, "audiobook", &piranesi()).await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        assert_eq!(books(&pool).await, 0);
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
        assert_eq!(books(&pool).await, 0);
    }

    #[tokio::test]
    async fn answers_429_at_the_live_cap_and_makes_no_book() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        for n in 0..5 {
            let uuid = seed_book(&pool, &format!("Book {n}")).await;
            seed_request(&pool, ada, &uuid).await;
        }
        let before = books(&pool).await;

        let res = start(&app, &token, "ebook", &piranesi()).await;

        assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(books(&pool).await, before);
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
        assert_eq!(books(&pool).await, 0);
    }
}
