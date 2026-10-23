//! `Kepub::parse`/`open`/`bookmark` against the committed reader fixture.

use crate::test_support::{READER_EPUB, READER_KEPUB};

use super::*;

#[test]
fn parse_reads_each_spine_chapter_in_order_with_its_opf_relative_href() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();

    let hrefs: Vec<&str> = kepub.chapters.iter().map(|c| c.href.as_str()).collect();
    assert_eq!(hrefs, ["ch1.xhtml", "ch2.xhtml", "ch3.xhtml"]);
}

#[test]
fn parse_extracts_each_kobospan_id_with_its_decoded_text() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();

    let ids: Vec<&str> = kepub.chapters[0]
        .spans
        .iter()
        .map(|s| s.id.as_str())
        .collect();
    assert_eq!(
        ids,
        [
            "kobo.1.1", "kobo.2.1", "kobo.3.1", "kobo.4.1", "kobo.5.1", "kobo.5.2", "kobo.5.3",
            "kobo.6.1", "kobo.7.1"
        ]
    );
    let ampersand = &kepub.chapters[0].spans[3];
    assert_eq!(ampersand.id, "kobo.4.1");
    assert!(ampersand.text.contains('&'));
}

#[test]
fn parse_counts_word_offsets_in_utf16_units_across_accented_and_astral_text() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let ch2 = &kepub.chapters[1];

    let fraktur = ch2
        .words
        .iter()
        .find(|w| w.span == 2 && w.start == 33)
        .expect("the fraktur word in kobo.3.1");
    assert_eq!((fraktur.start, fraktur.end), (33, 45));

    let accented = ch2
        .words
        .iter()
        .find(|w| w.span == 1 && w.text == "naïve")
        .expect("naïve in kobo.2.1");
    assert_eq!((accented.start, accented.end), (22, 27));
}

#[test]
fn parse_returns_no_spans_for_a_plain_epub() {
    let error = Kepub::parse(READER_EPUB).unwrap_err();

    assert_eq!(error, KepubError::NoSpans);
}

#[test]
fn parse_returns_unreadable_for_bytes_that_are_not_a_zip() {
    let error = Kepub::parse(b"not a zip").unwrap_err();

    assert!(matches!(error, KepubError::Unreadable(_)));
}

#[test]
fn open_returns_unreadable_for_a_missing_file() {
    let error = Kepub::open(std::path::Path::new("/no/such/book.kepub.epub")).unwrap_err();

    assert!(matches!(error, KepubError::Unreadable(_)));
}

#[test]
fn bookmark_names_the_chapter_href_and_span_id_at_zero_for_the_first_span() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();

    let (percent, span) = kepub.bookmark(0, 0);

    assert_eq!(u8::from(percent), 0);
    assert_eq!(span.source, "ch1.xhtml");
    assert_eq!(span.value, "kobo.1.1");
}

#[test]
fn bookmark_counts_the_words_before_a_span_in_a_later_chapter() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();

    // ch1 has 50 words; ch2's `kobo.3.1` is its third span (index 2), so
    // every word of ch1 plus ch2's first two spans ("Chapter Two" and the
    // café/naïve/Zürich sentence, 13 words) comes before it: 63 of 80.
    let (percent, span) = kepub.bookmark(1, 2);

    assert_eq!(u8::from(percent), 78);
    assert_eq!(span.source, "ch2.xhtml");
    assert_eq!(span.value, "kobo.3.1");
}
