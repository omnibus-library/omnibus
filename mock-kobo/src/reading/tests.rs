//! `Reading::apply`'s arbitration table, then `sync_now`'s reconciliation pass against a stub.

use serde_json::json;

use crate::device::Device;
use crate::session::sync_now;
use crate::test_support::{new_entitlement, spawn_stub, Stub};
use crate::wire::{CurrentBookmark, ReadingState, StatusInfo};

use super::*;

/// An RFC 3339 stamp for `epoch`, for tests that only care about ordering.
fn stamp(epoch: i64) -> String {
    time::OffsetDateTime::from_unix_timestamp(epoch)
        .unwrap()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap()
}

fn server_state(
    status: ReadStatus,
    status_at: Option<i64>,
    percent: Option<i64>,
    bookmark_at: Option<i64>,
) -> ReadingState {
    ReadingState {
        entitlement_id: "book-1".into(),
        status_info: StatusInfo {
            status,
            last_modified: status_at.map(stamp),
        },
        current_bookmark: CurrentBookmark {
            progress_percent: percent,
            location: None,
            last_modified: bookmark_at.map(stamp),
        },
    }
}

#[test]
fn reading_apply_adopts_a_status_stamped_newer_than_its_own() {
    let mut reading = Reading {
        status: ReadStatus::ReadyToRead,
        status_modified: Some(1_000),
        bookmark: None,
    };

    reading.apply(&server_state(ReadStatus::Reading, Some(2_000), None, None));

    assert_eq!(reading.status, ReadStatus::Reading);
    assert_eq!(reading.status_modified, Some(2_000));
}

#[test]
fn reading_apply_keeps_its_status_when_the_server_stamp_is_older() {
    let mut reading = Reading {
        status: ReadStatus::Reading,
        status_modified: Some(2_000),
        bookmark: None,
    };

    reading.apply(&server_state(ReadStatus::Finished, Some(1_000), None, None));

    assert_eq!(reading.status, ReadStatus::Reading);
}

#[test]
fn reading_apply_keeps_its_bookmark_when_the_server_stamp_is_equal() {
    let own = Bookmark {
        percent: Percent::new(30),
        location: None,
        modified: 1_000,
    };
    let mut reading = Reading {
        status: ReadStatus::Reading,
        status_modified: None,
        bookmark: Some(own.clone()),
    };

    reading.apply(&server_state(
        ReadStatus::Reading,
        None,
        Some(80),
        Some(1_000),
    ));

    assert_eq!(reading.bookmark, Some(own));
}

#[test]
fn reading_apply_adopts_any_stamped_status_over_an_unstamped_one() {
    let mut reading = Reading::default();

    reading.apply(&server_state(ReadStatus::Reading, Some(1_000), None, None));

    assert_eq!(reading.status, ReadStatus::Reading);
}

#[test]
fn reading_apply_reconciles_status_and_bookmark_independently() {
    let mut reading = Reading {
        status: ReadStatus::Reading,
        status_modified: Some(5_000),
        bookmark: None,
    };

    // An older status stamp is rejected, but the unheld bookmark is still adopted.
    reading.apply(&server_state(
        ReadStatus::Finished,
        Some(1_000),
        Some(42),
        Some(2_000),
    ));

    assert_eq!(reading.status, ReadStatus::Reading);
    assert_eq!(reading.bookmark.unwrap().percent, Percent::new(42));
}

#[test]
fn reading_apply_treats_an_unparseable_stamp_as_unstamped() {
    let mut reading = Reading::default();
    let mut server = server_state(ReadStatus::Reading, None, None, None);
    server.status_info.last_modified = Some("not-a-timestamp".into());

    reading.apply(&server);

    assert_eq!(reading.status, ReadStatus::ReadyToRead);
    assert_eq!(reading.status_modified, None);
}

#[tokio::test]
async fn sync_now_keeps_its_own_bookmark_when_the_server_sends_it_unstamped() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([{ "ChangedReadingState": { "ReadingState": {
            "EntitlementId": "book-1",
            "StatusInfo": { "Status": "Finished" },
            "CurrentBookmark": { "ProgressPercent": 80 },
        }}}])],
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");
    device.apply(serde_json::from_value(new_entitlement("book-1", "Dune")).unwrap());
    device.library.get_mut("book-1").unwrap().reading = Reading {
        status: ReadStatus::ReadyToRead,
        status_modified: None,
        bookmark: Some(Bookmark {
            percent: Percent::new(30),
            location: None,
            modified: 1_000_000_000,
        }),
    };

    sync_now(
        &mut device,
        &stub.endpoint,
        &crate::downloads::DownloadPolicy::None,
    )
    .await
    .unwrap();

    let reading = &device.library["book-1"].reading;
    assert_eq!(reading.status, ReadStatus::ReadyToRead);
    assert_eq!(reading.bookmark.as_ref().unwrap().percent, Percent::new(30));
}
