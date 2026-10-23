//! `Swatch::from_wire`'s colour table, and `sync_now`'s annotation phase
//! against a stub Omnibus: one test per firmware rule the device enforces.

use std::collections::BTreeMap;

use axum::http::StatusCode;

use crate::device::Device;
use crate::downloads::DownloadPolicy;
use crate::session::sync_now;
use crate::test_support::{device_holding, new_entitlement, request_lines, served_annotation, Stub};

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
        assert_eq!(
            recorded[0].headers.get("if-none-match").unwrap(),
            "W/\"0\""
        );
    }
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
