//! The NZB body and the checks on what an upload names, plus the `/nzb/{id}` route.

use omnibus_shared::ReleaseProtocol;

use crate::test_support::{found, spawn};

use super::*;

#[test]
fn release_id_reads_back_the_id_the_body_carries() {
    let id = "0123456789abcdef0123456789abcdef01234567";

    assert_eq!(release_id(body(id).as_bytes()), Some(id.to_string()));
}

#[test]
fn release_id_is_none_for_bytes_without_the_marker() {
    assert_eq!(release_id(b"<nzb></nzb>"), None);
    assert_eq!(release_id(b"\xff\xfe"), None);
    assert_eq!(release_id(br#"<meta type="name">short</meta>"#), None);
}

#[test]
fn job_name_ok_accepts_omnibus_plus_forty_lowercase_hex_only() {
    let hex = "0123456789abcdef0123456789abcdef01234567";

    assert!(job_name_ok(&format!("omnibus-{hex}")));
    for bad in [
        hex.to_string(),
        format!("omnibus-{}", hex.to_uppercase()),
        format!("omnibus-{hex}0"),
        "omnibus-../../etc".to_string(),
        String::new(),
    ] {
        assert!(!job_name_ok(&bad), "{bad}");
    }
}

#[tokio::test]
async fn nzb_route_serves_the_body_of_a_usenet_release() {
    let mock = spawn().await;
    let release = found(&mock, ReleaseProtocol::Usenet, "EPUB").await;

    let reply = reqwest::get(&release.link).await.unwrap();

    assert!(reply.status().is_success());
    let bytes = reply.bytes().await.unwrap();
    assert_eq!(release_id(&bytes), Some(release.guid));
}

#[tokio::test]
async fn nzb_route_answers_404_for_an_unknown_id_and_for_a_torrent() {
    let mock = spawn().await;
    let torrent = found(&mock, ReleaseProtocol::Torrent, "EPUB").await;

    for id in ["f".repeat(40), torrent.guid] {
        let reply = reqwest::get(format!("{}/nzb/{id}", mock.origin))
            .await
            .unwrap();

        assert_eq!(reply.status(), 404, "{id}");
    }
}
