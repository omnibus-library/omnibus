//! `Swatch::from_wire`'s colour table, and `sync_now`'s annotation phase
//! against a stub Omnibus: one test per firmware rule the device enforces.

use std::collections::BTreeMap;

use axum::http::StatusCode;
use serde_json::json;

use crate::device::Device;
use crate::downloads::DownloadPolicy;
use crate::session::{attempt_annotation, attempt_download, sync_now, AnnotationSent, SyncFailure};
use crate::test_support::{
    device_holding, new_entitlement, request_lines, served_annotation, spawn_stub, RunningStub,
    Stub,
};

use super::*;

fn annotation(id: &str) -> Annotation {
    Annotation {
        id: id.to_owned(),
        text: "existing".into(),
        note: None,
        color: Swatch::Yellow,
        location: serde_json::Value::Null,
    }
}

#[test]
fn swatch_from_wire_maps_each_kobo_hex_swatch_case_insensitively() {
    assert_eq!(Swatch::from_wire(Some("#F6F3B3")), Swatch::Yellow);
    assert_eq!(Swatch::from_wire(Some("#f6f3b3")), Swatch::Yellow);
    assert_eq!(Swatch::from_wire(Some("#E8AFCF")), Swatch::Pink);
    assert_eq!(Swatch::from_wire(Some("#e8afcf")), Swatch::Pink);
    assert_eq!(Swatch::from_wire(Some("#B2E1E8")), Swatch::Blue);
    assert_eq!(Swatch::from_wire(Some("#b2e1e8")), Swatch::Blue);
    assert_eq!(Swatch::from_wire(Some("#C6E09E")), Swatch::Green);
    assert_eq!(Swatch::from_wire(Some("#c6e09e")), Swatch::Green);
}

#[test]
fn swatch_from_wire_maps_anything_else_to_yellow() {
    assert_eq!(Swatch::from_wire(Some("green")), Swatch::Yellow);
    assert_eq!(Swatch::from_wire(Some("#123456")), Swatch::Yellow);
    assert_eq!(Swatch::from_wire(None), Swatch::Yellow);
}

#[tokio::test]
async fn sync_now_gets_the_annotations_of_each_book_checkforchanges_names_with_if_none_match() {
    let stub = crate::test_support::spawn_stub(Stub {
        reading_services_changed: vec!["book-1".into(), "book-2".into()],
        reading_services_annotations: BTreeMap::from([
            (
                "book-1".into(),
                vec![served_annotation("a-1", "#F6F3B3", "one")],
            ),
            (
                "book-2".into(),
                vec![served_annotation("a-2", "#F6F3B3", "two")],
            ),
        ]),
        ..Stub::default()
    })
    .await;
    let mut device = device_holding("book-1", "Dune");
    device.apply(serde_json::from_value(new_entitlement("book-2", "Dune Messiah")).unwrap());

    let report = sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

    let get_lines: Vec<String> = request_lines(&report.requests)
        .into_iter()
        .filter(|l| l.contains("/annotations"))
        .collect();
    assert_eq!(
        get_lines,
        [
            "GET /api/v3/content/book-1/annotations 200",
            "GET /api/v3/content/book-2/annotations 200",
        ]
    );
    let checkforchanges = stub.requests_to("/api/v3/content/checkforchanges");
    assert_eq!(checkforchanges.len(), 1);
    assert_eq!(checkforchanges[0].method, "POST");
    assert_eq!(checkforchanges[0].body, "[]");
    for path in [
        "/api/v3/content/book-1/annotations",
        "/api/v3/content/book-2/annotations",
    ] {
        let recorded = stub.requests_to(path);
        assert_eq!(recorded[0].headers.get("if-none-match").unwrap(), "W/\"0\"");
    }
}

#[tokio::test]
async fn sync_now_skips_a_checkforchanges_id_with_unsafe_characters() {
    let stub = crate::test_support::spawn_stub(Stub {
        reading_services_changed: vec!["../../admin".into(), "book-1".into()],
        reading_services_annotations: BTreeMap::from([(
            "book-1".into(),
            vec![served_annotation("a-1", "#F6F3B3", "a passage")],
        )]),
        ..Stub::default()
    })
    .await;
    let mut device = device_holding("book-1", "Dune");

    let report = sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

    let get_lines: Vec<String> = request_lines(&report.requests)
        .into_iter()
        .filter(|l| l.contains("/annotations"))
        .collect();
    assert_eq!(get_lines, ["GET /api/v3/content/book-1/annotations 200"]);
}

#[tokio::test]
async fn sync_now_keeps_a_downloaded_books_highlights_when_the_get_answers_not_modified() {
    let stub = crate::test_support::spawn_stub(Stub {
        reading_services_changed: vec!["book-1".into()],
        ..Stub::default()
    })
    .await;
    let mut device = device_holding("book-1", "Dune");
    let book = device.library.get_mut("book-1").unwrap();
    book.downloaded = true;
    book.annotations = vec![annotation("existing")];

    sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

    let book = &device.library["book-1"];
    assert_eq!(book.annotations, [annotation("existing")]);
    assert_eq!(book.dropped_annotations, 0);
}

#[tokio::test]
async fn sync_now_stays_synced_when_checkforchanges_answers_500() {
    let stub = crate::test_support::spawn_stub(Stub {
        reading_services_status: StatusCode::INTERNAL_SERVER_ERROR,
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");

    let report = sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

    assert!(request_lines(&report.requests)
        .iter()
        .any(|l| l == "POST /api/v3/content/checkforchanges 500"));
}

#[tokio::test]
async fn sync_now_never_lands_highlights_for_an_undownloaded_book_the_server_acked_on_serve() {
    let stub = crate::test_support::spawn_stub(Stub {
        reading_services_changed: vec!["book-1".into()],
        reading_services_annotations: BTreeMap::from([(
            "book-1".into(),
            vec![served_annotation("a-1", "#F6F3B3", "a passage")],
        )]),
        ..Stub::default()
    })
    .await;
    let mut device = device_holding("book-1", "Dune");

    sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();
    assert!(device.library["book-1"].annotations.is_empty());
    assert_eq!(device.library["book-1"].dropped_annotations, 1);

    let second = sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();
    let lines = request_lines(&second.requests);
    assert!(lines.iter().any(|l| l.contains("checkforchanges")));
    assert!(!lines.iter().any(|l| l.contains("/annotations")));
    assert!(device.library["book-1"].annotations.is_empty());
}

#[tokio::test]
async fn sync_now_lands_a_css_colour_name_as_yellow() {
    let stub = crate::test_support::spawn_stub(Stub {
        reading_services_changed: vec!["book-1".into()],
        reading_services_annotations: BTreeMap::from([(
            "book-1".into(),
            vec![
                served_annotation("a-green", "green", "one"),
                served_annotation("a-blue", "blue", "two"),
                served_annotation("a-pink", "pink", "three"),
            ],
        )]),
        ..Stub::default()
    })
    .await;
    let mut device = device_holding("book-1", "Dune");
    device.library.get_mut("book-1").unwrap().downloaded = true;

    sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

    let colors: Vec<Swatch> = device.library["book-1"]
        .annotations
        .iter()
        .map(|a| a.color)
        .collect();
    assert_eq!(colors, [Swatch::Yellow, Swatch::Yellow, Swatch::Yellow]);
}

/// A device holding a downloaded "book-1" with one highlight "h-1" already
/// appended, synced against `stub`'s origin as its `reading_services_host`.
fn device_with_highlight(
    stub: &RunningStub,
    note: Option<&str>,
    location: Option<SpanRange>,
) -> Device {
    let mut device = device_holding("book-1", "Dune");
    device.library.get_mut("book-1").unwrap().downloaded = true;
    device.reading_services_host = Some(stub.origin.clone());
    device
        .highlight(
            "book-1",
            "h-1".into(),
            NewHighlight {
                text: "a passage".into(),
                color: Swatch::Pink,
                note: note.map(str::to_owned),
                location,
            },
        )
        .unwrap();
    device
}

fn patch_body(stub: &RunningStub, book: &str) -> serde_json::Value {
    let recorded = stub.requests_to(&format!("/api/v3/content/{book}/annotations"));
    let patch = recorded
        .iter()
        .find(|r| r.method == "PATCH")
        .expect("no PATCH recorded");
    serde_json::from_str(&patch.body).unwrap()
}

#[tokio::test]
async fn attempt_annotation_patches_a_highlight_with_its_note_to_the_reading_services_host() {
    let stub = spawn_stub(Stub::default()).await;
    let location = Some(SpanRange {
        chapter: "OEBPS/ch1.xhtml".into(),
        start_span: "kobo.1.2".into(),
        start_char: 3,
        end_span: "kobo.1.4".into(),
        end_char: 9,
    });
    let mut device = device_with_highlight(&stub, Some("a thought"), location);

    let attempt = attempt_annotation(
        &mut device,
        &stub.endpoint,
        "book-1",
        AnnotationSent::Upsert("h-1".into()),
        1_700_000_000,
    )
    .await;

    assert!(attempt.outcome.is_ok(), "{:?}", attempt.outcome);
    assert_eq!(
        patch_body(&stub, "book-1"),
        json!({
            "updatedAnnotations": [{
                "id": "h-1",
                "type": "note",
                "highlightColor": "#E8AFCF",
                "highlightedText": "a passage",
                "noteText": "a thought",
                "clientLastModifiedUtc": "2023-11-14T22:13:20Z",
                "location": {
                    "span": {
                        "chapterFilename": "OEBPS/ch1.xhtml",
                        "startPath": "span#kobo\\.1\\.2",
                        "startChar": 3,
                        "endPath": "span#kobo\\.1\\.4",
                        "endChar": 9,
                    }
                }
            }]
        })
    );
}

#[tokio::test]
async fn attempt_annotation_patches_a_highlight_without_a_note_or_location() {
    let stub = spawn_stub(Stub::default()).await;
    let mut device = device_with_highlight(&stub, None, None);

    let attempt = attempt_annotation(
        &mut device,
        &stub.endpoint,
        "book-1",
        AnnotationSent::Upsert("h-1".into()),
        1_700_000_000,
    )
    .await;

    assert!(attempt.outcome.is_ok(), "{:?}", attempt.outcome);
    let body = patch_body(&stub, "book-1");
    assert_eq!(body["updatedAnnotations"][0]["type"], "highlight");
    assert!(body["updatedAnnotations"][0].get("noteText").is_none());
    assert_eq!(
        body["updatedAnnotations"][0]["location"],
        serde_json::Value::Null
    );
}

#[tokio::test]
async fn attempt_annotation_patches_a_delete_as_deleted_annotation_ids() {
    let stub = spawn_stub(Stub::default()).await;
    let mut device = device_with_highlight(&stub, None, None);

    let attempt = attempt_annotation(
        &mut device,
        &stub.endpoint,
        "book-1",
        AnnotationSent::Delete("h-1".into()),
        1_700_000_000,
    )
    .await;

    assert!(attempt.outcome.is_ok(), "{:?}", attempt.outcome);
    assert_eq!(
        patch_body(&stub, "book-1"),
        json!({ "deletedAnnotationIds": ["h-1"] })
    );
}

#[tokio::test]
async fn attempt_annotation_fails_rejected_when_the_patch_answers_500() {
    let stub = spawn_stub(Stub {
        patch_status: StatusCode::INTERNAL_SERVER_ERROR,
        ..Stub::default()
    })
    .await;
    let mut device = device_with_highlight(&stub, None, None);

    let attempt = attempt_annotation(
        &mut device,
        &stub.endpoint,
        "book-1",
        AnnotationSent::Upsert("h-1".into()),
        1_700_000_000,
    )
    .await;

    assert!(matches!(attempt.outcome, Err(SyncFailure::Rejected(_))));
}

#[tokio::test]
async fn attempt_annotation_fails_with_transport_when_the_server_is_unreachable() {
    let mut device = device_holding("book-1", "Dune");
    device.library.get_mut("book-1").unwrap().downloaded = true;
    device.reading_services_host = Some("http://127.0.0.1:1".into());
    device
        .highlight(
            "book-1",
            "h-1".into(),
            NewHighlight {
                text: "a passage".into(),
                color: Swatch::Yellow,
                note: None,
                location: None,
            },
        )
        .unwrap();

    let attempt = attempt_annotation(
        &mut device,
        "http://127.0.0.1:1",
        "book-1",
        AnnotationSent::Upsert("h-1".into()),
        1_700_000_000,
    )
    .await;

    assert!(matches!(attempt.outcome, Err(SyncFailure::Transport(_))));
}

#[tokio::test]
async fn attempt_annotation_fails_until_a_sync_names_the_reading_services_host() {
    let stub = spawn_stub(Stub::default()).await;
    let mut device = device_holding("book-1", "Dune");
    device.library.get_mut("book-1").unwrap().downloaded = true;
    device
        .highlight(
            "book-1",
            "h-1".into(),
            NewHighlight {
                text: "a passage".into(),
                color: Swatch::Yellow,
                note: None,
                location: None,
            },
        )
        .unwrap();

    let attempt = attempt_annotation(
        &mut device,
        &stub.endpoint,
        "book-1",
        AnnotationSent::Upsert("h-1".into()),
        1_700_000_000,
    )
    .await;

    assert!(matches!(attempt.outcome, Err(SyncFailure::Rejected(_))));
    assert!(attempt.requests.is_empty());
}

#[tokio::test]
async fn attempt_annotation_rejects_an_upsert_for_a_highlight_the_device_no_longer_holds() {
    let stub = spawn_stub(Stub::default()).await;
    let mut device = device_with_highlight(&stub, None, None);

    let attempt = attempt_annotation(
        &mut device,
        &stub.endpoint,
        "book-1",
        AnnotationSent::Upsert("missing".into()),
        1_700_000_000,
    )
    .await;

    assert!(matches!(attempt.outcome, Err(SyncFailure::Rejected(_))));
    assert!(attempt.requests.is_empty());
}

#[tokio::test]
async fn attempt_download_fetches_annotations_unconditionally_after_the_server_stopped_reporting_the_book(
) {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        reading_services_changed: vec!["book-1".into()],
        reading_services_annotations: BTreeMap::from([(
            "book-1".into(),
            vec![served_annotation("a-1", "#F6F3B3", "a passage")],
        )]),
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");
    sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();
    assert!(device.library["book-1"].annotations.is_empty());
    assert_eq!(device.library["book-1"].dropped_annotations, 1);

    let attempt = attempt_download(&mut device, &stub.endpoint, &["book-1".into()]).await;

    assert!(attempt.outcome.is_ok(), "{:?}", attempt.outcome);
    assert_eq!(
        request_lines(&attempt.requests),
        [
            "GET /kobo/<token>/v1/download/book-1 200",
            "GET /api/v3/content/book-1/annotations 200",
        ]
    );
    let recorded = stub.requests_to("/api/v3/content/book-1/annotations");
    assert!(recorded
        .last()
        .unwrap()
        .headers
        .get("if-none-match")
        .is_none());
    assert_eq!(device.library["book-1"].annotations.len(), 1);
    assert_eq!(device.library["book-1"].dropped_annotations, 0);
}

#[tokio::test]
async fn sync_now_follows_each_download_with_one_annotations_get() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([
            new_entitlement("book-1", "Dune"),
            new_entitlement("book-2", "Dune Messiah"),
        ])],
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");

    let report = sync_now(&mut device, &stub.endpoint, &DownloadPolicy::All)
        .await
        .unwrap();

    let interesting: Vec<String> = request_lines(&report.requests)
        .into_iter()
        .filter(|l| {
            l.contains("/download/") || l.contains("/annotations") || l.contains("checkforchanges")
        })
        .collect();
    assert_eq!(
        interesting,
        [
            "GET /kobo/<token>/v1/download/book-1 200",
            "GET /api/v3/content/book-1/annotations 304",
            "GET /kobo/<token>/v1/download/book-2 200",
            "GET /api/v3/content/book-2/annotations 304",
            "POST /api/v3/content/checkforchanges 200",
        ]
    );
}

#[tokio::test]
async fn attempt_download_makes_no_annotations_get_when_the_download_fails() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        download_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");
    sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

    let attempt = attempt_download(&mut device, &stub.endpoint, &["book-1".into()]).await;

    assert!(attempt.outcome.is_err());
    assert!(!request_lines(&attempt.requests)
        .iter()
        .any(|l| l.contains("/annotations")));
}
