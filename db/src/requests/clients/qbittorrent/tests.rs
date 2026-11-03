use std::time::Duration;

use serde_json::json;
use wiremock::matchers::{body_string_contains, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::test_support::closed_port_url;

use super::*;

const MAGNET: &str = "magnet:?xt=urn:btih:abc123&dn=Dune";

fn login_ok(cookie_name: &str) -> Mock {
    Mock::given(method("POST"))
        .and(path("/api/v2/auth/login"))
        .and(body_string_contains("username=admin"))
        .and(body_string_contains("password=hunter2"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header(
                    "set-cookie",
                    format!("{cookie_name}=abc123; HttpOnly; path=/"),
                )
                .set_body_string("Ok."),
        )
}

/// A fake qBittorrent that accepts the login and hands out `SID=abc123`.
async fn signed_in_server() -> MockServer {
    let server = MockServer::start().await;
    login_ok("SID").mount(&server).await;
    server
}

fn client_for(server: &MockServer) -> Qbittorrent {
    Qbittorrent::new(&server.uri(), "admin", "hunter2").unwrap()
}

fn torrent_info(hash: &str) -> serde_json::Value {
    json!([{
        "hash": hash,
        "progress": 0.5,
        "state": "downloading",
        "save_path": "/downloads/omnibus",
    }])
}

async fn mount_info(server: &MockServer, tag: &str, body: serde_json::Value) {
    Mock::given(method("GET"))
        .and(path("/api/v2/torrents/info"))
        .and(query_param("tag", tag))
        .and(header("cookie", "SID=abc123"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(server)
        .await;
}

async fn requests_to(server: &MockServer, endpoint: &str) -> Vec<wiremock::Request> {
    let all = server.received_requests().await.unwrap();
    all.into_iter()
        .filter(|r| r.url.path() == format!("/api/v2/{endpoint}"))
        .collect()
}

fn form_pairs(request: &wiremock::Request) -> Vec<(String, String)> {
    let body = String::from_utf8(request.body.clone()).unwrap();
    let url = reqwest::Url::parse(&format!("http://form.invalid/?{body}")).unwrap();
    let mut pairs: Vec<_> = url.query_pairs().into_owned().collect();
    pairs.sort();
    pairs
}

mod qbittorrent_test {
    use super::*;

    #[tokio::test]
    async fn echoes_the_login_cookie_whatever_its_name() {
        for cookie_name in ["SID", "QBT_SID_8080"] {
            let server = MockServer::start().await;
            login_ok(cookie_name).mount(&server).await;
            Mock::given(method("GET"))
                .and(path("/api/v2/app/version"))
                .and(header("cookie", format!("{cookie_name}=abc123").as_str()))
                .respond_with(ResponseTemplate::new(200).set_body_string("v5.0.4"))
                .mount(&server)
                .await;

            let result = client_for(&server).test().await;

            assert!(result.is_ok(), "{cookie_name}: {result:?}");
        }
    }

    mod failures {
        use super::*;

        #[tokio::test]
        async fn rejects_a_refused_login_body_as_a_bad_login() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v2/auth/login"))
                .respond_with(ResponseTemplate::new(200).set_body_string("Fails."))
                .mount(&server)
                .await;

            let err = client_for(&server).test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::BadLogin));
        }

        #[tokio::test]
        async fn rejects_a_forbidden_login_as_a_bad_login() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v2/auth/login"))
                .respond_with(ResponseTemplate::new(403))
                .mount(&server)
                .await;

            let err = client_for(&server).test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::BadLogin));
        }

        #[tokio::test]
        async fn reports_a_missing_version_endpoint_as_a_bad_url() {
            let server = signed_in_server().await;
            Mock::given(method("GET"))
                .and(path("/api/v2/app/version"))
                .respond_with(ResponseTemplate::new(404))
                .mount(&server)
                .await;

            let err = client_for(&server).test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::BadUrl(_)));
        }

        #[tokio::test]
        async fn reports_a_refused_connection_as_unreachable() {
            let client = Qbittorrent::new(&closed_port_url(), "admin", "hunter2").unwrap();

            let err = client.test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::Unreachable(_)));
        }

        #[tokio::test]
        async fn reports_a_server_slower_than_the_timeout_as_unreachable() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v2/auth/login"))
                .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_millis(500)))
                .mount(&server)
                .await;
            let client = client_for(&server).with_timeout(Duration::from_millis(50));

            let err = client.test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::Unreachable(_)));
        }
    }
}

mod qbittorrent_add {
    use super::*;

    #[tokio::test]
    async fn posts_the_link_category_and_tag_and_no_share_limits() {
        let server = signed_in_server().await;
        Mock::given(method("POST"))
            .and(path("/api/v2/torrents/add"))
            .and(header("cookie", "SID=abc123"))
            .respond_with(ResponseTemplate::new(200).set_body_string("Ok."))
            .mount(&server)
            .await;

        client_for(&server)
            .add(MAGNET, "books", "omnibus-7")
            .await
            .unwrap();

        let sent = requests_to(&server, "torrents/add").await;
        let expected = vec![
            ("category".to_string(), "books".to_string()),
            ("tags".to_string(), "omnibus-7".to_string()),
            ("urls".to_string(), MAGNET.to_string()),
        ];
        assert_eq!(form_pairs(&sent[0]), expected);
    }

    async fn add_answering(response: ResponseTemplate) -> Result<(), ConnectionError> {
        let server = signed_in_server().await;
        Mock::given(method("POST"))
            .and(path("/api/v2/torrents/add"))
            .respond_with(response)
            .mount(&server)
            .await;
        client_for(&server).add(MAGNET, "books", "omnibus-7").await
    }

    #[tokio::test]
    async fn accepts_a_202_json_answer_with_no_failures() {
        let body = json!({
            "added_torrent_ids": [],
            "failure_count": 0,
            "pending_count": 1,
            "success_count": 0,
        });

        let result = add_answering(ResponseTemplate::new(202).set_body_json(body)).await;

        assert!(result.is_ok(), "{result:?}");
    }

    #[tokio::test]
    async fn rejects_a_202_json_answer_that_counts_a_failure() {
        let body = json!({
            "added_torrent_ids": [],
            "failure_count": 1,
            "pending_count": 0,
            "success_count": 0,
        });

        let err = add_answering(ResponseTemplate::new(202).set_body_json(body))
            .await
            .unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)));
    }

    #[tokio::test]
    async fn accepts_a_legacy_200_ok_answer() {
        let result = add_answering(ResponseTemplate::new(200).set_body_string("Ok.")).await;

        assert!(result.is_ok(), "{result:?}");
    }

    #[tokio::test]
    async fn rejects_a_link_the_client_refuses() {
        let server = signed_in_server().await;
        Mock::given(method("POST"))
            .and(path("/api/v2/torrents/add"))
            .respond_with(ResponseTemplate::new(200).set_body_string("Fails."))
            .mount(&server)
            .await;

        let err = client_for(&server)
            .add("not-a-link", "books", "omnibus-7")
            .await
            .unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)));
    }
}

mod qbittorrent_status {
    use super::*;

    #[tokio::test]
    async fn returns_progress_state_and_folders_for_the_tagged_torrent() {
        let server = signed_in_server().await;
        mount_info(&server, "omnibus-7", torrent_info("h1")).await;

        let status = client_for(&server).status("omnibus-7").await.unwrap();

        let expected = TorrentStatus {
            hash: "h1".into(),
            progress: 0.5,
            state: "downloading".into(),
            save_path: "/downloads/omnibus".into(),
        };
        assert_eq!(status, Some(expected));
    }

    #[tokio::test]
    async fn returns_none_when_no_torrent_has_the_tag() {
        let server = signed_in_server().await;
        mount_info(&server, "omnibus-7", json!([])).await;

        let status = client_for(&server).status("omnibus-7").await.unwrap();

        assert_eq!(status, None);
    }
}

mod qbittorrent_files {
    use super::*;

    #[tokio::test]
    async fn lists_the_files_of_the_tagged_torrent_by_its_hash() {
        let server = signed_in_server().await;
        mount_info(&server, "omnibus-7", torrent_info("h1")).await;
        Mock::given(method("GET"))
            .and(path("/api/v2/torrents/files"))
            .and(query_param("hash", "h1"))
            .and(header("cookie", "SID=abc123"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"name": "Dune/Dune.epub", "size": 1200, "progress": 1.0},
                {"name": "Dune/cover.jpg", "size": 34},
            ])))
            .mount(&server)
            .await;

        let files = client_for(&server).files("omnibus-7").await.unwrap();

        let expected = vec![
            ClientFile {
                name: "Dune/Dune.epub".into(),
                size: 1200,
            },
            ClientFile {
                name: "Dune/cover.jpg".into(),
                size: 34,
            },
        ];
        assert_eq!(files, expected);
    }

    #[tokio::test]
    async fn logs_in_once_for_the_whole_call() {
        let server = signed_in_server().await;
        mount_info(&server, "omnibus-7", torrent_info("h1")).await;
        Mock::given(method("GET"))
            .and(path("/api/v2/torrents/files"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        client_for(&server).files("omnibus-7").await.unwrap();

        assert_eq!(requests_to(&server, "auth/login").await.len(), 1);
    }

    #[tokio::test]
    async fn returns_an_empty_list_when_the_torrent_vanished_before_its_files_were_read() {
        let server = signed_in_server().await;
        mount_info(&server, "omnibus-7", torrent_info("h1")).await;
        Mock::given(method("GET"))
            .and(path("/api/v2/torrents/files"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let files = client_for(&server).files("omnibus-7").await.unwrap();

        assert_eq!(files, Vec::new());
    }
}

mod qbittorrent_remove {
    use super::*;

    async fn deleting_server() -> MockServer {
        let server = signed_in_server().await;
        mount_info(&server, "omnibus-7", torrent_info("h1")).await;
        Mock::given(method("POST"))
            .and(path("/api/v2/torrents/delete"))
            .and(header("cookie", "SID=abc123"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;
        server
    }

    #[tokio::test]
    async fn deletes_the_torrent_with_or_without_its_files_as_asked() {
        for delete_files in [true, false] {
            let server = deleting_server().await;

            client_for(&server)
                .remove("omnibus-7", delete_files)
                .await
                .unwrap();

            let sent = requests_to(&server, "torrents/delete").await;
            let expected = vec![
                ("deleteFiles".to_string(), delete_files.to_string()),
                ("hashes".to_string(), "h1".to_string()),
            ];
            assert_eq!(form_pairs(&sent[0]), expected);
        }
    }

    #[tokio::test]
    async fn succeeds_when_the_torrent_vanished_before_it_was_deleted() {
        let server = signed_in_server().await;
        mount_info(&server, "omnibus-7", torrent_info("h1")).await;
        Mock::given(method("POST"))
            .and(path("/api/v2/torrents/delete"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let result = client_for(&server).remove("omnibus-7", true).await;

        assert!(result.is_ok(), "{result:?}");
    }

    #[tokio::test]
    async fn does_nothing_when_no_torrent_has_the_tag() {
        let server = signed_in_server().await;
        mount_info(&server, "omnibus-7", json!([])).await;

        client_for(&server).remove("omnibus-7", true).await.unwrap();

        assert!(requests_to(&server, "torrents/delete").await.is_empty());
    }
}
