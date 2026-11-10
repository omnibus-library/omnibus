use omnibus_db::requests::clients::infohash;

use super::*;

fn counter() -> impl FnMut() -> String {
    let mut n = 0;
    move || {
        n += 1;
        format!("{n:040x}")
    }
}

#[test]
fn releases_offers_epub_and_azw3_as_torrent_and_usenet_for_an_ebook() {
    let found = releases("Dracula Bram Stoker", RequestKind::Ebook, counter());

    let shape: Vec<_> = found
        .iter()
        .map(|r| (r.title.as_str(), r.protocol))
        .collect();
    assert_eq!(
        shape,
        [
            ("Dracula Bram Stoker EPUB", ReleaseProtocol::Torrent),
            ("Dracula Bram Stoker EPUB", ReleaseProtocol::Usenet),
            ("Dracula Bram Stoker AZW3", ReleaseProtocol::Torrent),
            ("Dracula Bram Stoker AZW3", ReleaseProtocol::Usenet),
        ]
    );
}

#[test]
fn releases_offers_one_m4b_per_protocol_for_an_audiobook() {
    let found = releases("Dracula", RequestKind::Audiobook, counter());

    assert_eq!(found.len(), 2);
    assert!(found
        .iter()
        .all(|r| r.format == Format::M4b && r.category() == 3030));
}

#[test]
fn link_is_a_magnet_carrying_the_release_id_for_a_torrent() {
    let found = releases("Dracula & Co", RequestKind::Ebook, counter());

    let magnet = found[0].link("http://127.0.0.1:1");

    assert_eq!(infohash::from_magnet(&magnet).unwrap(), found[0].id);
}

#[test]
fn link_is_the_mocks_nzb_address_for_usenet() {
    let found = releases("Dracula", RequestKind::Ebook, counter());

    assert_eq!(
        found[1].link("http://127.0.0.1:9"),
        format!("http://127.0.0.1:9/nzb/{}", found[1].id)
    );
}

#[test]
fn kind_for_category_maps_the_two_book_categories_only() {
    assert_eq!(kind_for_category("7020"), Some(RequestKind::Ebook));
    assert_eq!(kind_for_category("3030"), Some(RequestKind::Audiobook));
    assert_eq!(kind_for_category("2000"), None);
}

fn write(dir: &Path, rel: &str) {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, b"x").unwrap();
}

#[test]
fn find_returns_alpha_epub_and_the_first_m4b() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "epubs/generated/alpha.epub");
    write(dir.path(), "audiobooks/public_domain/b/two.m4b");
    write(dir.path(), "audiobooks/public_domain/a/one.m4b");

    let payloads = Payloads::find(dir.path()).unwrap();

    assert!(payloads.epub.ends_with("epubs/generated/alpha.epub"));
    assert!(payloads.m4b.ends_with("a/one.m4b"));
}

#[test]
fn find_names_just_fixtures_when_the_audiobook_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "epubs/generated/alpha.epub");

    let err = Payloads::find(dir.path()).unwrap_err();

    assert!(matches!(err, PayloadError::Missing(_)));
    assert!(err.to_string().contains("just fixtures"), "{err}");
}

#[test]
fn find_names_just_fixtures_when_the_epub_is_missing() {
    let dir = tempfile::tempdir().unwrap();

    let err = Payloads::find(dir.path()).unwrap_err();

    assert!(err.to_string().contains("just fixtures"), "{err}");
}
