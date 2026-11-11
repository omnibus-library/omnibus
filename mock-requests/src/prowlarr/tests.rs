//! Contract tests: the server's own Prowlarr client and ranker against the fake.

use omnibus_db::requests::clients::infohash;
use omnibus_db::requests::prowlarr::{Prowlarr, ProwlarrRelease};
use omnibus_db::requests::rank::rank;
use omnibus_db::requests::ConnectionError;
use omnibus_shared::{ReleaseProtocol, RequestKind};

use crate::test_support::{spawn, Running};
use crate::PROWLARR_API_KEY;

const QUERY: &str = "Dracula Bram Stoker";

fn client(mock: &Running) -> Prowlarr {
    Prowlarr::new(&mock.origin, PROWLARR_API_KEY).unwrap()
}

async fn search(mock: &Running, kind: RequestKind) -> Vec<ProwlarrRelease> {
    client(mock).search(QUERY, kind).await.unwrap()
}

fn kept_titles(
    releases: Vec<ProwlarrRelease>,
    kind: RequestKind,
    protocol: ReleaseProtocol,
    convertible: bool,
) -> Vec<String> {
    rank(
        releases,
        "Dracula",
        "Bram Stoker",
        kind,
        protocol,
        convertible,
    )
    .into_iter()
    .filter(|r| !r.rejected)
    .map(|r| format!("{} {:?}", r.release.title, r.release.protocol.unwrap()))
    .collect()
}

#[tokio::test]
async fn test_succeeds_with_the_mocks_key() {
    let mock = spawn().await;

    client(&mock).test().await.unwrap();
}

#[tokio::test]
async fn test_rejects_another_key_as_a_bad_api_key() {
    let mock = spawn().await;

    let err = Prowlarr::new(&mock.origin, "other")
        .unwrap()
        .test()
        .await
        .unwrap_err();

    assert!(matches!(err, ConnectionError::BadApiKey), "{err:?}");
}

#[tokio::test]
async fn indexer_status_lists_no_failing_indexer() {
    let mock = spawn().await;

    assert!(client(&mock).indexer_status().await.unwrap().is_empty());
}

#[tokio::test]
async fn search_returns_epub_and_azw3_as_torrent_and_usenet_for_an_ebook() {
    let mock = spawn().await;

    let found = search(&mock, RequestKind::Ebook).await;

    let shape: Vec<_> = found
        .iter()
        .map(|r| (r.title.as_str(), r.protocol))
        .collect();
    assert_eq!(
        shape,
        [
            ("Dracula Bram Stoker EPUB", Some(ReleaseProtocol::Torrent)),
            ("Dracula Bram Stoker EPUB", Some(ReleaseProtocol::Usenet)),
            ("Dracula Bram Stoker AZW3", Some(ReleaseProtocol::Torrent)),
            ("Dracula Bram Stoker AZW3", Some(ReleaseProtocol::Usenet)),
        ]
    );
}

#[tokio::test]
async fn search_returns_two_m4b_releases_for_an_audiobook() {
    let mock = spawn().await;

    let found = search(&mock, RequestKind::Audiobook).await;

    assert_eq!(found.len(), 2);
    assert!(found.iter().all(|r| r.title.ends_with("M4B")));
}

#[tokio::test]
async fn search_links_a_torrent_by_magnet_and_usenet_by_the_mocks_nzb_address() {
    let mock = spawn().await;

    let found = search(&mock, RequestKind::Ebook).await;

    let hash = infohash::from_magnet(&found[0].link).unwrap();
    assert_eq!(hash.len(), 40);
    assert_eq!(
        found[1].link,
        format!("{}/nzb/{}", mock.origin, found[1].guid)
    );
}

#[tokio::test]
async fn rank_keeps_the_torrent_epub_and_rejects_azw3_without_a_converter() {
    let mock = spawn().await;

    let kept = kept_titles(
        search(&mock, RequestKind::Ebook).await,
        RequestKind::Ebook,
        ReleaseProtocol::Torrent,
        false,
    );

    assert_eq!(kept, ["Dracula Bram Stoker EPUB Torrent"]);
}

#[tokio::test]
async fn rank_keeps_the_azw3_too_when_it_can_be_converted() {
    let mock = spawn().await;

    let kept = kept_titles(
        search(&mock, RequestKind::Ebook).await,
        RequestKind::Ebook,
        ReleaseProtocol::Torrent,
        true,
    );

    assert_eq!(
        kept,
        [
            "Dracula Bram Stoker EPUB Torrent",
            "Dracula Bram Stoker AZW3 Torrent"
        ]
    );
}

#[tokio::test]
async fn rank_keeps_the_usenet_epub_for_a_usenet_client() {
    let mock = spawn().await;

    let kept = kept_titles(
        search(&mock, RequestKind::Ebook).await,
        RequestKind::Ebook,
        ReleaseProtocol::Usenet,
        false,
    );

    assert_eq!(kept, ["Dracula Bram Stoker EPUB Usenet"]);
}

#[tokio::test]
async fn rank_keeps_the_m4b_of_the_clients_protocol() {
    let mock = spawn().await;
    for protocol in [ReleaseProtocol::Torrent, ReleaseProtocol::Usenet] {
        let found = search(&mock, RequestKind::Audiobook).await;

        let kept = kept_titles(found, RequestKind::Audiobook, protocol, false);

        assert_eq!(kept, [format!("Dracula Bram Stoker M4B {protocol:?}")]);
    }
}

#[tokio::test]
async fn search_gives_nothing_for_a_category_it_does_not_stock() {
    let mock = spawn().await;

    let body = reqwest::Client::new()
        .get(format!("{}/api/v1/search", mock.origin))
        .header("x-api-key", PROWLARR_API_KEY)
        .query(&[("query", QUERY), ("categories", "2000")])
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();

    assert_eq!(body, "[]");
}
