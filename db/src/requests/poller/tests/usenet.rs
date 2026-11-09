//! What the poller does differently for a usenet client: it never grabs the NZB while the
//! client is down, and clears a failed job before adding the release again.

use omnibus_shared::ReleaseProtocol;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::requests::clients::Sabnzbd;

use super::*;

mod failed_job {
    use super::*;

    #[tokio::test]
    async fn is_removed_and_the_release_added_again_for_a_usenet_client() {
        let pool = pool().await;
        let id = seed(&pool, "ada", "chosen").await;
        let client = StubClient::new()
            .with_protocol(ReleaseProtocol::Usenet)
            .with_status(&hash(id), 0.99, "error");

        tick(&pool, &client, NOW).await;

        let calls = client.calls();
        let remove = Call::Remove {
            hash: hash(id),
            delete_files: true,
        };
        assert!(calls.contains(&remove), "{calls:?}");
        assert!(
            calls.iter().any(|c| matches!(c, Call::Add { .. })),
            "{calls:?}"
        );
        let after = row(&pool, id).await;
        assert_eq!(after.state, RequestState::OnItsWay);
        assert!(!after.client_adopted);
    }

    #[tokio::test]
    async fn is_left_alone_for_a_torrent_client() {
        let pool = pool().await;
        let id = seed(&pool, "ada", "chosen").await;
        let client = StubClient::new().with_status(&hash(id), 0.5, "error");

        tick(&pool, &client, NOW).await;

        let removed = client
            .calls()
            .iter()
            .any(|c| matches!(c, Call::Remove { .. } | Call::Add { .. }));
        assert!(!removed);
        assert!(row(&pool, id).await.client_adopted);
    }
}

mod client_down {
    use super::*;

    #[tokio::test]
    async fn makes_no_request_for_the_nzb_while_the_usenet_client_cannot_answer() {
        let pool = pool().await;
        let id = seed(&pool, "ada", "chosen").await;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/13/download"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"<nzb/>"))
            .expect(0)
            .mount(&server)
            .await;
        let link = format!("{}/13/download?apikey=secret", server.uri());
        sqlx::query("UPDATE book_request_results SET download_url = ? WHERE request_id = ?")
            .bind(&link)
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        let client = Sabnzbd::new(&server.uri(), "key").unwrap();

        for pass in 0..3 {
            let _ = poll_once(&pool, &client, CATEGORY, NOW + pass, &mut None).await;
        }

        let grabs = server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .filter(|r| r.url.path() == "/13/download")
            .count();
        assert_eq!(grabs, 0);
        assert_eq!(row(&pool, id).await.state, RequestState::Chosen);
    }
}
