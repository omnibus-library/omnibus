//! `Reading::apply`'s arbitration table, then `sync_now`'s reconciliation pass against a stub.

use axum::http::StatusCode;
use serde_json::{json, Value};

use crate::device::Device;
use crate::firmware::Quirk;
use crate::session::{attempt_state, sync_now, StateSent, SyncFailure};
use crate::test_support::{new_entitlement, spawn_stub, RunningStub, Stub};
use crate::wire::{CurrentBookmark, ReadingState, StatusInfo};

use super::*;

/// A device holding "book-1" (downloaded), with its `reading` set directly.
fn device_with_reading(reading: Reading) -> Device {
    let mut device = Device::new("HW-1");
    device.apply(serde_json::from_value(new_entitlement("book-1", "Dune")).unwrap());
    let book = device.library.get_mut("book-1").unwrap();
    book.downloaded = true;
    book.reading = reading;
    device
}

/// The most recent state PUT's body, as JSON.
fn state_put_body(stub: &RunningStub) -> Value {
    let requests = stub.requests.lock().unwrap();
    let body = &requests
        .iter()
        .rev()
        .find(|r| r.path.ends_with("/state"))
        .expect("no state PUT was recorded")
        .body;
    serde_json::from_str(body).unwrap()
}

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
fn reading_apply_adopts_a_newer_ready_to_read_over_its_own_reading_status() {
    let mut reading = Reading {
        status: ReadStatus::Reading,
        status_modified: Some(1_000),
        bookmark: None,
    };

    reading.apply(&server_state(
        ReadStatus::ReadyToRead,
        Some(2_000),
        None,
        None,
    ));

    assert_eq!(reading.status, ReadStatus::ReadyToRead);
    assert_eq!(reading.status_modified, Some(2_000));
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

#[tokio::test]
async fn sync_now_tolerates_a_location_that_is_not_a_kobospan() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([{ "ChangedReadingState": { "ReadingState": {
            "EntitlementId": "book-1",
            "StatusInfo": { "Status": "Reading", "LastModified": "2024-01-01T00:00:00Z" },
            "CurrentBookmark": {
                "ProgressPercent": 50,
                "Location": { "Type": "KoboSpan", "Value": "kobo.9.1" },
                "LastModified": "2024-01-01T00:00:00Z",
            },
        }}}])],
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");
    device.apply(serde_json::from_value(new_entitlement("book-1", "Dune")).unwrap());

    sync_now(
        &mut device,
        &stub.endpoint,
        &crate::downloads::DownloadPolicy::None,
    )
    .await
    .unwrap();

    let bookmark = device.library["book-1"].reading.bookmark.as_ref().unwrap();
    assert_eq!(bookmark.percent, Percent::new(50));
    assert_eq!(bookmark.location, None);
}

#[test]
fn percent_new_accepts_100_and_rejects_101() {
    assert!(Percent::new(100).is_some());
    assert!(Percent::new(101).is_none());
}

#[tokio::test]
async fn attempt_state_puts_status_and_bookmark_stamped_rfc3339() {
    let stub = spawn_stub(Stub::default()).await;
    let mut device = device_with_reading(Reading {
        status: ReadStatus::Reading,
        status_modified: Some(1_700_000_000),
        bookmark: Some(Bookmark {
            percent: Percent::new(42),
            location: None,
            modified: 1_700_000_000,
        }),
    });

    attempt_state(&mut device, &stub.endpoint, "book-1", StateSent::Read)
        .await
        .outcome
        .unwrap();

    let body = state_put_body(&stub);
    let entry = body["ReadingStates"][0].clone();
    assert_eq!(entry["StatusInfo"]["Status"], "Reading");
    assert_eq!(entry["StatusInfo"]["LastModified"], "2023-11-14T22:13:20Z");
    assert_eq!(entry["CurrentBookmark"]["ProgressPercent"], 42);
    assert_eq!(
        entry["CurrentBookmark"]["LastModified"],
        "2023-11-14T22:13:20Z"
    );
}

#[tokio::test]
async fn attempt_state_puts_only_status_info_for_a_finish() {
    let stub = spawn_stub(Stub::default()).await;
    let mut device = device_with_reading(Reading {
        status: ReadStatus::Finished,
        status_modified: Some(1_700_000_000),
        bookmark: None,
    });

    attempt_state(&mut device, &stub.endpoint, "book-1", StateSent::Finish)
        .await
        .outcome
        .unwrap();

    let body = state_put_body(&stub);
    let entry = body["ReadingStates"][0].clone();
    assert_eq!(entry["StatusInfo"]["Status"], "Finished");
    assert!(entry.get("CurrentBookmark").is_none());
}

#[tokio::test]
async fn attempt_state_sends_the_kobospan_location_when_given() {
    let stub = spawn_stub(Stub::default()).await;
    let mut device = device_with_reading(Reading {
        status: ReadStatus::Reading,
        status_modified: Some(1_700_000_000),
        bookmark: Some(Bookmark {
            percent: Percent::new(42),
            location: Some(KoboSpan {
                source: "c1.xhtml".into(),
                value: "kobo.2.1".into(),
            }),
            modified: 1_700_000_000,
        }),
    });

    attempt_state(&mut device, &stub.endpoint, "book-1", StateSent::Read)
        .await
        .outcome
        .unwrap();

    let body = state_put_body(&stub);
    let location = body["ReadingStates"][0]["CurrentBookmark"]["Location"].clone();
    assert_eq!(
        location,
        json!({ "Source": "c1.xhtml", "Type": "KoboSpan", "Value": "kobo.2.1" })
    );
}

#[tokio::test]
async fn attempt_state_fails_with_state_put_result_when_a_sub_result_is_not_success() {
    let stub = spawn_stub(Stub {
        state_reply: Some(json!({
            "RequestResult": "Success",
            "UpdateResults": [{
                "StatusInfoResult": { "Result": "Conflict" },
                "CurrentBookmarkResult": { "Result": "Success" },
            }],
        })),
        ..Stub::default()
    })
    .await;
    let mut device = device_with_reading(Reading {
        status: ReadStatus::Finished,
        status_modified: Some(1),
        bookmark: None,
    });

    let attempt = attempt_state(&mut device, &stub.endpoint, "book-1", StateSent::Finish).await;

    match attempt.outcome {
        Err(SyncFailure::Quirk {
            quirk: Quirk::StatePutResult,
            detail,
        }) => {
            assert!(detail.contains("Conflict"), "{detail}");
            assert!(detail.contains("StatusInfoResult"), "{detail}");
        }
        other => panic!("expected Quirk(StatePutResult), got {other:?}"),
    }
}

#[tokio::test]
async fn attempt_state_fails_rejected_when_the_put_answers_500() {
    let stub = spawn_stub(Stub {
        state_status: StatusCode::INTERNAL_SERVER_ERROR,
        ..Stub::default()
    })
    .await;
    let mut device = device_with_reading(Reading {
        status: ReadStatus::Finished,
        status_modified: Some(1),
        bookmark: None,
    });

    let attempt = attempt_state(&mut device, &stub.endpoint, "book-1", StateSent::Finish).await;

    assert!(matches!(attempt.outcome, Err(SyncFailure::Rejected(_))));
}

#[tokio::test]
async fn attempt_state_fails_bad_response_when_the_reply_is_not_a_state_reply() {
    let stub = spawn_stub(Stub {
        state_reply: Some(json!({ "nonsense": true })),
        ..Stub::default()
    })
    .await;
    let mut device = device_with_reading(Reading {
        status: ReadStatus::Finished,
        status_modified: Some(1),
        bookmark: None,
    });

    let attempt = attempt_state(&mut device, &stub.endpoint, "book-1", StateSent::Finish).await;

    assert!(matches!(attempt.outcome, Err(SyncFailure::BadResponse(_))));
}

#[tokio::test]
async fn attempt_state_fails_with_transport_when_the_server_is_unreachable() {
    let mut device = device_with_reading(Reading {
        status: ReadStatus::Finished,
        status_modified: Some(1),
        bookmark: None,
    });

    let attempt = attempt_state(
        &mut device,
        "http://127.0.0.1:1",
        "book-1",
        StateSent::Finish,
    )
    .await;

    assert!(matches!(attempt.outcome, Err(SyncFailure::Transport(_))));
}
