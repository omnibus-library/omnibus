//! `wanted`'s policy table, then `sync_now`'s download pass against a stub.

use axum::http::StatusCode;
use serde_json::json;

use crate::device::{Book, Device};
use crate::firmware::Quirk;
use crate::session::{attempt_download, sync_now, SyncFailure};
use crate::test_support::{new_entitlement, spawn_stub, Stub, STUB_TOKEN};
use crate::wire::Series;

use super::*;

fn book(downloaded: bool, archived: bool, download_problem: Option<&str>) -> Book {
    Book {
        title: "Dune".into(),
        description: String::new(),
        authors: vec!["Frank Herbert".into()],
        series: None::<Series>,
        downloaded,
        archived,
        cover_image_id: String::new(),
        cover: None,
        download_problem: download_problem.map(str::to_owned),
        reading: crate::reading::Reading::default(),
        annotations: Vec::new(),
        dropped_annotations: 0,
    }
}

fn device_with(books: Vec<(&str, Book)>) -> Device {
    let mut device = Device::new("HW-1");
    for (id, book) in books {
        device.library.insert(id.to_owned(), book);
    }
    device
}

#[test]
fn wanted_is_empty_under_the_none_policy() {
    let device = device_with(vec![("book-1", book(false, false, None))]);

    assert_eq!(wanted(&device, &DownloadPolicy::None), Vec::<String>::new());
}

#[test]
fn wanted_takes_every_undownloaded_book_that_is_not_archived_under_the_all_policy() {
    let device = device_with(vec![
        ("book-1", book(false, false, None)),
        ("book-2", book(true, false, None)),
        ("book-3", book(false, true, None)),
    ]);

    assert_eq!(wanted(&device, &DownloadPolicy::All), ["book-1"]);
}

#[test]
fn wanted_takes_only_listed_books_the_device_holds() {
    let device = device_with(vec![
        ("book-1", book(false, false, None)),
        ("book-2", book(false, false, None)),
        ("book-3", book(true, false, None)),
        ("book-4", book(false, true, None)),
    ]);
    let policy = DownloadPolicy::Listed(vec![
        "book-1".into(),
        "book-3".into(),
        "book-4".into(),
        "unknown".into(),
    ]);

    assert_eq!(wanted(&device, &policy), ["book-1"]);
}

#[test]
fn wanted_retries_a_failed_download_whatever_the_policy() {
    let device = device_with(vec![("book-1", book(false, false, Some("prior failure")))]);

    assert_eq!(wanted(&device, &DownloadPolicy::None), ["book-1"]);
}

#[tokio::test]
async fn sync_now_downloads_listed_books_and_marks_them_downloaded() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");
    let policy = DownloadPolicy::Listed(vec!["book-1".into()]);

    sync_now(&mut device, &stub.endpoint, &policy)
        .await
        .unwrap();

    let book = &device.library["book-1"];
    assert_eq!((book.downloaded, &book.download_problem), (true, &None));
}

#[tokio::test]
async fn sync_now_records_a_download_problem_when_the_download_answers_404() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        download_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");
    let policy = DownloadPolicy::Listed(vec!["book-1".into()]);

    sync_now(&mut device, &stub.endpoint, &policy)
        .await
        .unwrap();

    let book = &device.library["book-1"];
    assert!(!book.downloaded);
    let problem = book.download_problem.as_deref().unwrap();
    assert!(problem.contains("/kobo/<token>/v1/download/book-1"));
    assert!(problem.contains("404"));
    assert!(!problem.contains(STUB_TOKEN));
}

#[tokio::test]
async fn sync_now_retries_a_failed_download_on_the_next_sync() {
    // A second, empty page: the server never resends a `NewEntitlement` for a
    // book the device already holds, so the second sync must not reset it.
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")]), json!([])],
        download_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");
    let policy = DownloadPolicy::Listed(vec!["book-1".into()]);
    sync_now(&mut device, &stub.endpoint, &policy)
        .await
        .unwrap();
    assert!(device.library["book-1"].download_problem.is_some());

    sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

    let download_requests = stub
        .paths()
        .into_iter()
        .filter(|p| p.contains("/v1/download/"))
        .count();
    assert_eq!(
        download_requests, 2,
        "the second sync must retry it unasked"
    );
}

#[tokio::test]
async fn attempt_download_makes_no_request_for_a_downloaded_book() {
    let stub = spawn_stub(Stub::default()).await;
    let mut device = Device::new("HW-1");
    device
        .library
        .insert("book-1".into(), book(true, false, None));

    let attempt = attempt_download(&mut device, &stub.endpoint, &["book-1".into()]).await;

    assert!(attempt.outcome.is_ok());
    assert!(stub
        .paths()
        .into_iter()
        .all(|p| !p.contains("/v1/download/")));
}

#[tokio::test]
async fn attempt_download_fails_with_download_failure_when_the_download_answers_404() {
    let stub = spawn_stub(Stub {
        download_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");
    device
        .library
        .insert("book-1".into(), book(false, false, None));
    device.download_urls.insert(
        "book-1".into(),
        format!("{}/kobo/{STUB_TOKEN}/v1/download/book-1", stub.origin),
    );

    let attempt = attempt_download(&mut device, &stub.endpoint, &["book-1".into()]).await;

    assert!(matches!(
        attempt.outcome,
        Err(SyncFailure::Quirk {
            quirk: Quirk::DownloadFailure,
            ..
        })
    ));
    assert!(device.library["book-1"].download_problem.is_some());
}

#[tokio::test]
async fn attempt_download_stores_the_body_in_the_devices_storage() {
    let stub = spawn_stub(Stub {
        download_body: b"hello-kepub",
        ..Stub::default()
    })
    .await;
    let dir = tempfile::TempDir::new().unwrap();
    let storage = dir.path().join("kobo.books");
    let mut device = Device::new("HW-1");
    device.storage = Some(storage.clone());
    device
        .library
        .insert("book-1".into(), book(false, false, None));
    device.download_urls.insert(
        "book-1".into(),
        format!("{}/kobo/{STUB_TOKEN}/v1/download/book-1", stub.origin),
    );

    let attempt = attempt_download(&mut device, &stub.endpoint, &["book-1".into()]).await;

    assert!(attempt.outcome.is_ok());
    let bytes = std::fs::read(storage.join("book-1.kepub.epub")).unwrap();
    assert_eq!(bytes, b"hello-kepub");
    let names: Vec<_> = std::fs::read_dir(&storage)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(names, ["book-1.kepub.epub"]);
}

#[tokio::test]
async fn attempt_download_refuses_to_store_a_book_whose_id_is_not_a_plain_id() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = tempfile::TempDir::new().unwrap();
    let storage = dir.path().join("kobo.books");
    let mut device = Device::new("HW-1");
    device.storage = Some(storage.clone());
    device
        .library
        .insert("../escape".into(), book(false, false, None));
    device.download_urls.insert(
        "../escape".into(),
        format!("{}/kobo/{STUB_TOKEN}/v1/download/escape", stub.origin),
    );

    let attempt = attempt_download(&mut device, &stub.endpoint, &["../escape".into()]).await;

    assert!(attempt.outcome.is_err());
    assert!(!device.library["../escape"].downloaded);
    let problem = device.library["../escape"]
        .download_problem
        .as_deref()
        .unwrap();
    assert!(problem.contains("../escape"), "{problem}");
    assert!(stub
        .paths()
        .into_iter()
        .all(|p| !p.contains("/v1/download/")));
    assert!(!dir.path().join("escape.kepub.epub").exists());
    assert!(!storage.exists());
}

#[tokio::test]
async fn attempt_download_leaves_the_book_undownloaded_when_its_file_cannot_be_written() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = tempfile::TempDir::new().unwrap();
    let storage = dir.path().join("kobo.books");
    std::fs::write(&storage, "not a directory").unwrap();
    let mut device = Device::new("HW-1");
    device.storage = Some(storage.clone());
    device
        .library
        .insert("book-1".into(), book(false, false, None));
    device.download_urls.insert(
        "book-1".into(),
        format!("{}/kobo/{STUB_TOKEN}/v1/download/book-1", stub.origin),
    );

    let attempt = attempt_download(&mut device, &stub.endpoint, &["book-1".into()]).await;

    assert!(attempt.outcome.is_err());
    assert!(!device.library["book-1"].downloaded);
    assert!(device.library["book-1"].download_problem.is_some());
}

#[tokio::test]
async fn attempt_download_fails_with_transport_when_the_server_is_unreachable() {
    let mut device = Device::new("HW-1");
    device
        .library
        .insert("book-1".into(), book(false, false, None));
    // Port 1 is privileged, so nothing answers there.
    device.download_urls.insert(
        "book-1".into(),
        "http://127.0.0.1:1/v1/download/book-1".into(),
    );

    let attempt = attempt_download(&mut device, "http://127.0.0.1:1", &["book-1".into()]).await;

    assert!(matches!(attempt.outcome, Err(SyncFailure::Transport(_))));
}

#[tokio::test]
async fn attempt_download_fails_with_transport_when_the_body_is_truncated() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let mut buf = [0u8; 1024];
        let _ = socket.read(&mut buf).await;
        // Promise 100 bytes, send 5, then close — a connection dropped
        // mid-body, not a non-2xx answer.
        let _ = socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nshort")
            .await;
    });

    let dir = tempfile::TempDir::new().unwrap();
    let storage = dir.path().join("kobo.books");
    let mut device = Device::new("HW-1");
    device.storage = Some(storage.clone());
    device
        .library
        .insert("book-1".into(), book(false, false, None));
    device
        .download_urls
        .insert("book-1".into(), format!("http://{addr}/v1/download/book-1"));

    let attempt =
        attempt_download(&mut device, &format!("http://{addr}"), &["book-1".into()]).await;

    assert!(
        matches!(attempt.outcome, Err(SyncFailure::Transport(_))),
        "{:?}",
        attempt.outcome
    );
    assert!(!device.library["book-1"].downloaded);
}
