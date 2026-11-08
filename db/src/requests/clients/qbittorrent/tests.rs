use std::time::Duration;

use serde_json::json;
use wiremock::matchers::{body_string_contains, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::requests::clients::release::MAX_TORRENT_BYTES;
use crate::test_support::closed_port_url;

use super::*;

/// The info hash of `MAGNET` and of `TORRENT`.
const HASH: &str = "c17d23830376ac1478f394337fefbc169a9959ce";
const MAGNET: &str = "magnet:?xt=urn:btih:c17d23830376ac1478f394337fefbc169a9959ce&dn=Dune";

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
        "eta": 180,
    }])
}

async fn mount_info(server: &MockServer, hash: &str, body: serde_json::Value) {
    Mock::given(method("GET"))
        .and(path("/api/v2/torrents/info"))
        .and(query_param("hashes", hash))
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

    #[tokio::test]
    async fn accepts_the_empty_204_login_qbittorrent_5_2_answers() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/v2/auth/login"))
            .respond_with(
                ResponseTemplate::new(204)
                    .insert_header("set-cookie", "QBT_SID_8080=abc123; HttpOnly; path=/"),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v2/app/version"))
            .and(header("cookie", "QBT_SID_8080=abc123"))
            .respond_with(ResponseTemplate::new(200).set_body_string("v5.2.3"))
            .mount(&server)
            .await;

        let result = client_for(&server).test().await;

        assert!(result.is_ok(), "{result:?}");
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

    /// Fetch `link`, then hand it to the client: the hash it was prepared under.
    async fn prepare_and_add(
        server: &MockServer,
        link: &str,
        category: &str,
    ) -> Result<String, ConnectionError> {
        let client = client_for(server);
        let prepared = client.prepare(link).await?;
        let hash = prepared.hash.clone();
        client.add(prepared, category).await?;
        Ok(hash)
    }

    /// A client that accepts what it is given.
    async fn accepting_server() -> MockServer {
        let server = signed_in_server().await;
        Mock::given(method("POST"))
            .and(path("/api/v2/torrents/add"))
            .and(header("cookie", "SID=abc123"))
            .respond_with(ResponseTemplate::new(200).set_body_string("Ok."))
            .mount(&server)
            .await;
        server
    }

    #[tokio::test]
    async fn posts_the_link_and_category_with_no_tags_or_share_limits() {
        let server = accepting_server().await;

        let hash = prepare_and_add(&server, MAGNET, "books").await.unwrap();

        let sent = requests_to(&server, "torrents/add").await;
        let expected = vec![
            ("category".to_string(), "books".to_string()),
            ("urls".to_string(), MAGNET.to_string()),
        ];
        assert_eq!(form_pairs(&sent[0]), expected);
        assert_eq!(hash, HASH);
    }

    #[tokio::test]
    async fn sends_no_category_when_it_is_empty() {
        let server = accepting_server().await;

        prepare_and_add(&server, MAGNET, "").await.unwrap();

        let sent = requests_to(&server, "torrents/add").await;
        let expected = vec![("urls".to_string(), MAGNET.to_string())];
        assert_eq!(form_pairs(&sent[0]), expected);
    }

    #[tokio::test]
    async fn prepares_a_magnet_without_asking_the_client_anything() {
        let server = MockServer::start().await;

        let prepared = client_for(&server).prepare(MAGNET).await.unwrap();

        assert_eq!(prepared.hash, HASH);
        assert!(server.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn refuses_an_nzb_release_without_asking_the_client_anything() {
        let server = MockServer::start().await;
        let prepared = Prepared {
            hash: HASH.to_string(),
            release: Release::Nzb(b"<nzb/>".to_vec()),
        };

        let err = client_for(&server)
            .add(prepared, "books")
            .await
            .unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
        assert!(server.received_requests().await.unwrap().is_empty());
    }

    async fn add_answering(response: ResponseTemplate) -> Result<String, ConnectionError> {
        let server = signed_in_server().await;
        Mock::given(method("POST"))
            .and(path("/api/v2/torrents/add"))
            .respond_with(response)
            .mount(&server)
            .await;
        prepare_and_add(&server, MAGNET, "books").await
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

    /// A v1 torrent file whose info hash is `HASH`.
    fn torrent() -> Vec<u8> {
        let mut file =
            b"d8:announce3:url4:infod6:lengthi3e4:name1:a12:piece lengthi16384e6:pieces20:"
                .to_vec();
        file.extend((0..20u8).collect::<Vec<_>>());
        file.extend_from_slice(b"ee");
        file
    }

    async fn mount_release(server: &MockServer, response: ResponseTemplate) -> String {
        Mock::given(method("GET"))
            .and(path("/13/download"))
            .and(query_param("apikey", "secret"))
            .respond_with(response)
            .mount(server)
            .await;
        format!("{}/13/download?apikey=secret&link=abc", server.uri())
    }

    #[tokio::test]
    async fn uploads_the_fetched_torrent_file_named_by_its_hash_with_the_category_and_no_tags() {
        let server = accepting_server().await;
        let link = mount_release(
            &server,
            ResponseTemplate::new(200).set_body_bytes(torrent()),
        )
        .await;

        let hash = prepare_and_add(&server, &link, "books").await.unwrap();

        assert_eq!(hash, HASH);
        let sent = requests_to(&server, "torrents/add").await;
        let content_type = sent[0].headers["content-type"].to_str().unwrap();
        assert!(
            content_type.starts_with("multipart/form-data"),
            "{content_type}"
        );
        let body = String::from_utf8_lossy(&sent[0].body).into_owned();
        for expected in [
            format!("name=\"torrents\"; filename=\"{HASH}.torrent\""),
            "application/x-bittorrent".to_string(),
            "d8:announce3:url4:infod6:lengthi3e".to_string(),
            "name=\"category\"\r\n\r\nbooks".to_string(),
        ] {
            assert!(body.contains(&expected), "missing {expected:?} in {body}");
        }
        assert!(!body.contains("name=\"urls\""), "{body}");
        assert!(!body.contains("name=\"tags\""), "{body}");
    }

    #[tokio::test]
    async fn uploads_a_torrent_file_without_a_category_field_when_it_is_empty() {
        let server = accepting_server().await;
        let link = mount_release(
            &server,
            ResponseTemplate::new(200).set_body_bytes(torrent()),
        )
        .await;

        prepare_and_add(&server, &link, "").await.unwrap();

        let body = String::from_utf8_lossy(&requests_to(&server, "torrents/add").await[0].body)
            .into_owned();
        assert!(!body.contains("name=\"category\""), "{body}");
    }

    #[tokio::test]
    async fn sends_a_magnet_the_link_redirects_to_as_urls() {
        let server = accepting_server().await;
        let redirect = ResponseTemplate::new(302).insert_header("location", MAGNET);
        let link = mount_release(&server, redirect).await;

        prepare_and_add(&server, &link, "books").await.unwrap();

        let sent = requests_to(&server, "torrents/add").await;
        let expected = vec![
            ("category".to_string(), "books".to_string()),
            ("urls".to_string(), MAGNET.to_string()),
        ];
        assert_eq!(form_pairs(&sent[0]), expected);
    }

    #[tokio::test]
    async fn sends_a_magnet_link_as_urls_without_fetching_anything() {
        let server = accepting_server().await;

        prepare_and_add(&server, MAGNET, "books").await.unwrap();

        let all = server.received_requests().await.unwrap();
        assert!(
            all.iter().all(|r| r.url.path().starts_with("/api/v2/")),
            "{all:?}"
        );
        assert_eq!(
            form_pairs(&requests_to(&server, "torrents/add").await[0])[1].1,
            MAGNET
        );
    }

    #[tokio::test]
    async fn rejects_a_release_with_no_v1_info_hash_without_adding_it() {
        let server = accepting_server().await;
        let v2 = b"d4:infod12:meta versioni2e4:name1:aee".to_vec();
        let link = mount_release(&server, ResponseTemplate::new(200).set_body_bytes(v2)).await;

        let err = prepare_and_add(&server, &link, "books").await.unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
        assert!(requests_to(&server, "torrents/add").await.is_empty());
    }

    #[tokio::test]
    async fn rejects_a_link_whose_fetch_fails_without_echoing_it() {
        for status in [404, 500] {
            let server = accepting_server().await;
            let link = mount_release(&server, ResponseTemplate::new(status)).await;

            let err = prepare_and_add(&server, &link, "books").await.unwrap_err();

            assert!(
                matches!(err, ConnectionError::Rejected(_)),
                "{status}: {err:?}"
            );
            assert!(!err.to_string().contains("secret"), "{err}");
            assert!(requests_to(&server, "torrents/add").await.is_empty());
        }
    }

    #[tokio::test]
    async fn rejects_a_torrent_file_larger_than_the_cap() {
        let server = signed_in_server().await;
        let big = vec![b'x'; MAX_TORRENT_BYTES + 1];
        let link = mount_release(&server, ResponseTemplate::new(200).set_body_bytes(big)).await;

        let err = prepare_and_add(&server, &link, "books").await.unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
    }

    #[tokio::test]
    async fn rejects_a_link_that_is_not_a_url() {
        let server = accepting_server().await;

        let err = prepare_and_add(&server, "not-a-link", "books")
            .await
            .unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)));
    }
}

mod qbittorrent_status {
    use super::*;

    #[tokio::test]
    async fn returns_progress_state_and_folders_for_the_torrent_with_the_hash() {
        let server = signed_in_server().await;
        mount_info(&server, HASH, torrent_info(HASH)).await;

        let status = client_for(&server).status(HASH).await.unwrap();

        let expected = TorrentStatus {
            hash: HASH.into(),
            progress: 0.5,
            state: "downloading".into(),
            save_path: "/downloads/omnibus".into(),
            eta: Some(180),
            tags: String::new(),
            added_on: None,
        };
        assert_eq!(status, Some(expected));
    }

    #[tokio::test]
    async fn returns_none_when_the_client_has_no_torrent_with_the_hash() {
        let server = signed_in_server().await;
        mount_info(&server, HASH, json!([])).await;

        let status = client_for(&server).status(HASH).await.unwrap();

        assert_eq!(status, None);
    }
}

mod qbittorrent_hash_guard {
    use super::*;

    #[tokio::test]
    async fn status_is_none_when_the_client_answers_with_a_different_hash() {
        let server = signed_in_server().await;
        mount_info(&server, HASH, torrent_info("some-other-hash")).await;

        let status = client_for(&server).status(HASH).await.unwrap();

        assert_eq!(status, None);
    }
}

mod qbittorrent_hash_for_tag {
    use super::*;

    async fn mount_tag(server: &MockServer, tag: &str, body: serde_json::Value) {
        Mock::given(method("GET"))
            .and(path("/api/v2/torrents/info"))
            .and(query_param("tag", tag))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(server)
            .await;
    }

    fn tagged(hash: &str, tags: &str, added_on: i64) -> serde_json::Value {
        json!({
            "hash": hash, "progress": 1.0, "state": "stalledUP", "save_path": "/d",
            "tags": tags, "added_on": added_on,
        })
    }

    #[tokio::test]
    async fn finds_the_newest_download_carrying_exactly_the_tag() {
        let server = signed_in_server().await;
        let body = json!([
            tagged("old", "omnibus-1-1", 100),
            tagged("new", "x, omnibus-1-1", 200),
            tagged("lookalike", "omnibus-1-10", 300),
        ]);
        mount_tag(&server, "omnibus-1-1", body).await;

        let hash = client_for(&server)
            .hash_for_tag("omnibus-1-1")
            .await
            .unwrap();

        assert_eq!(hash, Some("new".to_string()));
    }

    #[tokio::test]
    async fn finds_nothing_when_no_download_carries_the_tag() {
        let server = signed_in_server().await;
        mount_tag(
            &server,
            "omnibus-1-1",
            json!([tagged("h", "omnibus-1-10", 1)]),
        )
        .await;

        let hash = client_for(&server)
            .hash_for_tag("omnibus-1-1")
            .await
            .unwrap();

        assert_eq!(hash, None);
    }
}

mod qbittorrent_files {
    use super::*;

    #[tokio::test]
    async fn lists_the_files_of_the_torrent_by_its_hash() {
        let server = signed_in_server().await;
        mount_info(&server, HASH, torrent_info(HASH)).await;
        Mock::given(method("GET"))
            .and(path("/api/v2/torrents/files"))
            .and(query_param("hash", HASH))
            .and(header("cookie", "SID=abc123"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"name": "Dune/Dune.epub", "size": 1200, "progress": 1.0},
                {"name": "Dune/cover.jpg", "size": 34},
            ])))
            .mount(&server)
            .await;

        let files = client_for(&server).files(HASH).await.unwrap();

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
        mount_info(&server, HASH, torrent_info(HASH)).await;
        Mock::given(method("GET"))
            .and(path("/api/v2/torrents/files"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        client_for(&server).files(HASH).await.unwrap();

        assert_eq!(requests_to(&server, "auth/login").await.len(), 1);
    }

    #[tokio::test]
    async fn returns_an_empty_list_when_the_torrent_vanished_before_its_files_were_read() {
        let server = signed_in_server().await;
        mount_info(&server, HASH, torrent_info(HASH)).await;
        Mock::given(method("GET"))
            .and(path("/api/v2/torrents/files"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let files = client_for(&server).files(HASH).await.unwrap();

        assert_eq!(files, Vec::new());
    }
}

mod qbittorrent_remove {
    use super::*;

    async fn deleting_server() -> MockServer {
        let server = signed_in_server().await;
        mount_info(&server, HASH, torrent_info(HASH)).await;
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
                .remove(HASH, delete_files)
                .await
                .unwrap();

            let sent = requests_to(&server, "torrents/delete").await;
            let expected = vec![
                ("deleteFiles".to_string(), delete_files.to_string()),
                ("hashes".to_string(), HASH.to_string()),
            ];
            assert_eq!(form_pairs(&sent[0]), expected);
        }
    }

    #[tokio::test]
    async fn succeeds_when_the_torrent_vanished_before_it_was_deleted() {
        let server = signed_in_server().await;
        mount_info(&server, HASH, torrent_info(HASH)).await;
        Mock::given(method("POST"))
            .and(path("/api/v2/torrents/delete"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let result = client_for(&server).remove(HASH, true).await;

        assert!(result.is_ok(), "{result:?}");
    }
}
