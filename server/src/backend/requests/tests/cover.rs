//! The cover a finished download brought: when a request's read offers it, who may fetch it,
//! and what taking or keeping it does to the book.

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

        let res = send(&app, "GET", &format!("/api/requests/{id}"), Some(&token), None).await;

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
