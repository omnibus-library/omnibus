//! `Control::read_to` and `highlight_words` against the stub, built on the
//! shared "book-1 downloaded" helper the reader's `load_book` tests use.

use tempfile::TempDir;

use crate::annotations::{span_range, Swatch};
use crate::device::DeviceError;
use crate::kepub::KepubError;
use crate::test_support::{
    control_with_downloaded_book, device_holding, dune_stub, spawn_stub, stub_control,
    stub_control_with, Stub, READER_EPUB, READER_KEPUB,
};

use super::super::*;

#[tokio::test]
async fn read_to_sends_the_span_holding_the_passage_and_its_percent() {
    let dir = TempDir::new().unwrap();
    let (control, stub) =
        control_with_downloaded_book(READER_KEPUB, dir.path().join("kobo.json")).await;

    let result = control
        .read_to("book-1".into(), "Paul and Jessica walked".into())
        .await
        .unwrap();

    assert!(matches!(result, Acted::Done(_)), "{result:?}");
    let requests = stub.requests.lock().unwrap();
    let put = requests
        .iter()
        .rev()
        .find(|r| r.path.ends_with("/state"))
        .expect("no state PUT was recorded");
    let body: serde_json::Value = serde_json::from_str(&put.body).unwrap();
    let bookmark = &body["ReadingStates"][0]["CurrentBookmark"];
    assert_eq!(
        bookmark["Location"],
        serde_json::json!({ "Source": "ch1.xhtml", "Type": "KoboSpan", "Value": "kobo.3.1" })
    );
    assert_eq!(bookmark["ProgressPercent"], 10);
}

#[tokio::test]
async fn read_to_returns_passage_not_found_without_a_request() {
    let dir = TempDir::new().unwrap();
    let (control, stub) =
        control_with_downloaded_book(READER_KEPUB, dir.path().join("kobo.json")).await;
    let before = stub.paths().len();

    let error = control
        .read_to("book-1".into(), "words that are not in the book".into())
        .await
        .unwrap_err();

    assert!(matches!(error, ControlError::PassageNotFound(_)));
    assert_eq!(stub.paths().len(), before, "no request was made");
}

#[tokio::test]
async fn read_to_returns_not_downloaded_without_a_request() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control
        .sync(crate::downloads::DownloadPolicy::None)
        .await
        .unwrap();
    let before = stub.paths().len();

    let error = control
        .read_to("book-1".into(), "whatever".into())
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        ControlError::Device(DeviceError::NotDownloaded(_))
    ));
    assert_eq!(stub.paths().len(), before, "no request was made");
}

#[tokio::test]
async fn read_to_returns_unknown_book_without_a_request() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));

    let error = control
        .read_to("book-1".into(), "whatever".into())
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        ControlError::Device(DeviceError::UnknownBook(_))
    ));
    assert!(stub.paths().is_empty());
}

#[tokio::test]
async fn read_to_returns_no_kobo_spans_for_a_plain_epub() {
    let dir = TempDir::new().unwrap();
    let (control, _stub) =
        control_with_downloaded_book(READER_EPUB, dir.path().join("kobo.json")).await;

    let error = control
        .read_to("book-1".into(), "Paul and Jessica walked".into())
        .await
        .unwrap_err();

    assert!(matches!(error, ControlError::Kepub(KepubError::NoSpans)));
}

#[tokio::test]
async fn read_to_returns_unreadable_when_the_downloaded_file_is_missing() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let mut device = device_holding("book-1", "Reader Fixture");
    device.library.get_mut("book-1").unwrap().downloaded = true;
    let control = stub_control_with(&stub, device, dir.path().join("kobo.json"));

    let error = control
        .read_to("book-1".into(), "whatever".into())
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        ControlError::Kepub(KepubError::Unreadable(_))
    ));
}

#[tokio::test]
async fn highlight_words_sends_the_passage_with_its_utf16_span_range() {
    let dir = TempDir::new().unwrap();
    let (control, _stub) =
        control_with_downloaded_book(READER_KEPUB, dir.path().join("kobo.json")).await;

    let result = control
        .highlight_words(
            "book-1".into(),
            "naïve and still, far from Zürich.".into(),
            Swatch::Blue,
            None,
        )
        .await
        .unwrap();

    assert!(matches!(result, Acted::Done(_)), "{result:?}");
    let annotation = &control.view().library["book-1"].annotations[0];
    assert_eq!(annotation.color, Swatch::Blue);
    assert_eq!(annotation.text, "naïve and still, far from Zürich.");
    let location = span_range(&annotation.location).expect("a materialized span location");
    assert_eq!(location.chapter, "ch2.xhtml");
    assert_eq!(location.start_span, "kobo.2.1");
    assert_eq!(location.start_char, 22);
    assert_eq!(location.end_span, "kobo.2.1");
    assert_eq!(location.end_char, 55);
}

#[tokio::test]
async fn highlight_words_returns_passage_not_found_without_a_request() {
    let dir = TempDir::new().unwrap();
    let (control, stub) =
        control_with_downloaded_book(READER_KEPUB, dir.path().join("kobo.json")).await;
    let before = stub.paths().len();

    let error = control
        .highlight_words(
            "book-1".into(),
            "words that are not in the book".into(),
            Swatch::Blue,
            None,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, ControlError::PassageNotFound(_)));
    assert_eq!(stub.paths().len(), before, "no request was made");
}
