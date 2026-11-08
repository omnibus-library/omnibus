//! `GET /api/requests` and `GET /api/books/{uuid}/requests`: every reader's requests, with the
//! book and the names a row shows.

use omnibus_shared::{RequestListing, WishlistSource};

use super::*;

async fn listed(app: &Router, uri: &str, token: &str) -> Vec<RequestListing> {
    let res = send(app, "GET", uri, Some(token), None).await;
    assert_eq!(res.status(), StatusCode::OK, "{uri}");
    body_json(res).await
}

fn ids(listings: &[RequestListing]) -> Vec<i64> {
    listings.iter().map(|l| l.request.id).collect()
}

mod get_requests {
    use super::*;

    #[tokio::test]
    async fn lists_every_readers_requests_with_their_names_to_a_reader_without_the_permission() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let (grace, _) = requester(&pool, "grace").await;
        let (_, plain) = reader(&pool, "plain").await;
        let dracula = seed_book(&pool, "Dracula").await;
        let first = seed_request(&pool, ada, &dracula).await;
        let second = seed_request(&pool, grace, &dracula).await;

        let all = listed(&app, "/api/requests", &plain).await;

        assert_eq!(ids(&all), [second, first]);
        assert_eq!(all[0].requester_name, "grace");
        assert_eq!(all[0].book.title.as_deref(), Some("Dracula"));
    }

    #[tokio::test]
    async fn narrows_to_the_reader_and_state_asked_for() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, ada_token) = requester(&pool, "ada").await;
        let (grace, _) = requester(&pool, "grace").await;
        let dracula = seed_book(&pool, "Dracula").await;
        let carmilla = seed_book(&pool, "Carmilla").await;
        let wanted = seed_request(&pool, ada, &dracula).await;
        seed_request(&pool, ada, &carmilla).await;
        let graces = seed_request(&pool, grace, &dracula).await;
        for (id, by) in [(wanted, ada), (graces, grace)] {
            store::cancel(&pool, id, by, store::unix_now())
                .await
                .unwrap();
        }

        let uri = format!("/api/requests?user={ada}&state=cancelled");
        let found = listed(&app, &uri, &ada_token).await;

        assert_eq!(ids(&found), [wanted]);
        assert_eq!(found[0].cancelled_by_name.as_deref(), Some("ada"));
    }

    #[tokio::test]
    async fn keeps_a_request_once_its_wish_is_removed() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, ada_token) = requester(&pool, "ada").await;
        let dracula = seed_book_by(&pool, "Dracula", "Bram Stoker").await;
        omnibus_db::add_wishlist_entry(&pool, ada, &dracula, WishlistSource::Detail)
            .await
            .unwrap();
        let id = seed_request(&pool, ada, &dracula).await;

        omnibus_db::remove_wishlist_entry(&pool, ada, &dracula)
            .await
            .unwrap();

        let all = listed(&app, "/api/requests", &ada_token).await;
        assert_eq!(ids(&all), [id]);
    }

    #[tokio::test]
    async fn sends_a_stuck_requests_detail_to_an_admin_but_not_to_a_reader() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, ada_token) = requester(&pool, "ada").await;
        let admin = admin_token(&pool).await;
        let dracula = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &dracula).await;
        sqlx::query(
            "UPDATE book_requests SET state = 'stuck', stuck_reason = 'search_failed',
             stuck_detail = 'prowlarr refused the connection' WHERE id = ?",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

        let as_reader = listed(&app, "/api/requests", &ada_token).await;
        let as_admin = listed(&app, "/api/requests", &admin).await;

        assert_eq!(as_reader[0].request.stuck_detail, None);
        assert_eq!(
            as_admin[0].request.stuck_detail.as_deref(),
            Some("prowlarr refused the connection")
        );
    }

    #[tokio::test]
    async fn says_whether_each_requester_has_a_photo() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, ada_token) = requester(&pool, "ada").await;
        let (grace, _) = requester(&pool, "grace").await;
        let dracula = seed_book(&pool, "Dracula").await;
        seed_request(&pool, ada, &dracula).await;
        seed_request(&pool, grace, &dracula).await;
        sqlx::query(
            "INSERT INTO user_avatars (user_id, mime, bytes) VALUES (?, 'image/png', x'00')",
        )
        .bind(grace)
        .execute(&pool)
        .await
        .unwrap();

        let all = listed(&app, "/api/requests", &ada_token).await;

        let photos: Vec<(String, bool)> = all
            .iter()
            .map(|l| (l.requester_name.clone(), l.requester_has_avatar))
            .collect();
        assert_eq!(photos, [("grace".into(), true), ("ada".into(), false)]);
    }

    #[tokio::test]
    async fn answers_400_for_an_unknown_state() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;

        let res = send(&app, "GET", "/api/requests?state=lost", Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn answers_500_when_the_database_fails() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        sqlx::query("DROP TABLE book_request_results")
            .execute(&pool)
            .await
            .unwrap();

        let res = send(&app, "GET", "/api/requests", Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}

mod get_book_requests {
    use super::*;

    #[tokio::test]
    async fn lists_every_readers_requests_for_the_book_newest_first() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, ada_token) = requester(&pool, "ada").await;
        let (grace, _) = requester(&pool, "grace").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let other = seed_book(&pool, "Carmilla").await;
        let first = seed_request(&pool, ada, &uuid).await;
        let second = seed_request(&pool, grace, &uuid).await;
        seed_request(&pool, ada, &other).await;

        let history = listed(&app, &start_uri(&uuid), &ada_token).await;

        assert_eq!(ids(&history), [second, first]);
    }
}
