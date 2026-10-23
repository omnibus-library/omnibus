//! `wanted`'s policy table, then `sync_now`'s download pass against a stub.

use axum::http::StatusCode;
use serde_json::json;

use crate::device::{Book, Device};
use crate::session::sync_now;
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
