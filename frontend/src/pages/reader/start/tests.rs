//! `reader_start`: which saved position the reader opens at, and when its
//! first landing is held back from being written over the stored percent.

use omnibus_shared::ProgressFormat;

use super::*;

const STORED: &str = "epubcfi(/6/14!/4/2/1:0)";
const DERIVED: &str = "epubcfi(/6/36!/4/2/1:212)";
const LOCAL: &str = "epubcfi(/6/8!/4/2/1:0)";
const LINK: &str = "epubcfi(/6/20!/4/10/1:4)";

/// An epub row as the server reads it back: `epub_cfi` is what the last
/// accepted write stored, `derived_epub_cfi` what the read placed for it.
fn row(epub_cfi: Option<&str>, percent: Option<i64>, derived: Option<&str>) -> ProgressRecord {
    ProgressRecord {
        book_uuid: "book".to_string(),
        format: ProgressFormat::Epub,
        epub_cfi: epub_cfi.map(str::to_string),
        audio_position_seconds: None,
        progress_percent: percent,
        kobo_location: None,
        book_file_id: None,
        updated_at: 1_000,
        client_updated_at: 1_000,
        total_duration_seconds: None,
        resolved: None,
        derived_epub_cfi: derived.map(str::to_string),
    }
}

fn start_at(cfi: &str) -> ReaderStart {
    ReaderStart {
        cfi: Some(cfi.to_string()),
        hold_first_write: false,
    }
}

#[test]
fn reader_start_opens_a_deep_link_over_every_saved_position() {
    let stored = row(Some(STORED), Some(30), None);
    let start = reader_start(
        Some(LINK.to_string()),
        Some(&stored),
        Some(LOCAL.to_string()),
    );
    assert_eq!(start, start_at(LINK));
}

#[test]
fn reader_start_restores_the_servers_own_cfi_over_the_local_save() {
    let stored = row(Some(STORED), Some(30), None);
    assert_eq!(
        reader_start(None, Some(&stored), Some(LOCAL.to_string())),
        start_at(STORED)
    );
}

#[test]
fn reader_start_opens_a_percent_only_row_at_its_derived_cfi_rather_than_the_local_save() {
    // The #2446 shape: a Kobo wrote 42% with no CFI. That row is newer than
    // anything this browser posted, so the older local save must not win —
    // and the cover must not be where it opens.
    let kobo = row(None, Some(42), Some(DERIVED));
    assert_eq!(
        reader_start(None, Some(&kobo), Some(LOCAL.to_string())),
        start_at(DERIVED)
    );
}

#[test]
fn reader_start_holds_the_first_write_when_a_percent_only_row_cannot_be_placed() {
    // No derived CFI (the book has no measured structure) and nothing saved
    // locally: the reader opens at the start, and that landing must not be
    // written over the stored 42%.
    let kobo = row(None, Some(42), None);
    assert_eq!(
        reader_start(None, Some(&kobo), None),
        ReaderStart {
            cfi: None,
            hold_first_write: true,
        }
    );
}

#[test]
fn reader_start_restores_the_local_save_without_a_hold_when_a_percent_only_row_cannot_be_placed() {
    // The local save is a CFI restore, so its landing is echo-tagged and never
    // written; a hold on top would swallow the reader's first real page turn.
    let kobo = row(None, Some(42), None);
    assert_eq!(
        reader_start(None, Some(&kobo), Some(LOCAL.to_string())),
        start_at(LOCAL)
    );
}

#[test]
fn reader_start_never_hands_epub_js_a_pdf_page_anchor() {
    // A mixed EPUB+PDF book shares one row; the PDF reader's anchor is not a
    // CFI. The local save is the only placeable position left.
    let pdf = row(Some("pdf-page:12"), Some(40), None);
    assert_eq!(
        reader_start(None, Some(&pdf), Some(LOCAL.to_string())),
        start_at(LOCAL)
    );
    // With nothing local, it opens at the start without writing it over the
    // PDF reader's position.
    assert!(reader_start(None, Some(&pdf), None).hold_first_write);
}

#[test]
fn reader_start_writes_the_first_landing_of_a_book_with_no_position_further_in() {
    // A book never opened, or one stored at 0%: the start *is* the position,
    // so opening it records it as it always has.
    let fresh = reader_start(None, None, None);
    assert_eq!(
        fresh,
        ReaderStart {
            cfi: None,
            hold_first_write: false,
        }
    );
    let at_zero = row(None, Some(0), None);
    assert!(!reader_start(None, Some(&at_zero), None).hold_first_write);
}
