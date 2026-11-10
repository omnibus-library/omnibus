use omnibus_shared::{ReleaseProtocol, RequestKind};

use crate::catalogue::Format;

use super::*;

#[test]
fn mint_gives_unique_forty_hex_ids() {
    let mut store = Store::default();

    let (a, b) = (store.mint(), store.mint());

    assert_ne!(a, b);
    for id in [a, b] {
        assert_eq!(id.len(), 40);
        assert!(
            id.bytes().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f')),
            "{id}"
        );
    }
}

#[test]
fn release_finds_what_remember_kept() {
    let mut store = Store::default();
    let id = store.mint();
    store.remember(Release {
        id: id.clone(),
        title: "Dracula EPUB".into(),
        kind: RequestKind::Ebook,
        format: Format::Epub,
        protocol: ReleaseProtocol::Torrent,
    });

    assert_eq!(
        store.release(&id).map(|r| r.title.as_str()),
        Some("Dracula EPUB")
    );
    assert!(store.release("nope").is_none());
}
