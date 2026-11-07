use serde_json::json;
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::test_support::closed_port_url;

use super::*;

fn client_for(server: &MockServer) -> Prowlarr {
    Prowlarr::new(&server.uri(), "indexer-key").unwrap()
}

async fn mount_get(server: &MockServer, endpoint: &str, response: ResponseTemplate) {
    Mock::given(method("GET"))
        .and(path(endpoint))
        .and(header("x-api-key", "indexer-key"))
        .respond_with(response)
        .mount(server)
        .await;
}

mod prowlarr_test {
    use super::*;

    #[tokio::test]
    async fn succeeds_when_status_answers_json_for_the_api_key() {
        let server = MockServer::start().await;
        let status = json!({"appName": "Prowlarr", "version": "1.30.2"});
        mount_get(
            &server,
            "/api/v1/system/status",
            ResponseTemplate::new(200).set_body_json(status),
        )
        .await;

        let result = client_for(&server).test().await;

        assert!(result.is_ok(), "{result:?}");
    }

    mod failures {
        use super::*;

        #[tokio::test]
        async fn rejects_a_401_as_a_bad_api_key() {
            let server = MockServer::start().await;
            mount_get(&server, "/api/v1/system/status", ResponseTemplate::new(401)).await;

            let err = client_for(&server).test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::BadApiKey));
        }

        #[tokio::test]
        async fn reports_a_404_as_a_bad_url() {
            let server = MockServer::start().await;

            let err = client_for(&server).test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::BadUrl(_)));
        }

        #[tokio::test]
        async fn reports_another_arr_app_as_a_bad_url() {
            let server = MockServer::start().await;
            let status = json!({"appName": "Readarr", "version": "0.4.1"});
            mount_get(
                &server,
                "/api/v1/system/status",
                ResponseTemplate::new(200).set_body_json(status),
            )
            .await;

            let err = client_for(&server).test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::BadUrl(_)));
        }

        #[tokio::test]
        async fn does_not_follow_a_redirect_to_another_host() {
            let elsewhere = MockServer::start().await;
            let to_elsewhere = ResponseTemplate::new(302).insert_header(
                "location",
                format!("{}/api/v1/system/status", elsewhere.uri()),
            );
            let server = MockServer::start().await;
            mount_get(&server, "/api/v1/system/status", to_elsewhere).await;

            let result = client_for(&server).test().await;

            assert!(result.is_err());
            assert!(elsewhere.received_requests().await.unwrap().is_empty());
        }

        #[tokio::test]
        async fn reports_a_page_that_is_not_json_as_a_bad_url() {
            let server = MockServer::start().await;
            let page = ResponseTemplate::new(200).set_body_string("<html>sign in</html>");
            mount_get(&server, "/api/v1/system/status", page).await;

            let err = client_for(&server).test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::BadUrl(_)));
        }

        #[tokio::test]
        async fn reports_a_refused_connection_as_unreachable() {
            let client = Prowlarr::new(&closed_port_url(), "indexer-key").unwrap();

            let err = client.test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::Unreachable(_)));
        }
    }
}

mod prowlarr_indexer_status {
    use super::*;

    #[tokio::test]
    async fn parses_which_indexers_are_failing_and_until_when() {
        let server = MockServer::start().await;
        let body = json!([
            {"id": 1, "indexerId": 4, "disabledTill": "2026-11-03T10:00:00Z", "mostRecentFailure": "x"},
            {"id": 2, "indexerId": 9},
        ]);
        mount_get(
            &server,
            "/api/v1/indexerstatus",
            ResponseTemplate::new(200).set_body_json(body),
        )
        .await;

        let statuses = client_for(&server).indexer_status().await.unwrap();

        let expected = vec![
            IndexerStatus {
                indexer_id: 4,
                disabled_till: Some("2026-11-03T10:00:00Z".into()),
            },
            IndexerStatus {
                indexer_id: 9,
                disabled_till: None,
            },
        ];
        assert_eq!(statuses, expected);
    }
}

mod prowlarr_search {
    use super::*;

    /// Test time is production time divided by this, so a wait of 40 s is 400 ms here.
    const SCALE: u32 = 100;

    async fn mount_search(server: &MockServer, response: ResponseTemplate) {
        Mock::given(method("GET"))
            .and(path("/api/v1/search"))
            .and(header("x-api-key", "indexer-key"))
            .and(query_param("query", "Dracula Bram Stoker"))
            .and(query_param("categories", "7020"))
            .and(query_param("type", "search"))
            .respond_with(response)
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn asks_for_the_book_categories_and_reads_each_release() {
        let server = MockServer::start().await;
        let body = json!([
            {"guid": "g1", "title": "Dracula epub", "size": 900000, "seeders": 12, "indexer": "Books",
             "downloadUrl": "http://prowlarr/1/download?apikey=secret", "categories": [{"id": 7000}, {"id": 7020}], "files": 1},
            {"guid": "g2", "title": "Dracula pdf", "magnetUrl": "magnet:?xt=urn:btih:abc"},
        ]);
        mount_search(&server, ResponseTemplate::new(200).set_body_json(body)).await;

        let found = client_for(&server)
            .search("Dracula Bram Stoker")
            .await
            .unwrap();

        assert_eq!(found.len(), 2);
        assert_eq!(found[0].title, "Dracula epub");
        assert_eq!(found[0].size_bytes, Some(900_000));
        assert_eq!(found[0].seeders, Some(12));
        assert_eq!(found[0].indexer.as_deref(), Some("Books"));
        assert_eq!(found[0].link, "http://prowlarr/1/download?apikey=secret");
        assert_eq!(found[0].categories, [7000, 7020]);
        assert_eq!(found[0].files, Some(1));
        assert_eq!(found[1].link, "magnet:?xt=urn:btih:abc");
    }

    #[tokio::test]
    async fn search_reads_results_that_arrive_later_than_the_old_thirty_second_timeout() {
        let server = MockServer::start().await;
        let body = json!([
            {"guid": "g1", "title": "Dracula epub", "downloadUrl": "http://prowlarr/1/download"},
        ]);
        let slow = ResponseTemplate::new(200)
            .set_body_json(body)
            .set_delay(Duration::from_secs(40) / SCALE);
        mount_search(&server, slow).await;

        let found = client_for(&server)
            .search_within("Dracula Bram Stoker", SEARCH_TIMEOUT / SCALE)
            .await
            .unwrap();

        let titles: Vec<&str> = found.iter().map(|r| r.title.as_str()).collect();
        assert_eq!(titles, ["Dracula epub"]);
    }

    #[tokio::test]
    async fn leaves_out_a_release_with_no_title_or_no_link() {
        let server = MockServer::start().await;
        let body = json!([
            {"guid": "g1", "downloadUrl": "http://prowlarr/1/download"},
            {"guid": "g2", "title": "No link"},
            {"guid": "g3", "title": "Kept", "downloadUrl": "http://prowlarr/3/download"},
        ]);
        mount_search(&server, ResponseTemplate::new(200).set_body_json(body)).await;

        let found = client_for(&server)
            .search("Dracula Bram Stoker")
            .await
            .unwrap();

        let titles: Vec<&str> = found.iter().map(|r| r.title.as_str()).collect();
        assert_eq!(titles, ["Kept"]);
    }

    #[tokio::test]
    async fn reads_each_releases_protocol_and_none_for_one_it_does_not_know() {
        let server = MockServer::start().await;
        let body = json!([
            {"guid": "g1", "title": "t1", "protocol": "torrent", "downloadUrl": "http://prowlarr/1/download"},
            {"guid": "g2", "title": "t2", "protocol": "usenet", "downloadUrl": "http://prowlarr/2/download"},
            {"guid": "g3", "title": "t3", "protocol": "unknown", "downloadUrl": "http://prowlarr/3/download"},
            {"guid": "g4", "title": "t4", "protocol": 1, "downloadUrl": "http://prowlarr/4/download"},
        ]);
        mount_search(&server, ResponseTemplate::new(200).set_body_json(body)).await;

        let found = client_for(&server)
            .search("Dracula Bram Stoker")
            .await
            .unwrap();

        let protocols: Vec<_> = found.iter().map(|r| r.protocol).collect();
        assert_eq!(
            protocols,
            [
                Some(ReleaseProtocol::Torrent),
                Some(ReleaseProtocol::Usenet),
                None,
                None
            ]
        );
    }

    #[tokio::test]
    async fn reads_each_releases_page_and_none_for_one_that_is_not_a_web_address() {
        let server = MockServer::start().await;
        let body = json!([
            {"guid": "g1", "title": "t1", "downloadUrl": "http://prowlarr/1/download", "infoUrl": "https://tracker.example/t/1"},
            {"guid": "g2", "title": "t2", "downloadUrl": "http://prowlarr/2/download", "infoUrl": "http://tracker.example/t/2"},
            {"guid": "g3", "title": "t3", "downloadUrl": "http://prowlarr/3/download"},
            {"guid": "g4", "title": "t4", "downloadUrl": "http://prowlarr/4/download", "infoUrl": "javascript:alert(1)"},
            {"guid": "g5", "title": "t5", "downloadUrl": "http://prowlarr/5/download", "infoUrl": "https://user:pw@tracker.example/t/5"},
        ]);
        mount_search(&server, ResponseTemplate::new(200).set_body_json(body)).await;

        let found = client_for(&server)
            .search("Dracula Bram Stoker")
            .await
            .unwrap();

        let pages: Vec<Option<&str>> = found.iter().map(|r| r.info_url.as_deref()).collect();
        assert_eq!(
            pages,
            [
                Some("https://tracker.example/t/1"),
                Some("http://tracker.example/t/2"),
                None,
                None,
                None
            ]
        );
    }

    #[tokio::test]
    async fn drops_a_page_on_prowlarrs_own_host_or_carrying_a_key() {
        let server = MockServer::start().await;
        let own = format!("{}/details/1", server.uri());
        let body = json!([
            {"guid": "g1", "title": "t1", "downloadUrl": "http://prowlarr/1/download", "infoUrl": own},
            {"guid": "g2", "title": "t2", "downloadUrl": "http://prowlarr/2/download", "infoUrl": "https://tracker.example/t?id=2&apikey=k"},
            {"guid": "g3", "title": "t3", "downloadUrl": "http://prowlarr/3/download", "infoUrl": "https://tracker.example/t?PassKey=k"},
            {"guid": "g4", "title": "t4", "downloadUrl": "http://prowlarr/4/download", "infoUrl": "https://tracker.example/t?api_key=k"},
            {"guid": "g5", "title": "t5", "downloadUrl": "http://prowlarr/5/download", "infoUrl": "https://tracker.example/t?id=5"},
            {"guid": "g6", "title": "t6", "downloadUrl": "http://prowlarr/6/download", "infoUrl": "https://tracker.example/t?id=6;apikey=k"},
            {"guid": "g7", "title": "t7", "downloadUrl": "http://prowlarr/7/download", "infoUrl": "https://tracker.example/t?id=7#apikey=k"},
            {"guid": "g8", "title": "t8", "downloadUrl": "http://prowlarr/8/download", "infoUrl": "https://tracker.example/t?id=8&authkey=k"},
        ]);
        mount_search(&server, ResponseTemplate::new(200).set_body_json(body)).await;

        let found = client_for(&server)
            .search("Dracula Bram Stoker")
            .await
            .unwrap();

        let pages: Vec<Option<&str>> = found.iter().map(|r| r.info_url.as_deref()).collect();
        assert_eq!(
            pages,
            [
                None,
                None,
                None,
                None,
                Some("https://tracker.example/t?id=5"),
                None,
                None,
                None
            ]
        );
    }

    #[tokio::test]
    async fn reads_an_empty_indexer_as_none() {
        let server = MockServer::start().await;
        let body = json!([
            {"guid": "g1", "title": "Dracula epub", "indexer": "", "downloadUrl": "http://prowlarr/1/download"},
        ]);
        mount_search(&server, ResponseTemplate::new(200).set_body_json(body)).await;

        let found = client_for(&server)
            .search("Dracula Bram Stoker")
            .await
            .unwrap();

        assert_eq!(found[0].indexer, None);
    }

    #[tokio::test]
    async fn answers_rate_limited_on_a_429_and_makes_no_call_while_cooling_down() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/search"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&server)
            .await;
        // Its own key: a cooldown is kept per address and key, and a later test can be
        // handed this server's port.
        let client = Prowlarr::new(&server.uri(), "key-prowlarr-429-cooldown").unwrap();

        let first = client.search("Dracula Bram Stoker").await.unwrap_err();
        let second = client.search("Dracula Bram Stoker").await.unwrap_err();

        assert!(matches!(first, ConnectionError::RateLimited));
        assert!(matches!(second, ConnectionError::RateLimited));
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn answers_rate_limited_without_panicking_on_an_enormous_retry_after() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/search"))
            .respond_with(
                ResponseTemplate::new(429).insert_header("retry-after", "18446744073709551615"),
            )
            .mount(&server)
            .await;
        let client = Prowlarr::new(&server.uri(), "key-prowlarr-huge-retry-after").unwrap();

        let first = client.search("Dracula Bram Stoker").await.unwrap_err();
        let second = client.search("Dracula Bram Stoker").await.unwrap_err();

        assert!(matches!(first, ConnectionError::RateLimited));
        assert!(matches!(second, ConnectionError::RateLimited));
    }

    #[tokio::test]
    async fn reports_a_401_as_a_bad_api_key() {
        let server = MockServer::start().await;
        mount_search(&server, ResponseTemplate::new(401)).await;

        let err = client_for(&server)
            .search("Dracula Bram Stoker")
            .await
            .unwrap_err();

        assert!(matches!(err, ConnectionError::BadApiKey));
    }
}

mod prowlarr_from_config {
    use super::*;
    use crate::settings::RequestsConfig;

    fn config(url: Option<&str>, key: Option<&str>) -> RequestsConfig {
        RequestsConfig {
            prowlarr_url: url.map(str::to_string),
            prowlarr_api_key: key.map(str::to_string),
            download_client_kind: Default::default(),
            download_client_url: None,
            download_client_username: None,
            download_client_password: None,
            download_client_category: "omnibus".into(),
            download_client_path_prefix: None,
            download_path_prefix: None,
        }
    }

    #[test]
    fn requires_both_an_address_and_an_api_key() {
        for config in [config(None, Some("k")), config(Some("http://p:9696"), None)] {
            let err = Prowlarr::from_config(&config).err().unwrap();
            assert!(matches!(err, ConnectionError::NotConfigured));
        }
    }

    #[test]
    fn builds_a_client_when_both_are_set() {
        assert!(Prowlarr::from_config(&config(Some("http://p:9696"), Some("k"))).is_ok());
    }
}
