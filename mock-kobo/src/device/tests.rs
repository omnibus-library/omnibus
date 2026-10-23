//! `Device::apply` over each `library_sync` item shape the server sends.

use serde_json::{json, Value};

use crate::reading::ReadStatus;
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
