//! Annotations against the real routers: AC1's green half (AnnotationsUnheld)
//! and HighlightColor's green half.

use omnibus_db::annotations::IngestKoboAnnotation;
use omnibus_db::test_support::{seed_synced_ebook, EnvVarGuard};
use omnibus_mock_kobo::annotations::{NewHighlight, SpanRange, Swatch};
use omnibus_mock_kobo::device::Device;
use omnibus_mock_kobo::downloads::DownloadPolicy;
use omnibus_mock_kobo::session::{attempt_annotation, sync_now, AnnotationSent};
use omnibus_shared::HighlightColor;

use super::*;

fn blue_highlight_with_note() -> NewHighlight {
    NewHighlight {
        text: "a passage".into(),
        color: Swatch::Blue,
        note: Some("a thought".into()),
        location: Some(SpanRange {
            chapter: "OEBPS/ch1.xhtml".into(),
            start_span: "kobo.1.2".into(),
            start_char: 3,
            end_span: "kobo.1.4".into(),
            end_char: 9,
        }),
    }
}

#[tokio::test]
async fn sync_now_drops_highlights_for_a_book_it_has_not_downloaded_and_is_offered_them_again() {
    let omnibus = spawn_omnibus().await;
    let uuid = seed_synced_ebook(&omnibus.pool, "dune.epub", "Dune", "Frank Herbert").await;
    opt_in(&omnibus.pool, omnibus.user_id, std::slice::from_ref(&uuid)).await;
    db::annotations::ingest_kobo_annotations(
        &omnibus.pool,
        omnibus.user_id,
        &uuid,
        &[IngestKoboAnnotation {
            client_id: "c-1".into(),
            color: HighlightColor::Amber,
            text: Some("a passage".into()),
            note: None,
            kobo_location: r#"{"span":{"chapterFilename":"OEBPS/ch1.xhtml","startPath":"span#kobo\\.1\\.2","startChar":0,"endPath":"span#kobo\\.1\\.2","endChar":1}}"#.into(),
            epub_cfi_range: None,
        }],
        &[],
    )
    .await
    .unwrap();
    let mut device = Device::new("HW-1");
    let annotations_path = format!("/api/v3/content/{uuid}/annotations");

    sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();
    assert!(device.library[&uuid].annotations.is_empty());
    assert_eq!(device.library[&uuid].dropped_annotations, 1);

    let second = sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();
    assert!(second
        .requests
        .iter()
        .any(|r| r.path == annotations_path && r.status == 200));
    assert!(device.library[&uuid].annotations.is_empty());
}

#[tokio::test]
async fn sync_now_lands_each_omnibus_colour_on_its_kobo_swatch() {
    let _no_kepubify = EnvVarGuard::set("OMNIBUS_KEPUBIFY_PATH", Some("/no/such/kepubify"));
    let omnibus = spawn_omnibus().await;
    let uuid = "72e1c9f0-0000-4000-8000-000000000201";
    seed_downloadable_book(&omnibus.pool, uuid, "The Golden Fixture", "Ada Lovelace").await;
    opt_in(&omnibus.pool, omnibus.user_id, &[uuid.to_owned()]).await;
    let entries = [
        ("c-amber", HighlightColor::Amber),
        ("c-green", HighlightColor::Green),
        ("c-blue", HighlightColor::Blue),
        ("c-rose", HighlightColor::Rose),
        ("c-violet", HighlightColor::Violet),
    ];
    let updates: Vec<IngestKoboAnnotation> = entries
        .iter()
        .map(|(id, color)| IngestKoboAnnotation {
            client_id: (*id).to_owned(),
            color: *color,
            text: Some("text".into()),
            note: None,
            kobo_location: "null".into(),
            epub_cfi_range: None,
        })
        .collect();
    db::annotations::ingest_kobo_annotations(&omnibus.pool, omnibus.user_id, uuid, &updates, &[])
        .await
        .unwrap();
    let mut device = Device::new("HW-1");

    sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::All)
        .await
        .unwrap();

    let by_id: std::collections::HashMap<String, Swatch> = device.library[uuid]
        .annotations
        .iter()
        .map(|a| (a.id.clone(), a.color))
        .collect();
    assert_eq!(by_id["c-amber"], Swatch::Yellow);
    assert_eq!(by_id["c-green"], Swatch::Green);
    assert_eq!(by_id["c-blue"], Swatch::Blue);
    assert_eq!(by_id["c-rose"], Swatch::Pink);
    assert_eq!(by_id["c-violet"], Swatch::Pink);
}

#[tokio::test]
async fn attempt_annotation_sends_a_device_highlight_and_note_to_the_server() {
    let _no_kepubify = EnvVarGuard::set("OMNIBUS_KEPUBIFY_PATH", Some("/no/such/kepubify"));
    let omnibus = spawn_omnibus().await;
    let uuid = "72e1c9f0-0000-4000-8000-000000000202";
    seed_downloadable_book(&omnibus.pool, uuid, "The Golden Fixture", "Ada Lovelace").await;
    opt_in(&omnibus.pool, omnibus.user_id, &[uuid.to_owned()]).await;
    let mut device = Device::new("HW-1");
    sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::All)
        .await
        .unwrap();
    device
        .highlight(uuid, "mock-h-1".into(), blue_highlight_with_note())
        .unwrap();

    let attempt = attempt_annotation(
        &mut device,
        &omnibus.endpoint,
        uuid,
        AnnotationSent::Upsert("mock-h-1".into()),
        1_700_000_000,
    )
    .await;

    assert!(attempt.outcome.is_ok(), "{:?}", attempt.outcome);
    let served = db::annotations::served_kobo_annotations(&omnibus.pool, omnibus.user_id, uuid)
        .await
        .unwrap();
    assert_eq!(served.len(), 1);
    let row = &served[0];
    assert_eq!(row.client_id, "mock-h-1");
    assert_eq!(row.color, HighlightColor::Blue);
    assert_eq!(row.text.as_deref(), Some("a passage"));
    assert_eq!(row.note.as_deref(), Some("a thought"));
    let location: serde_json::Value = serde_json::from_str(&row.kobo_location).unwrap();
    assert_eq!(location["span"]["startPath"], "span#kobo\\.1\\.2");
}

#[tokio::test]
async fn attempt_annotation_deletes_a_device_highlight_from_the_server() {
    let _no_kepubify = EnvVarGuard::set("OMNIBUS_KEPUBIFY_PATH", Some("/no/such/kepubify"));
    let omnibus = spawn_omnibus().await;
    let uuid = "72e1c9f0-0000-4000-8000-000000000203";
    seed_downloadable_book(&omnibus.pool, uuid, "The Golden Fixture", "Ada Lovelace").await;
    opt_in(&omnibus.pool, omnibus.user_id, &[uuid.to_owned()]).await;
    let mut device = Device::new("HW-1");
    sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::All)
        .await
        .unwrap();
    device
        .highlight(uuid, "mock-h-1".into(), blue_highlight_with_note())
        .unwrap();
    attempt_annotation(
        &mut device,
        &omnibus.endpoint,
        uuid,
        AnnotationSent::Upsert("mock-h-1".into()),
        1_700_000_000,
    )
    .await
    .outcome
    .unwrap();
    device.delete_highlight(uuid, "mock-h-1").unwrap();

    let attempt = attempt_annotation(
        &mut device,
        &omnibus.endpoint,
        uuid,
        AnnotationSent::Delete("mock-h-1".into()),
        1_700_000_000,
    )
    .await;

    assert!(attempt.outcome.is_ok(), "{:?}", attempt.outcome);
    let served = db::annotations::served_kobo_annotations(&omnibus.pool, omnibus.user_id, uuid)
        .await
        .unwrap();
    assert!(served.is_empty());
    let highlights = db::annotations::list_highlights(
        &omnibus.pool,
        omnibus.user_id,
        uuid,
        db::anchor::AnnotationOrder::Position,
    )
    .await
    .unwrap();
    assert!(highlights.is_empty());
}
