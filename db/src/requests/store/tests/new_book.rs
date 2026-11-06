//! Starting a request on a book the library does not have yet: the book and the request land together or not at all.

use omnibus_shared::metadata_lookup::MetadataProvider;
use omnibus_shared::ExternalBookMeta;

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

async fn book_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM books")
        .fetch_one(pool)
        .await
        .unwrap()
}

mod start_for_new_book {
    use super::*;

    #[tokio::test]
    async fn records_a_looking_request_on_a_new_fileless_book() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;

        let row = start_for_new_book(&pool, ada, &piranesi(), RequestKind::Ebook, MAX_LIVE)
            .await
            .unwrap();

        assert_eq!(row.user_id, ada);
        assert_eq!(row.state, RequestState::Looking);
        let book = crate::books::get_book_by_uuid(&pool, &row.book_uuid)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(book.title.as_deref(), Some("Piranesi"));
        assert!(book.formats.is_empty());
        assert_eq!(get(&pool, row.id).await.unwrap(), Some(row));
    }

    #[tokio::test]
    async fn makes_no_book_when_the_reader_is_at_the_live_cap() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;
        start(&pool, ada, "book-1", RequestKind::Ebook, 1)
            .await
            .unwrap();

        let refused = start_for_new_book(&pool, ada, &piranesi(), RequestKind::Ebook, 1).await;

        assert!(matches!(refused, Err(RequestError::TooManyLive)));
        assert_eq!(book_count(&pool).await, 0);
        assert_eq!(request_count(&pool).await, 1);
    }
}
