use serde_json::{json, Value};

use super::*;
use crate::test_support::{book_metadata, new_entitlement};
use crate::wire::Series;

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
    };
    assert_eq!(device.library["book-1"], expected);
}

#[test]
fn apply_shows_unknown_author_when_only_contributor_roles_sent() {
    let mut device = Device::new("HW-1");
    let mut entitlement = new_entitlement("book-1", "Dune");
    entitlement["NewEntitlement"]["BookMetadata"]["ContributorRoles"] =
        json!([{ "Name": "Frank Herbert", "Role": "Author" }]);

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
    }})));

    let book = &device.library["book-1"];
    assert_eq!((book.title.as_str(), book.archived), ("Dune", true));
}
