//! Upload helper tests: the extension-keyed multipart MIME types and the review diff's wire encoding.

use super::*;

#[test]
fn ebook_mime_types_a_pdf_by_extension_and_defaults_to_epub() {
    assert_eq!(ebook_mime("Book.PDF"), "application/pdf");
    assert_eq!(ebook_mime("book.epub"), "application/epub+zip");
    assert_eq!(ebook_mime("book"), "application/epub+zip");
}

#[test]
fn audio_mime_maps_mp3_and_the_mp4_family_and_falls_back_to_octet_stream() {
    assert_eq!(audio_mime("a.MP3"), "audio/mpeg");
    for name in ["a.m4a", "a.m4b", "a.mp4"] {
        assert_eq!(audio_mime(name), "audio/mp4", "{name}");
    }
    assert_eq!(audio_mime("a.ogg"), "application/octet-stream");
}

#[test]
fn overrides_json_leaves_an_absent_or_empty_diff_off_the_wire() {
    assert_eq!(overrides_json(&None).expect("encodes"), None);
    assert_eq!(
        overrides_json(&Some(MetadataOverrides::default())).expect("encodes"),
        None
    );
}

#[test]
fn overrides_json_encodes_a_real_diff() {
    let diff = MetadataOverrides {
        title: Some("Dune".into()),
        ..Default::default()
    };

    let json = overrides_json(&Some(diff.clone()))
        .expect("encodes")
        .expect("a real diff goes on the wire");

    assert_eq!(
        serde_json::from_str::<MetadataOverrides>(&json).expect("round-trips"),
        diff
    );
}
