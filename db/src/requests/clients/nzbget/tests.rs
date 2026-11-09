use serde_json::{json, Value};
use tempfile::TempDir;
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

/// The id of a job, and the name NZBGet lists it under.
const ID: &str = "a9993e364706816aba3e25717850c26c9cd0d89d";
const NAME: &str = "omnibus-a9993e364706816aba3e25717850c26c9cd0d89d";
/// `admin:hunter2` as Basic auth.
const AUTH: &str = "Basic YWRtaW46aHVudGVyMg==";

/// A fake NZBGet that answers 401 to any call without the login.
async fn fake_nzbget() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/jsonrpc"))
        .respond_with(ResponseTemplate::new(401))
        .with_priority(10)
        .mount(&server)
        .await;
    server
}

async fn answer(server: &MockServer, rpc_method: &str, response: Value) {
    Mock::given(method("POST"))
        .and(path("/jsonrpc"))
        .and(header("authorization", AUTH))
        .and(body_partial_json(json!({"method": rpc_method})))
        .respond_with(ResponseTemplate::new(200).set_body_json(response))
        .with_priority(1)
        .mount(server)
        .await;
}

async fn reply(server: &MockServer, rpc_method: &str, result: Value) {
    answer(
        server,
        rpc_method,
        json!({"version": "1.1", "result": result}),
    )
    .await;
}

fn client_for(server: &MockServer) -> Nzbget {
    Nzbget::new(&server.uri(), "admin", "hunter2").unwrap()
}

fn group(status: &str, file_mb: u64, remaining_mb: u64) -> Value {
    json!({
        "NZBID": 7, "NZBName": NAME, "Status": status, "Kind": "NZB",
        "FileSizeMB": file_mb, "RemainingSizeMB": remaining_mb,
        "FinalDir": "", "DestDir": "/d/inter/job",
    })
}

fn history_entry(status: &str, final_dir: &str) -> Value {
    json!({
        "NZBID": 8, "Name": NAME, "Status": status, "Kind": "NZB",
        "FinalDir": final_dir, "DestDir": "/d/inter/job",
    })
}

/// A NZBGet whose queue holds `groups` and whose history holds `history`.
async fn server_with(groups: Vec<Value>, history: Vec<Value>) -> MockServer {
    let server = fake_nzbget().await;
    reply(&server, "listgroups", json!(groups)).await;
    reply(&server, "history", json!(history)).await;
    server
}

/// The JSON bodies of the calls made to `rpc_method`.
async fn calls_to(server: &MockServer, rpc_method: &str) -> Vec<Value> {
    let all = server.received_requests().await.unwrap();
    all.iter()
        .filter_map(|r| serde_json::from_slice::<Value>(&r.body).ok())
        .filter(|body| body["method"] == rpc_method)
        .collect()
}

mod nzbget_test {
    use super::*;

    #[tokio::test]
    async fn calls_version_with_the_login_to_check_the_connection() {
        let server = fake_nzbget().await;
        reply(&server, "version", json!("21.1")).await;

        let result = client_for(&server).test().await;

        assert!(result.is_ok(), "{result:?}");
    }

    #[tokio::test]
    async fn rejects_a_refused_login_as_a_bad_login() {
        let server = fake_nzbget().await;
        let wrong = Nzbget::new(&server.uri(), "admin", "wrong").unwrap();

        let err = wrong.test().await.unwrap_err();

        assert!(matches!(err, ConnectionError::BadLogin), "{err:?}");
    }

    #[tokio::test]
    async fn reports_a_missing_jsonrpc_endpoint_as_a_bad_url() {
        let server = MockServer::start().await;

        let err = client_for(&server).test().await.unwrap_err();

        assert!(matches!(err, ConnectionError::BadUrl(_)), "{err:?}");
    }

    #[tokio::test]
    async fn reports_an_answer_that_is_not_json_as_a_bad_url() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_string("<html/>"))
            .mount(&server)
            .await;

        let err = client_for(&server).test().await.unwrap_err();

        assert!(matches!(err, ConnectionError::BadUrl(_)), "{err:?}");
    }

    #[tokio::test]
    async fn accepts_a_reply_whose_error_member_is_null() {
        let server = fake_nzbget().await;
        answer(&server, "version", json!({"result": "21.1", "error": null})).await;

        let result = client_for(&server).test().await;

        assert!(result.is_ok(), "{result:?}");
    }

    #[tokio::test]
    async fn rejects_an_error_member_with_the_clients_reason() {
        let server = fake_nzbget().await;
        let refusal = json!({"version": "1.1", "error": {"name": "JSONRPCError", "message": "Invalid procedure"}});
        answer(&server, "version", refusal).await;

        let err = client_for(&server).test().await.unwrap_err();

        assert!(
            matches!(&err, ConnectionError::Rejected(m) if m.contains("Invalid procedure")),
            "{err:?}"
        );
    }
}

mod nzbget_add {
    use super::*;

    /// The release `server` hands out as an NZB at its own address; the link carries a key.
    async fn nzb_on(server: &MockServer) -> Prepared<Release> {
        Mock::given(method("GET"))
            .and(path("/13/download"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"<nzb/>"))
            .mount(server)
            .await;
        Prepared {
            hash: ID.to_string(),
            release: Release::NzbLink(format!("{}/13/download?apikey=secret", server.uri())),
        }
    }

    #[tokio::test]
    async fn appends_the_fetched_nzb_as_base64_under_the_job_name_and_category() {
        let server = fake_nzbget().await;
        reply(&server, "append", json!(12)).await;
        let prepared = nzb_on(&server).await;

        client_for(&server).add(prepared, "books").await.unwrap();

        let sent = calls_to(&server, "append").await;
        let expected = json!([
            format!("{NAME}.nzb"),
            "PG56Yi8+",
            "books",
            0,
            false,
            false,
            "",
            0,
            "SCORE",
            []
        ]);
        assert_eq!(sent[0]["params"], expected);
    }

    #[tokio::test]
    async fn rejects_a_failed_fetch_without_echoing_the_link_or_appending() {
        let server = fake_nzbget().await;
        reply(&server, "append", json!(12)).await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        let link = format!("{}/13/download?apikey=secret", server.uri());
        let prepared = Prepared {
            hash: ID.to_string(),
            release: Release::NzbLink(link),
        };

        let err = client_for(&server)
            .add(prepared, "books")
            .await
            .unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
        assert!(!err.to_string().contains("secret"), "{err}");
        assert!(calls_to(&server, "append").await.is_empty());
    }

    #[tokio::test]
    async fn rejects_an_id_of_zero_or_less() {
        for refused in [0, -1] {
            let server = fake_nzbget().await;
            reply(&server, "append", json!(refused)).await;
            let prepared = nzb_on(&server).await;

            let err = client_for(&server)
                .add(prepared, "books")
                .await
                .unwrap_err();

            assert!(
                matches!(err, ConnectionError::Rejected(_)),
                "{refused}: {err:?}"
            );
        }
    }

    #[tokio::test]
    async fn refuses_a_torrent_release_without_asking_the_client_anything() {
        let server = MockServer::start().await;
        for release in [
            Release::Magnet("magnet:?xt=urn:btih:abc".into()),
            Release::File(vec![1]),
        ] {
            let prepared = Prepared {
                hash: ID.to_string(),
                release,
            };

            let err = client_for(&server)
                .add(prepared, "books")
                .await
                .unwrap_err();

            assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
        }
        assert!(server.received_requests().await.unwrap().is_empty());
    }
}

mod nzbget_status {
    use super::*;

    async fn status_of(groups: Vec<Value>, history: Vec<Value>) -> Option<TorrentStatus> {
        let server = server_with(groups, history).await;
        client_for(&server).status(ID).await.unwrap()
    }

    #[tokio::test]
    async fn reports_the_share_downloaded_of_a_job_being_downloaded() {
        let status = status_of(vec![group("DOWNLOADING", 100, 40)], vec![])
            .await
            .unwrap();

        assert_eq!(status.state, "downloading");
        assert_eq!(status.progress, 0.6);
        assert_eq!(status.hash, ID);
    }

    #[tokio::test]
    async fn reports_a_fully_downloaded_job_under_full_progress_until_it_is_unpacked() {
        let status = status_of(vec![group("DOWNLOADING", 100, 0)], vec![])
            .await
            .unwrap();

        assert_eq!(status.progress, 0.99);
    }

    #[tokio::test]
    async fn reports_a_job_with_no_size_yet_at_no_progress() {
        let status = status_of(vec![group("FETCHING", 0, 0)], vec![])
            .await
            .unwrap();

        assert_eq!(status.progress, 0.0);
    }

    #[tokio::test]
    async fn reports_paused_and_queued_jobs_in_qbittorrent_words() {
        let paused = status_of(vec![group("PAUSED", 100, 100)], vec![])
            .await
            .unwrap();
        let queued = status_of(vec![group("QUEUED", 100, 100)], vec![])
            .await
            .unwrap();

        assert_eq!(
            (paused.state.as_str(), queued.state.as_str()),
            ("pausedDL", "queuedDL")
        );
    }

    #[tokio::test]
    async fn reports_a_job_being_unpacked_as_checking() {
        let status = status_of(vec![group("UNPACKING", 100, 0)], vec![])
            .await
            .unwrap();

        assert_eq!(status.state, "checkingDL");
    }

    #[tokio::test]
    async fn reports_a_successful_job_as_finished_in_its_final_folder() {
        let done = history_entry("SUCCESS/UNPACK", "/d/dst/job");

        let status = status_of(vec![], vec![done]).await.unwrap();

        assert_eq!(status.state, "stoppedUP");
        assert_eq!(status.progress, 1.0);
        assert_eq!(status.save_path, "/d/dst/job");
    }

    #[tokio::test]
    async fn falls_back_to_the_destination_folder_when_there_is_no_final_one() {
        let status = status_of(vec![], vec![history_entry("SUCCESS/UNPACK", "")])
            .await
            .unwrap();

        assert_eq!(status.save_path, "/d/inter/job");
    }

    #[tokio::test]
    async fn reports_a_failed_job_as_an_error() {
        let failed = history_entry("FAILURE/HEALTH", "");

        let status = status_of(vec![], vec![failed]).await.unwrap();

        assert_eq!(status.state, "error");
    }

    #[tokio::test]
    async fn reports_a_job_deleted_in_the_client_as_gone() {
        let deleted = history_entry("DELETED/MANUAL", "");

        assert_eq!(status_of(vec![], vec![deleted]).await, None);
    }

    #[tokio::test]
    async fn ignores_a_job_whose_name_only_contains_the_job_name() {
        let mut lookalike = group("DOWNLOADING", 100, 40);
        lookalike["NZBName"] = json!(format!("{NAME}-2"));

        assert_eq!(status_of(vec![lookalike], vec![]).await, None);
    }

    #[tokio::test]
    async fn returns_none_when_neither_queue_nor_history_has_the_job() {
        assert_eq!(status_of(vec![], vec![]).await, None);
    }

    #[tokio::test]
    async fn finds_the_job_whatever_its_kind() {
        let mut url_kind = group("DOWNLOADING", 100, 40);
        url_kind["Kind"] = json!("URL");

        assert!(status_of(vec![url_kind], vec![]).await.is_some());
    }
}

mod nzbget_files {
    use super::*;

    #[tokio::test]
    async fn lists_the_files_in_the_finished_jobs_folder() {
        let job = TempDir::new().unwrap();
        std::fs::write(job.path().join("Dune.epub"), b"12345").unwrap();
        let done = history_entry("SUCCESS/UNPACK", job.path().to_str().unwrap());
        let server = server_with(vec![], vec![done]).await;

        let files = client_for(&server).files(ID).await.unwrap();

        let expected = vec![ClientFile {
            name: "Dune.epub".to_string(),
            size: 5,
        }];
        assert_eq!(files, expected);
    }

    #[tokio::test]
    async fn lists_nothing_when_the_client_no_longer_has_the_job() {
        let server = server_with(vec![], vec![]).await;

        let files = client_for(&server).files(ID).await.unwrap();

        assert_eq!(files, Vec::new());
    }
}

mod nzbget_remove {
    use super::*;

    async fn editqueue_calls(server: &MockServer) -> Vec<Value> {
        calls_to(server, "editqueue").await
    }

    #[tokio::test]
    async fn deletes_a_queued_job_for_good_by_the_id_the_client_gave_it() {
        let server = server_with(vec![group("DOWNLOADING", 100, 40)], vec![]).await;
        reply(&server, "editqueue", json!(true)).await;

        client_for(&server).remove(ID, true).await.unwrap();

        let sent = editqueue_calls(&server).await;
        assert_eq!(sent[0]["params"], json!(["GroupFinalDelete", "", [7]]));
    }

    #[tokio::test]
    async fn deletes_a_finished_job_from_history_for_good() {
        let done = history_entry("SUCCESS/UNPACK", "/d/dst/job");
        let server = server_with(vec![], vec![done]).await;
        reply(&server, "editqueue", json!(true)).await;

        client_for(&server).remove(ID, true).await.unwrap();

        let sent = editqueue_calls(&server).await;
        assert_eq!(sent[0]["params"], json!(["HistoryFinalDelete", "", [8]]));
    }

    #[tokio::test]
    async fn keeps_the_data_when_asked_not_to_delete_files() {
        let server = server_with(vec![group("DOWNLOADING", 100, 40)], vec![]).await;
        reply(&server, "editqueue", json!(true)).await;

        client_for(&server).remove(ID, false).await.unwrap();

        let sent = editqueue_calls(&server).await;
        assert_eq!(sent[0]["params"], json!(["GroupDelete", "", [7]]));
    }

    #[tokio::test]
    async fn rejects_an_edit_the_client_reports_it_did_not_make() {
        let server = server_with(vec![group("DOWNLOADING", 100, 40)], vec![]).await;
        reply(&server, "editqueue", json!(false)).await;

        let err = client_for(&server).remove(ID, true).await.unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
    }

    #[tokio::test]
    async fn succeeds_without_deleting_when_the_client_no_longer_has_the_job() {
        let server = server_with(vec![], vec![]).await;

        let result = client_for(&server).remove(ID, true).await;

        assert!(result.is_ok(), "{result:?}");
        assert!(editqueue_calls(&server).await.is_empty());
    }
}
