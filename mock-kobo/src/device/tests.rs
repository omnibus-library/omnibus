//! `Device::apply` over each `library_sync` item shape the server sends.

use serde_json::{json, Value};

use crate::reading::{rfc3339, Bookmark, KoboSpan, Percent, ReadStatus};
use crate::test_support::{book_metadata, new_entitlement};
use crate::wire::Series;

use super::*;

fn item(value: Value) -> SyncItem {
    serde_json::from_value(value).unwrap()
}

#[test]
fn apply_adds_new_entitlement_as_undownloaded_book() {
    let mut device = Device::new("HW-1");
    let mut entitlement = new_entitlement("book-1", "Dune");
    let metadata = &mut entitlement["NewEntitlement"]["BookMetadata"];
    metadata["Description"] = json!("Spice.");
    metadata["Contributors"] = json!(["Frank Herbert", "Brian Herbert"]);
    metadata["Series"] = json!({ "Name": "Dune", "Number": 1.0, "NumberFloat": 1.0, "Id": "s-1" });

    device.apply(item(entitlement));

    let expected = Book {
        title: "Dune".into(),
        description: "Spice.".into(),
        authors: vec!["Frank Herbert".into(), "Brian Herbert".into()],
        series: Some(Series {
            name: "Dune".into(),
            number: Some(1.0),
            id: "s-1".into(),
        }),
        downloaded: false,
        archived: false,
        cover_image_id: "book-1".into(),
        cover: None,
        download_problem: None,
        reading: crate::reading::Reading::default(),
        annotations: Vec::new(),
        dropped_annotations: 0,
    };
    assert_eq!(device.library["book-1"], expected);
}

#[test]
fn apply_shows_unknown_author_when_only_contributor_roles_sent() {
    let mut device = Device::new("HW-1");
    let mut entitlement = new_entitlement("book-1", "Dune");
    let metadata = entitlement["NewEntitlement"]["BookMetadata"]
        .as_object_mut()
        .unwrap();
    metadata.remove("Contributors");
    metadata.insert(
        "ContributorRoles".into(),
        json!([{ "Name": "Frank Herbert", "Role": "Author" }]),
    );

    device.apply(item(entitlement));

    assert_eq!(device.library["book-1"].authors, ["Unknown"]);
}

#[test]
fn apply_refreshes_metadata_without_redownload_when_product_metadata_changes() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));
    device.library.get_mut("book-1").unwrap().downloaded = true;

    device.apply(item(json!({
        "ChangedProductMetadata": { "BookMetadata": book_metadata("book-1", "Dune Messiah") }
    })));

    let book = &device.library["book-1"];
    assert_eq!(
        (book.title.as_str(), book.downloaded),
        ("Dune Messiah", true)
    );
}

#[test]
fn apply_archives_book_when_entitlement_is_removed() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));

    device.apply(item(json!({ "ChangedEntitlement": {
        "BookEntitlement": { "Id": "book-1", "IsRemoved": true, "Status": "Deleted" },
        "BookMetadata": book_metadata("book-1", ""),
        "ReadingState": {
            "EntitlementId": "book-1",
            "StatusInfo": { "Status": "ReadyToRead" },
            "CurrentBookmark": {},
        },
    }})));

    let book = &device.library["book-1"];
    assert_eq!((book.title.as_str(), book.archived), ("Dune", true));
}

#[test]
fn apply_leaves_library_unchanged_when_reading_state_changes() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));
    let before = device.clone();

    device.apply(item(json!({ "ChangedReadingState": { "ReadingState": {
        "EntitlementId": "book-1",
        "StatusInfo": { "Status": "Reading" },
        "CurrentBookmark": { "ProgressPercent": 42 },
    }}})));

    assert_eq!(device, before);
}

#[test]
fn apply_takes_the_reading_state_of_a_new_entitlement() {
    let mut entitlement = new_entitlement("book-1", "Dune");
    entitlement["NewEntitlement"]["ReadingState"]["StatusInfo"] = json!({
        "Status": "Reading",
        "LastModified": "2024-01-01T00:00:00Z",
    });
    let mut device = Device::new("HW-1");

    device.apply(item(entitlement));

    assert_eq!(device.library["book-1"].reading.status, ReadStatus::Reading);
}

/// A held, downloaded "book-1" with its bookmark stamped at `modified`.
fn device_with_bookmark(modified: i64) -> Device {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));
    let book = device.library.get_mut("book-1").unwrap();
    book.downloaded = true;
    book.reading.bookmark = Some(Bookmark {
        percent: Percent::new(55),
        location: None,
        modified,
    });
    device
}

#[test]
fn apply_keeps_a_newer_local_bookmark_when_a_replayed_new_entitlements_bookmark_is_older() {
    let mut device = device_with_bookmark(2_000);
    let mut entitlement = new_entitlement("book-1", "Dune");
    entitlement["NewEntitlement"]["ReadingState"]["CurrentBookmark"] = json!({
        "ProgressPercent": 10,
        "LastModified": rfc3339(1_000),
    });

    device.apply(item(entitlement));

    let book = &device.library["book-1"];
    assert!(book.downloaded);
    let bookmark = book.reading.bookmark.as_ref().unwrap();
    assert_eq!(
        (bookmark.percent, bookmark.modified),
        (Percent::new(55), 2_000)
    );
}

#[test]
fn apply_keeps_a_local_bookmark_when_a_replayed_new_entitlements_bookmark_is_equally_stamped() {
    let mut device = device_with_bookmark(2_000);
    let mut entitlement = new_entitlement("book-1", "Dune");
    entitlement["NewEntitlement"]["ReadingState"]["CurrentBookmark"] = json!({
        "ProgressPercent": 10,
        "LastModified": rfc3339(2_000),
    });

    device.apply(item(entitlement));

    let book = &device.library["book-1"];
    assert!(book.downloaded);
    let bookmark = book.reading.bookmark.as_ref().unwrap();
    assert_eq!(
        (bookmark.percent, bookmark.modified),
        (Percent::new(55), 2_000)
    );
}

#[test]
fn apply_keeps_a_local_bookmark_when_a_replayed_new_entitlements_bookmark_is_unstamped() {
    let mut device = device_with_bookmark(2_000);
    // `new_entitlement`'s own `CurrentBookmark` template is `{}`: no `LastModified` at all.
    let entitlement = new_entitlement("book-1", "Dune");

    device.apply(item(entitlement));

    let book = &device.library["book-1"];
    assert!(book.downloaded);
    let bookmark = book.reading.bookmark.as_ref().unwrap();
    assert_eq!(
        (bookmark.percent, bookmark.modified),
        (Percent::new(55), 2_000)
    );
}

#[test]
fn apply_clears_archived_when_a_held_archived_book_is_reannounced() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));
    device.apply(item(json!({ "ChangedEntitlement": {
        "BookEntitlement": { "Id": "book-1", "IsRemoved": true, "Status": "Deleted" },
        "BookMetadata": book_metadata("book-1", "Dune"),
        "ReadingState": {
            "EntitlementId": "book-1",
            "StatusInfo": { "Status": "ReadyToRead" },
            "CurrentBookmark": {},
        },
    }})));
    assert!(device.library["book-1"].archived);

    device.apply(item(new_entitlement("book-1", "Dune")));

    assert!(!device.library["book-1"].archived);
}

#[test]
fn apply_reconciles_a_changed_reading_state_for_a_held_book() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));

    device.apply(item(json!({ "ChangedReadingState": { "ReadingState": {
        "EntitlementId": "book-1",
        "StatusInfo": { "Status": "Finished", "LastModified": "2024-01-01T00:00:00Z" },
        "CurrentBookmark": {},
    }}})));

    assert_eq!(
        device.library["book-1"].reading.status,
        ReadStatus::Finished
    );
}

#[test]
fn remove_download_clears_downloaded_and_the_problem() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));
    let book = device.library.get_mut("book-1").unwrap();
    book.downloaded = true;
    book.download_problem = Some("stale".into());

    device.remove_download("book-1").unwrap();

    let book = &device.library["book-1"];
    assert_eq!((book.downloaded, &book.download_problem), (false, &None));
}

#[test]
fn remove_download_returns_unknown_book_for_a_book_it_lacks() {
    let mut device = Device::new("HW-1");

    let error = device.remove_download("book-1").unwrap_err();

    assert_eq!(error, DeviceError::UnknownBook("book-1".into()));
}

#[test]
fn read_stamps_status_and_bookmark_at_now() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));
    device.library.get_mut("book-1").unwrap().downloaded = true;
    let location = KoboSpan {
        source: "c1.xhtml".into(),
        value: "kobo.2.1".into(),
    };

    device
        .read(
            "book-1",
            Percent::new(42).unwrap(),
            Some(location.clone()),
            1_700_000_000,
        )
        .unwrap();

    let reading = &device.library["book-1"].reading;
    assert_eq!(reading.status, ReadStatus::Reading);
    assert_eq!(reading.status_modified, Some(1_700_000_000));
    let bookmark = reading.bookmark.as_ref().unwrap();
    assert_eq!(
        (bookmark.percent, &bookmark.location, bookmark.modified),
        (Percent::new(42), &Some(location), 1_700_000_000)
    );
}

#[test]
fn read_returns_not_downloaded_for_an_undownloaded_book() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));

    let error = device
        .read("book-1", Percent::new(42).unwrap(), None, 1_700_000_000)
        .unwrap_err();

    assert_eq!(error, DeviceError::NotDownloaded("book-1".into()));
}

#[test]
fn read_returns_unknown_book_for_a_book_it_lacks() {
    let mut device = Device::new("HW-1");

    let error = device
        .read("book-1", Percent::new(42).unwrap(), None, 1_700_000_000)
        .unwrap_err();

    assert_eq!(error, DeviceError::UnknownBook("book-1".into()));
}

#[test]
fn finish_stamps_finished_at_now() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));

    device.finish("book-1", 1_700_000_000).unwrap();

    let reading = &device.library["book-1"].reading;
    assert_eq!(reading.status, ReadStatus::Finished);
    assert_eq!(reading.status_modified, Some(1_700_000_000));
}

#[test]
fn finish_returns_unknown_book_for_a_book_it_lacks() {
    let mut device = Device::new("HW-1");

    let error = device.finish("book-1", 1_700_000_000).unwrap_err();

    assert_eq!(error, DeviceError::UnknownBook("book-1".into()));
}

fn annotation(id: &str) -> crate::annotations::Annotation {
    crate::annotations::Annotation {
        id: id.to_owned(),
        text: "some text".into(),
        note: None,
        color: crate::annotations::Swatch::Yellow,
        location: Value::Null,
    }
}

#[test]
fn receive_annotations_replaces_the_highlights_of_a_downloaded_book() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));
    let book = device.library.get_mut("book-1").unwrap();
    book.downloaded = true;
    book.dropped_annotations = 3;
    let served = vec![annotation("a-1"), annotation("a-2")];

    device.receive_annotations("book-1", served.clone());

    let book = &device.library["book-1"];
    assert_eq!(book.annotations, served);
    assert_eq!(book.dropped_annotations, 0);
}

#[test]
fn receive_annotations_drops_and_counts_the_highlights_of_an_undownloaded_book() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));

    device.receive_annotations("book-1", vec![annotation("a-1"), annotation("a-2")]);

    let book = &device.library["book-1"];
    assert!(book.annotations.is_empty());
    assert_eq!(book.dropped_annotations, 2);
}

#[test]
fn receive_annotations_changes_nothing_for_a_book_the_device_lacks() {
    let mut device = Device::new("HW-1");

    device.receive_annotations("book-1", vec![annotation("a-1")]);

    assert!(!device.library.contains_key("book-1"));
}

#[test]
fn apply_keeps_a_books_highlights_when_its_metadata_changes() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));
    device.library.get_mut("book-1").unwrap().downloaded = true;
    device.receive_annotations("book-1", vec![annotation("a-1")]);

    device.apply(item(json!({
        "ChangedProductMetadata": { "BookMetadata": book_metadata("book-1", "Dune Messiah") }
    })));

    let book = &device.library["book-1"];
    assert_eq!(book.title, "Dune Messiah");
    assert_eq!(book.annotations, vec![annotation("a-1")]);
}

fn new_highlight(location: Option<crate::annotations::SpanRange>) -> crate::annotations::NewHighlight {
    crate::annotations::NewHighlight {
        text: "a passage".into(),
        color: crate::annotations::Swatch::Blue,
        note: Some("a thought".into()),
        location,
    }
}

fn span_range() -> crate::annotations::SpanRange {
    crate::annotations::SpanRange {
        chapter: "OEBPS/ch1.xhtml".into(),
        start_span: "kobo.1.2".into(),
        start_char: 3,
        end_span: "kobo.1.4".into(),
        end_char: 9,
    }
}

fn downloaded_book_1() -> Device {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));
    device.library.get_mut("book-1").unwrap().downloaded = true;
    device
}

#[test]
fn highlight_appends_the_highlight_with_its_kobospan_location() {
    let mut device = downloaded_book_1();

    device
        .highlight("book-1", "h-1".into(), new_highlight(Some(span_range())))
        .unwrap();

    let highlight = &device.library["book-1"].annotations[0];
    assert_eq!(highlight.id, "h-1");
    assert_eq!(highlight.text, "a passage");
    assert_eq!(highlight.note, Some("a thought".into()));
    assert_eq!(highlight.color, crate::annotations::Swatch::Blue);
    assert_eq!(
        highlight.location,
        json!({
            "span": {
                "chapterFilename": "OEBPS/ch1.xhtml",
                "startPath": "span#kobo\\.1\\.2",
                "startChar": 3,
                "endPath": "span#kobo\\.1\\.4",
                "endChar": 9,
            }
        })
    );
}

#[test]
fn highlight_treats_an_empty_note_as_none() {
    let mut device = downloaded_book_1();
    let mut new = new_highlight(None);
    new.note = Some(String::new());

    device.highlight("book-1", "h-1".into(), new).unwrap();

    assert_eq!(device.library["book-1"].annotations[0].note, None);
    assert_eq!(device.library["book-1"].annotations[0].location, Value::Null);
}

#[test]
fn highlight_returns_not_downloaded_for_an_undownloaded_book() {
    let mut device = Device::new("HW-1");
    device.apply(item(new_entitlement("book-1", "Dune")));

    let error = device
        .highlight("book-1", "h-1".into(), new_highlight(None))
        .unwrap_err();

    assert_eq!(error, DeviceError::NotDownloaded("book-1".into()));
}

#[test]
fn highlight_returns_unknown_book_for_a_book_it_lacks() {
    let mut device = Device::new("HW-1");

    let error = device
        .highlight("book-1", "h-1".into(), new_highlight(None))
        .unwrap_err();

    assert_eq!(error, DeviceError::UnknownBook("book-1".into()));
}

#[test]
fn delete_highlight_removes_the_highlight() {
    let mut device = downloaded_book_1();
    device
        .highlight("book-1", "h-1".into(), new_highlight(None))
        .unwrap();

    device.delete_highlight("book-1", "h-1").unwrap();

    assert!(device.library["book-1"].annotations.is_empty());
}

#[test]
fn delete_highlight_returns_unknown_highlight_for_an_id_the_book_lacks() {
    let mut device = downloaded_book_1();

    let error = device.delete_highlight("book-1", "h-1").unwrap_err();

    assert_eq!(error, DeviceError::UnknownHighlight("h-1".into()));
}

#[test]
fn delete_highlight_returns_unknown_book_for_a_book_it_lacks() {
    let mut device = Device::new("HW-1");

    let error = device.delete_highlight("book-1", "h-1").unwrap_err();

    assert_eq!(error, DeviceError::UnknownBook("book-1".into()));
}

#[test]
fn mint_hardware_id_returns_mock_prefix_and_32_hex_digits() {
    let id = mint_hardware_id().unwrap();

    let digits = id.strip_prefix("mock-").unwrap();
    assert_eq!(digits.len(), 32);
    assert!(digits.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
}

#[test]
fn mint_hardware_id_differs_between_calls() {
    assert_ne!(mint_hardware_id().unwrap(), mint_hardware_id().unwrap());
}
