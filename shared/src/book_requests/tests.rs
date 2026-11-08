use crate::metadata_lookup::MetadataProvider;

use super::*;

#[test]
fn request_state_and_stuck_reason_round_trip_their_tokens() {
    assert_eq!(RequestState::from_db("ready"), Some(RequestState::Ready));
    assert_eq!(RequestState::Ready.as_str(), "ready");
    assert_eq!(
        StuckReason::from_db("couldnt_add"),
        Some(StuckReason::CouldntAdd)
    );
    assert_eq!(StuckReason::CouldntAdd.as_str(), "couldnt_add");
}

fn start_from(kind: RequestKind, title: &str) -> StartRequestFromMeta {
    StartRequestFromMeta {
        kind,
        meta: ExternalBookMeta {
            isbn13: "9781635575637".into(),
            title: title.into(),
            authors: vec!["Susanna Clarke".into()],
            year: None,
            pages: None,
            publisher: None,
            description: None,
            cover_url: None,
            series: None,
            first_publish_year: None,
            format: None,
            source: MetadataProvider::OpenLibrary,
        },
    }
}

#[test]
fn start_request_from_meta_accepts_an_ebook_of_a_small_record() {
    assert_eq!(
        start_from(RequestKind::Ebook, "Piranesi").validate(),
        Ok(())
    );
}

#[test]
fn start_request_from_meta_rejects_a_field_of_meta_over_its_cap() {
    let long = "x".repeat(ExternalBookMeta::TITLE_MAX_LEN + 1);
    assert_eq!(
        start_from(RequestKind::Ebook, &long).validate(),
        Err("title exceeds 500 characters".into())
    );
}

#[test]
fn start_request_from_meta_accepts_an_audiobook() {
    assert_eq!(
        start_from(RequestKind::Audiobook, "Piranesi").validate(),
        Ok(())
    );
}

#[test]
fn release_protocol_round_trips_its_tokens_and_knows_no_other() {
    assert_eq!(
        ReleaseProtocol::parse("usenet"),
        Some(ReleaseProtocol::Usenet)
    );
    assert_eq!(ReleaseProtocol::Torrent.as_str(), "torrent");
    assert_eq!(ReleaseProtocol::parse("unknown"), None);
}
