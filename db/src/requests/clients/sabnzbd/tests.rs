use std::collections::HashMap;

use serde_json::{json, Value};
use tempfile::TempDir;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::requests::clients::release::MAX_NZB_BYTES;

use super::*;

/// The id of a job, and the name SABnzbd lists it under.
const ID: &str = "a9993e364706816aba3e25717850c26c9cd0d89d";
const NAME: &str = "omnibus-a9993e364706816aba3e25717850c26c9cd0d89d";
const KEY: &str = "key123";

fn client_for(server: &MockServer) -> Sabnzbd {
    Sabnzbd::new(&server.uri(), KEY).unwrap()
}

fn queue_slot(status: &str, percentage: &str) -> Value {
    json!({"nzo_id": "SABnzbd_nzo_1", "filename": NAME, "status": status, "percentage": percentage})
}

fn history_slot(status: &str, storage: &str) -> Value {
    json!({"nzo_id": "SABnzbd_nzo_2", "name": NAME, "status": status, "storage": storage})
}

/// Answer `GET /api?mode=<mode>` with `body`, once the right API key is sent.
async fn mount_mode(server: &MockServer, mode: &str, body: Value) {
    Mock::given(method("GET"))
        .and(path("/api"))
        .and(query_param("mode", mode))
        .and(query_param("apikey", KEY))
        .and(query_param("output", "json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(server)
        .await;
}

/// A SABnzbd whose queue holds `queue` and whose history holds `history`.
async fn server_with(queue: Vec<Value>, history: Vec<Value>) -> MockServer {
    let server = MockServer::start().await;
    mount_mode(&server, "queue", json!({"queue": {"slots": queue}})).await;
    mount_mode(&server, "history", json!({"history": {"slots": history}})).await;
    server
}

/// The query of every call made to `/api`.
async fn queries(server: &MockServer) -> Vec<HashMap<String, String>> {
    let all = server.received_requests().await.unwrap();
    all.iter()
        .map(|r| r.url.query_pairs().into_owned().collect())
        .collect()
}

mod sabnzbd_test {
    use super::*;

    #[tokio::test]
    async fn asks_for_an_empty_queue_with_the_api_key_to_check_the_connection() {
        let server = MockServer::start().await;
        mount_mode(&server, "queue", json!({"queue": {"slots": []}})).await;

        let result = client_for(&server).test().await;

        assert!(result.is_ok(), "{result:?}");
        assert_eq!(queries(&server).await[0]["limit"], "0");
    }

    #[tokio::test]
    async fn rejects_a_wrong_api_key_as_a_bad_api_key() {
        let server = MockServer::start().await;
        let refusal = json!({"status": false, "error": "API Key Incorrect"});
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_json(refusal))
            .mount(&server)
            .await;

        let err = client_for(&server).test().await.unwrap_err();

        assert!(matches!(err, ConnectionError::BadApiKey), "{err:?}");
    }

    #[tokio::test]
    async fn rejects_another_refusal_with_the_clients_reason() {
        let server = MockServer::start().await;
        let refusal = json!({"status": false, "error": "not allowed from here"});
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_json(refusal))
            .mount(&server)
            .await;

        let err = client_for(&server).test().await.unwrap_err();

        assert!(
            matches!(&err, ConnectionError::Rejected(m) if m.contains("not allowed")),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn reports_a_missing_api_endpoint_as_a_bad_url() {
        let server = MockServer::start().await;

        let err = client_for(&server).test().await.unwrap_err();

        assert!(matches!(err, ConnectionError::BadUrl(_)), "{err:?}");
    }

    #[tokio::test]
    async fn reports_an_answer_that_is_not_json_as_a_bad_url() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string("<html>login</html>"))
            .mount(&server)
            .await;

        let err = client_for(&server).test().await.unwrap_err();

        assert!(matches!(err, ConnectionError::BadUrl(_)), "{err:?}");
    }
}

mod sabnzbd_add {
    use super::*;

    /// The release `server` hands out as an NZB at its own address; the link carries a key.
    async fn nzb_on(server: &MockServer, response: ResponseTemplate) -> Prepared<Release> {
        Mock::given(method("GET"))
            .and(path("/13/download"))
            .and(query_param("apikey", "secret"))
            .respond_with(response)
            .mount(server)
            .await;
        Prepared {
            hash: ID.to_string(),
            release: Release::NzbLink(format!("{}/13/download?apikey=secret", server.uri())),
        }
    }

    async fn nzb_file() -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_bytes(b"<nzb/>")
    }

    async fn accepting_server() -> MockServer {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api"))
            .and(query_param("mode", "addfile"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"status": true, "nzo_ids": ["SABnzbd_nzo_1"]})),
            )
            .mount(&server)
            .await;
        server
    }

    async fn uploads(server: &MockServer) -> Vec<wiremock::Request> {
        let all = server.received_requests().await.unwrap();
        all.into_iter()
            .filter(|r| r.method.as_str() == "POST")
            .collect()
    }

    #[tokio::test]
    async fn uploads_the_fetched_nzb_under_the_job_name_with_the_category() {
        let server = accepting_server().await;
        let prepared = nzb_on(&server, nzb_file().await).await;

        client_for(&server).add(prepared, "books").await.unwrap();

        let sent = uploads(&server).await;
        let query: HashMap<String, String> = sent[0].url.query_pairs().into_owned().collect();
        assert_eq!(query["apikey"], KEY);
        assert_eq!(query["nzbname"], NAME);
        assert_eq!(query["cat"], "books");
        assert!(!sent[0].url.as_str().contains("secret"));
        let body = String::from_utf8_lossy(&sent[0].body);
        assert!(body.contains(&format!("filename=\"{NAME}.nzb\"")), "{body}");
        assert!(body.contains("<nzb/>"), "{body}");
    }

    #[tokio::test]
    async fn sends_no_category_when_it_is_empty() {
        let server = accepting_server().await;
        let prepared = nzb_on(&server, nzb_file().await).await;

        client_for(&server).add(prepared, "").await.unwrap();

        assert!(!uploads(&server).await[0]
            .url
            .query()
            .unwrap()
            .contains("cat="));
    }

    #[tokio::test]
    async fn rejects_a_failed_fetch_without_echoing_the_link_or_uploading() {
        let server = accepting_server().await;
        let prepared = nzb_on(&server, ResponseTemplate::new(500)).await;

        let err = client_for(&server)
            .add(prepared, "books")
            .await
            .unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
        assert!(!err.to_string().contains("secret"), "{err}");
        assert!(uploads(&server).await.is_empty());
    }

    #[tokio::test]
    async fn rejects_an_nzb_larger_than_the_cap_without_uploading() {
        let server = accepting_server().await;
        let big = vec![b'x'; MAX_NZB_BYTES + 1];
        let prepared = nzb_on(&server, ResponseTemplate::new(200).set_body_bytes(big)).await;

        let err = client_for(&server)
            .add(prepared, "books")
            .await
            .unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
        assert!(uploads(&server).await.is_empty());
    }

    #[tokio::test]
    async fn rejects_a_refusal_with_status_false() {
        let server = MockServer::start().await;
        let refusal = json!({"status": false, "error": "no good"});
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(refusal))
            .mount(&server)
            .await;
        let prepared = nzb_on(&server, nzb_file().await).await;

        let err = client_for(&server)
            .add(prepared, "books")
            .await
            .unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
    }

    #[tokio::test]
    async fn rejects_an_answer_that_names_no_job() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({"status": true, "nzo_ids": []})),
            )
            .mount(&server)
            .await;
        let prepared = nzb_on(&server, nzb_file().await).await;

        let err = client_for(&server)
            .add(prepared, "books")
            .await
            .unwrap_err();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
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

mod sabnzbd_status {
    use super::*;

    async fn status_of(queue: Vec<Value>, history: Vec<Value>) -> Option<TorrentStatus> {
        let server = server_with(queue, history).await;
        client_for(&server).status(ID).await.unwrap()
    }

    #[tokio::test]
    async fn reports_a_download_under_full_progress_until_it_is_completed() {
        let status = status_of(vec![queue_slot("Downloading", "100")], vec![])
            .await
            .unwrap();

        assert_eq!(status.state, "downloading");
        assert_eq!(status.progress, 0.99);
        assert_eq!(status.hash, ID);
    }

    #[tokio::test]
    async fn reports_the_share_downloaded_from_the_percentage() {
        let status = status_of(vec![queue_slot("Downloading", "45")], vec![])
            .await
            .unwrap();

        assert_eq!(status.progress, 0.45);
    }

    #[tokio::test]
    async fn reports_a_paused_job_as_paused() {
        let status = status_of(vec![queue_slot("Paused", "10")], vec![])
            .await
            .unwrap();

        assert_eq!(status.state, "pausedDL");
    }

    #[tokio::test]
    async fn reports_a_job_waiting_its_turn_as_queued() {
        for waiting in ["Queued", "Grabbing", "Fetching", "Propagating"] {
            let status = status_of(vec![queue_slot(waiting, "0")], vec![])
                .await
                .unwrap();

            assert_eq!(status.state, "queuedDL", "{waiting}");
        }
    }

    #[tokio::test]
    async fn reports_a_job_still_being_unpacked_as_checking() {
        let status = status_of(vec![], vec![history_slot("Extracting", "/c/job")])
            .await
            .unwrap();

        assert_eq!(status.state, "checkingDL");
        assert_eq!(status.progress, 0.99);
    }

    #[tokio::test]
    async fn reports_a_completed_job_as_finished_in_its_storage_folder() {
        let status = status_of(vec![], vec![history_slot("Completed", "/c/job")])
            .await
            .unwrap();

        assert_eq!(status.state, "stoppedUP");
        assert_eq!(status.progress, 1.0);
        assert_eq!(status.save_path, "/c/job");
    }

    #[tokio::test]
    async fn reports_a_failed_job_as_an_error() {
        let status = status_of(vec![], vec![history_slot("Failed", "/c/job")])
            .await
            .unwrap();

        assert_eq!(status.state, "error");
    }

    #[tokio::test]
    async fn ignores_a_job_whose_name_only_contains_the_job_name() {
        let mut lookalike = queue_slot("Downloading", "50");
        lookalike["filename"] = json!(format!("{NAME}-2"));

        let status = status_of(vec![lookalike], vec![]).await;

        assert_eq!(status, None);
    }

    #[tokio::test]
    async fn returns_none_when_neither_queue_nor_history_has_the_job() {
        assert_eq!(status_of(vec![], vec![]).await, None);
    }

    #[tokio::test]
    async fn searches_both_lists_by_the_job_name() {
        let server = server_with(vec![], vec![]).await;

        client_for(&server).status(ID).await.unwrap();

        let searched: Vec<String> = queries(&server)
            .await
            .iter()
            .map(|q| q["search"].clone())
            .collect();
        assert_eq!(searched, [NAME, NAME]);
    }
}

mod sabnzbd_files {
    use super::*;

    #[tokio::test]
    async fn lists_the_files_in_the_completed_jobs_folder() {
        let job = TempDir::new().unwrap();
        std::fs::write(job.path().join("Dune.epub"), b"12345").unwrap();
        let storage = job.path().to_str().unwrap();
        let server = server_with(vec![], vec![history_slot("Completed", storage)]).await;

        let files = client_for(&server).files(ID).await.unwrap();

        let expected = vec![ClientFile {
            name: "Dune.epub".to_string(),
            size: 5,
        }];
        assert_eq!(files, expected);
    }

    #[tokio::test]
    async fn reads_the_folder_where_this_server_mounts_it() {
        let local = TempDir::new().unwrap();
        std::fs::create_dir(local.path().join("job")).unwrap();
        std::fs::write(local.path().join("job/Dune.epub"), b"1").unwrap();
        let server = server_with(vec![], vec![history_slot("Completed", "/downloads/job")]).await;
        let client = client_for(&server)
            .with_folders(JobFolders::new(Some("/downloads"), local.path().to_str()));

        let files = client.files(ID).await.unwrap();

        assert_eq!(files.len(), 1);
    }

    #[tokio::test]
    async fn lists_nothing_while_the_job_is_still_in_the_queue() {
        let server = server_with(vec![queue_slot("Downloading", "50")], vec![]).await;

        let files = client_for(&server).files(ID).await.unwrap();

        assert_eq!(files, Vec::new());
    }
}

mod sabnzbd_remove {
    use super::*;

    async fn mount_delete(server: &MockServer, mode: &str) {
        Mock::given(method("GET"))
            .and(path("/api"))
            .and(query_param("mode", mode))
            .and(query_param("name", "delete"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"status": true})))
            .with_priority(1)
            .mount(server)
            .await;
    }

    async fn deletes(server: &MockServer) -> Vec<HashMap<String, String>> {
        let mut all = queries(server).await;
        all.retain(|q| q.get("name").is_some_and(|n| n == "delete"));
        all
    }

    #[tokio::test]
    async fn deletes_a_queued_job_by_the_id_the_client_gave_it() {
        let server = server_with(vec![queue_slot("Downloading", "50")], vec![]).await;
        mount_delete(&server, "queue").await;

        client_for(&server).remove(ID, true).await.unwrap();

        let sent = deletes(&server).await;
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0]["mode"], "queue");
        assert_eq!(sent[0]["value"], "SABnzbd_nzo_1");
        assert_eq!(sent[0]["del_files"], "1");
    }

    #[tokio::test]
    async fn deletes_a_finished_job_from_history_with_or_without_its_files() {
        for (delete_files, flag) in [(true, "1"), (false, "0")] {
            let server = server_with(vec![], vec![history_slot("Completed", "/c/job")]).await;
            mount_delete(&server, "history").await;

            client_for(&server).remove(ID, delete_files).await.unwrap();

            let sent = deletes(&server).await;
            assert_eq!(sent[0]["mode"], "history");
            assert_eq!(sent[0]["value"], "SABnzbd_nzo_2");
            assert_eq!(sent[0]["del_files"], flag);
        }
    }

    #[tokio::test]
    async fn succeeds_without_deleting_when_the_client_no_longer_has_the_job() {
        let server = server_with(vec![], vec![]).await;

        let result = client_for(&server).remove(ID, true).await;

        assert!(result.is_ok(), "{result:?}");
        assert!(deletes(&server).await.is_empty());
    }
}

mod sabnzbd_hash_for_tag {
    use super::*;

    #[tokio::test]
    async fn finds_nothing_for_a_client_that_never_tagged_a_download() {
        let server = MockServer::start().await;

        let found = client_for(&server).hash_for_tag("omnibus-7").await.unwrap();

        assert_eq!(found, None);
        assert!(server.received_requests().await.unwrap().is_empty());
    }
}
