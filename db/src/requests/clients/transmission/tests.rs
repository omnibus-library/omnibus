use serde_json::{json, Value};
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::test_support::closed_port_url;

use super::*;

/// The info hash of `MAGNET`.
const HASH: &str = "c17d23830376ac1478f394337fefbc169a9959ce";
const MAGNET: &str = "magnet:?xt=urn:btih:c17d23830376ac1478f394337fefbc169a9959ce&dn=Dune";
const SESSION: &str = "sess-1";

/// A fake Transmission that answers 409 with a session id until a request carries it.
async fn fake_transmission() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/transmission/rpc"))
        .respond_with(
            ResponseTemplate::new(409).insert_header("x-transmission-session-id", SESSION),
        )
        .with_priority(10)
        .mount(&server)
        .await;
    server
}

/// Answer `rpc_method` with a success carrying `arguments`, once a session id is sent.
async fn reply(server: &MockServer, rpc_method: &str, arguments: Value) {
    answer(
        server,
        rpc_method,
        ResponseTemplate::new(200)
            .set_body_json(json!({"result": "success", "arguments": arguments})),
    )
    .await;
}

async fn answer(server: &MockServer, rpc_method: &str, response: ResponseTemplate) {
    Mock::given(method("POST"))
        .and(path("/transmission/rpc"))
        .and(header("x-transmission-session-id", SESSION))
        .and(body_partial_json(json!({"method": rpc_method})))
        .respond_with(response)
        .with_priority(1)
        .mount(server)
        .await;
}

fn client_for(server: &MockServer) -> Transmission {
    Transmission::new(&server.uri(), "admin", "hunter2").unwrap()
}

/// The JSON bodies of the calls to `rpc_method` that carried the session id.
async fn calls_to(server: &MockServer, rpc_method: &str) -> Vec<Value> {
    let all = server.received_requests().await.unwrap();
    all.iter()
        .filter(|r| r.headers.contains_key("x-transmission-session-id"))
        .filter_map(|r| serde_json::from_slice::<Value>(&r.body).ok())
        .filter(|body| body["method"] == rpc_method)
        .collect()
}

mod transmission_test {
    use super::*;

    #[tokio::test]
    async fn calls_session_get_to_check_the_connection() {
        let server = fake_transmission().await;
        reply(&server, "session-get", json!({"version": "4.0.6"})).await;

        let result = client_for(&server).test().await;

        assert!(result.is_ok(), "{result:?}");
        assert_eq!(calls_to(&server, "session-get").await.len(), 1);
    }

    #[tokio::test]
    async fn resends_the_call_once_with_the_session_id_a_409_hands_out() {
        let server = fake_transmission().await;
        reply(&server, "session-get", json!({})).await;

        client_for(&server).test().await.unwrap();

        let sent = server.received_requests().await.unwrap();
        let carried: Vec<bool> = sent
            .iter()
            .map(|r| r.headers.contains_key("x-transmission-session-id"))
            .collect();
        assert_eq!(carried, [false, true]);
    }

    #[tokio::test]
    async fn sends_basic_auth_only_when_a_username_is_set() {
        let server = fake_transmission().await;
        reply(&server, "session-get", json!({})).await;

        client_for(&server).test().await.unwrap();
        Transmission::new(&server.uri(), "", "")
            .unwrap()
            .test()
            .await
            .unwrap();

        let sent = server.received_requests().await.unwrap();
        let auth: Vec<Option<&str>> = sent
            .iter()
            .filter(|r| r.headers.contains_key("x-transmission-session-id"))
            .map(|r| r.headers.get("authorization").and_then(|v| v.to_str().ok()))
            .collect();
        assert_eq!(auth, [Some("Basic YWRtaW46aHVudGVyMg=="), None]);
    }

    mod failures {
        use super::*;

        #[tokio::test]
        async fn rejects_an_unauthorized_answer_as_a_bad_login() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(401))
                .mount(&server)
                .await;

            let err = client_for(&server).test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::BadLogin), "{err:?}");
        }

        #[tokio::test]
        async fn reports_a_missing_rpc_endpoint_as_a_bad_url() {
            let server = MockServer::start().await;

            let err = client_for(&server).test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::BadUrl(_)), "{err:?}");
        }

        #[tokio::test]
        async fn reports_a_refused_connection_as_unreachable() {
            let client = Transmission::new(&closed_port_url(), "admin", "hunter2").unwrap();

            let err = client.test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::Unreachable(_)), "{err:?}");
        }

        #[tokio::test]
        async fn reports_an_answer_that_is_not_json_as_a_bad_url() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_string("<html>login</html>"))
                .mount(&server)
                .await;

            let err = client_for(&server).test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::BadUrl(_)), "{err:?}");
        }

        #[tokio::test]
        async fn rejects_a_result_other_than_success_without_echoing_the_address() {
            let server = fake_transmission().await;
            let refusal = json!({"result": "method name not recognized", "arguments": {}});
            answer(
                &server,
                "session-get",
                ResponseTemplate::new(200).set_body_json(refusal),
            )
            .await;

            let err = client_for(&server).test().await.unwrap_err();

            assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
            assert!(!err.to_string().contains(&server.uri()), "{err}");
        }
    }
}

mod transmission_add {
    use super::*;

    async fn prepare_and_add(
        server: &MockServer,
        link: &str,
        category: &str,
    ) -> Result<(), ConnectionError> {
        let client = client_for(server);
        let prepared = client.prepare(link).await?;
        client.add(prepared, category).await
    }

    async fn accepting_server() -> MockServer {
        let server = fake_transmission().await;
        reply(
            &server,
            "torrent-add",
            json!({"torrent-added": {"hashString": HASH}}),
        )
        .await;
        server
    }

    #[tokio::test]
    async fn prepares_a_magnet_by_its_info_hash_without_asking_the_client_anything() {
        let server = MockServer::start().await;

        let prepared = client_for(&server).prepare(MAGNET).await.unwrap();

        assert_eq!(prepared.hash, HASH);
        assert!(server.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn sends_a_magnet_as_filename_with_the_category_as_a_label() {
        let server = accepting_server().await;

        prepare_and_add(&server, MAGNET, "books").await.unwrap();

        let sent = calls_to(&server, "torrent-add").await;
        let expected = json!({"filename": MAGNET, "labels": ["books"]});
        assert_eq!(sent[0]["arguments"], expected);
    }

    #[tokio::test]
    async fn sends_no_labels_when_the_category_is_empty() {
        let server = accepting_server().await;

        prepare_and_add(&server, MAGNET, "").await.unwrap();

        let sent = calls_to(&server, "torrent-add").await;
        assert_eq!(sent[0]["arguments"], json!({"filename": MAGNET}));
    }

    #[tokio::test]
    async fn sends_a_torrent_file_as_base64_metainfo() {
        let server = accepting_server().await;
        let prepared = Prepared {
            hash: HASH.to_string(),
            release: Release::File(b"torrentbytes".to_vec()),
        };

        client_for(&server).add(prepared, "books").await.unwrap();

        let sent = calls_to(&server, "torrent-add").await;
        let expected = json!({"metainfo": "dG9ycmVudGJ5dGVz", "labels": ["books"]});
        assert_eq!(sent[0]["arguments"], expected);
    }

    #[tokio::test]
    async fn counts_a_duplicate_torrent_as_added() {
        let server = fake_transmission().await;
        reply(
            &server,
            "torrent-add",
            json!({"torrent-duplicate": {"hashString": HASH}}),
        )
        .await;

        let result = prepare_and_add(&server, MAGNET, "books").await;

        assert!(result.is_ok(), "{result:?}");
    }

    #[tokio::test]
    async fn rejects_a_result_other_than_success() {
        let server = fake_transmission().await;
        let corrupt = json!({"result": "invalid or corrupt torrent file", "arguments": {}});
        answer(
            &server,
            "torrent-add",
            ResponseTemplate::new(200).set_body_json(corrupt),
        )
        .await;

        let err = prepare_and_add(&server, MAGNET, "books").await.unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
    }

    #[tokio::test]
    async fn refuses_an_nzb_release_without_asking_the_client_anything() {
        let server = MockServer::start().await;
        let prepared = Prepared {
            hash: HASH.to_string(),
            release: Release::NzbLink("http://nzb.invalid/1".to_string()),
        };

        let err = client_for(&server)
            .add(prepared, "books")
            .await
            .unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
        assert!(server.received_requests().await.unwrap().is_empty());
    }
}

mod transmission_status {
    use super::*;

    fn torrent(status: u8, error: i64, percent_done: f64) -> Value {
        json!({
            "hashString": HASH,
            "status": status,
            "error": error,
            "percentDone": percent_done,
            "downloadDir": "/downloads/omnibus",
            "eta": 180,
            "addedDate": 1700000000,
        })
    }

    async fn state_of(torrent: Value) -> String {
        let server = fake_transmission().await;
        reply(&server, "torrent-get", json!({"torrents": [torrent]})).await;
        client_for(&server)
            .status(HASH)
            .await
            .unwrap()
            .unwrap()
            .state
    }

    #[tokio::test]
    async fn returns_progress_folder_and_eta_for_the_torrent_with_the_hash() {
        let server = fake_transmission().await;
        reply(
            &server,
            "torrent-get",
            json!({"torrents": [torrent(4, 0, 0.5)]}),
        )
        .await;

        let status = client_for(&server).status(HASH).await.unwrap().unwrap();

        let expected = TorrentStatus {
            hash: HASH.to_string(),
            progress: 0.5,
            state: "downloading".to_string(),
            save_path: "/downloads/omnibus".to_string(),
            eta: Some(180),
            tags: String::new(),
            added_on: Some(1700000000),
        };
        assert_eq!(status, expected);
        let sent = calls_to(&server, "torrent-get").await;
        assert_eq!(sent[0]["arguments"]["ids"], json!([HASH]));
    }

    #[tokio::test]
    async fn reports_no_eta_when_transmission_cannot_tell() {
        let mut unknown = torrent(4, 0, 0.5);
        unknown["eta"] = json!(-1);
        let server = fake_transmission().await;
        reply(&server, "torrent-get", json!({"torrents": [unknown]})).await;

        let status = client_for(&server).status(HASH).await.unwrap().unwrap();

        assert_eq!(status.eta, None);
    }

    #[tokio::test]
    async fn reports_a_local_error_as_the_error_state() {
        assert_eq!(state_of(torrent(4, 3, 0.5)).await, "error");
    }

    #[tokio::test]
    async fn does_not_report_a_tracker_error_as_the_error_state() {
        assert_eq!(state_of(torrent(4, 2, 0.5)).await, "downloading");
    }

    #[tokio::test]
    async fn reports_a_finished_check_as_checking_up_and_an_unfinished_one_as_checking_dl() {
        assert_eq!(state_of(torrent(2, 0, 1.0)).await, "checkingUP");
        assert_eq!(state_of(torrent(2, 0, 0.4)).await, "checkingDL");
    }

    #[tokio::test]
    async fn reports_a_stopped_torrent_by_whether_it_finished() {
        assert_eq!(state_of(torrent(0, 0, 1.0)).await, "stoppedUP");
        assert_eq!(state_of(torrent(0, 0, 0.4)).await, "stoppedDL");
    }

    #[tokio::test]
    async fn reports_queued_and_seeding_torrents_in_qbittorrent_words() {
        assert_eq!(state_of(torrent(3, 0, 0.1)).await, "queuedDL");
        assert_eq!(state_of(torrent(5, 0, 1.0)).await, "queuedUP");
        assert_eq!(state_of(torrent(6, 0, 1.0)).await, "uploading");
    }

    #[tokio::test]
    async fn rejects_an_error_result_that_comes_with_empty_arguments() {
        let server = fake_transmission().await;
        let refusal = json!({"result": "no such torrent", "arguments": {}});
        answer(
            &server,
            "torrent-get",
            ResponseTemplate::new(200).set_body_json(refusal),
        )
        .await;

        let err = client_for(&server).status(HASH).await.unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
    }

    #[tokio::test]
    async fn returns_none_when_transmission_has_no_torrent_with_the_hash() {
        let server = fake_transmission().await;
        reply(&server, "torrent-get", json!({"torrents": []})).await;

        let status = client_for(&server).status(HASH).await.unwrap();

        assert_eq!(status, None);
    }
}

mod transmission_files {
    use super::*;

    #[tokio::test]
    async fn lists_the_files_of_the_torrent_by_its_hash() {
        let server = fake_transmission().await;
        let files = json!([
            {"name": "Dune/Dune.epub", "length": 1024, "bytesCompleted": 1024},
            {"name": "Dune/cover.jpg", "length": 20},
        ]);
        reply(
            &server,
            "torrent-get",
            json!({"torrents": [{"hashString": HASH, "files": files}]}),
        )
        .await;

        let listed = client_for(&server).files(HASH).await.unwrap();

        let expected = vec![
            ClientFile {
                name: "Dune/Dune.epub".to_string(),
                size: 1024,
            },
            ClientFile {
                name: "Dune/cover.jpg".to_string(),
                size: 20,
            },
        ];
        assert_eq!(listed, expected);
    }

    #[tokio::test]
    async fn returns_an_empty_list_when_the_torrent_is_gone() {
        let server = fake_transmission().await;
        reply(&server, "torrent-get", json!({"torrents": []})).await;

        let listed = client_for(&server).files(HASH).await.unwrap();

        assert_eq!(listed, Vec::new());
    }
}

mod transmission_remove {
    use super::*;

    #[tokio::test]
    async fn removes_the_torrent_with_or_without_its_data_as_asked() {
        for delete_files in [true, false] {
            let server = fake_transmission().await;
            reply(&server, "torrent-remove", json!({})).await;

            client_for(&server)
                .remove(HASH, delete_files)
                .await
                .unwrap();

            let sent = calls_to(&server, "torrent-remove").await;
            let expected = json!({"ids": [HASH], "delete-local-data": delete_files});
            assert_eq!(sent[0]["arguments"], expected);
        }
    }
}
