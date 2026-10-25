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
fn read_entry_refuses_an_entry_that_decompresses_past_the_byte_cap() {
    // Zip-bomb-style fixture: `huge.bin` decompresses to one byte past the
    // per-entry read cap (test builds use a much smaller `ENTRY_LIMIT` than
    // production, so this regression stays fast), but — being all zeros —
    // deflates to a few bytes, the "small compressed, huge decompressed"
    // shape a hostile server reply could exploit.
    const OVER_CAP: u64 = ENTRY_LIMIT + 1;
    let mut buf = Vec::new();
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
    writer
        .start_file(
            "huge.bin",
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .unwrap();
    std::io::copy(&mut std::io::repeat(0).take(OVER_CAP), &mut writer).unwrap();
    writer.finish().unwrap();
    let mut archive = zip::ZipArchive::new(Cursor::new(buf.as_slice())).unwrap();

    let error = read_entry(&mut archive, "huge.bin").unwrap_err();

    let KepubError::Unreadable(message) = error else {
        panic!("expected Unreadable, got {error:?}");
    };
    assert!(message.contains("byte cap"), "{message}");
}

/// A chapter body with one word, enough for `words_in` to keep the chapter.
const ONE_WORD_CHAPTER: &str = r#"<?xml version="1.0"?><html><body><span class="koboSpan" id="kobo.1.1">Hello.</span></body></html>"#;

#[test]
fn parse_resolves_a_dot_relative_href() {
    let zip = crate::test_support::minimal_kepub_zip_with_href(
        "./ch1.xhtml",
        "ch1.xhtml",
        ONE_WORD_CHAPTER,
    );

    let kepub = Kepub::parse(&zip).unwrap();

    assert_eq!(
        kepub.chapters[0].href, "./ch1.xhtml",
        "the chapter's own identity stays the raw manifest href"
    );
}

#[test]
fn parse_resolves_a_parent_relative_href() {
    let zip = crate::test_support::minimal_kepub_zip_with_href(
        "../Text/ch1.xhtml",
        "Text/ch1.xhtml",
        ONE_WORD_CHAPTER,
    );

    let kepub = Kepub::parse(&zip).unwrap();

    assert_eq!(kepub.chapters[0].href, "../Text/ch1.xhtml");
}

#[test]
fn parse_resolves_a_percent_encoded_href() {
    let zip = crate::test_support::minimal_kepub_zip_with_href(
        "My%20Chapter.xhtml",
        "My Chapter.xhtml",
        ONE_WORD_CHAPTER,
    );

    let kepub = Kepub::parse(&zip).unwrap();

    assert_eq!(kepub.chapters[0].href, "My%20Chapter.xhtml");
}

#[test]
fn find_passage_matches_words_glued_across_an_inline_elements_span_split() {
    let xhtml = r#"<?xml version="1.0"?><html><body><p>
        <span class="koboSpan" id="kobo.1.1">said </span>
        <em><span class="koboSpan" id="kobo.1.2">never</span></em>
        <span class="koboSpan" id="kobo.1.3">.</span>
    </p></body></html>"#;
    let kepub = Kepub::parse(&crate::test_support::minimal_kepub_zip(xhtml)).unwrap();
    let words = &kepub.chapters[0].words;
    assert_eq!(words.len(), 3, "{words:?}");
    assert!(!words[1].glued, "\"never\" follows a real space");
    assert!(
        words[2].glued,
        "\".\" directly continues \"never\" with no space"
    );

    let found = kepub.find_passage("said never.");

    assert_eq!(found, Some((0, 0..=2)));
}

#[test]
fn locate_span_finds_the_chapter_and_span_of_a_kobospan() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();

    let found = kepub.locate_span("ch2.xhtml", "kobo.3.1");

    assert_eq!(found, Some((1, 2)));
}

#[test]
fn locate_span_returns_none_for_a_span_the_book_lacks() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();

    assert_eq!(kepub.locate_span("ch2.xhtml", "kobo.9.9"), None);
    assert_eq!(kepub.locate_span("ch9.xhtml", "kobo.1.1"), None);
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
fn word_at_percent_finds_the_word_whose_position_matches_the_target_percent() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();

    // 80 words total; 55% rounds up to word 44, still inside ch1 (0-49).
    let (chapter, word) = kepub.word_at_percent(Percent::new(55).unwrap());

    assert_eq!((chapter, word), (0, 44));
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

#[test]
fn highlight_carries_utf16_offsets_over_astral_and_accented_words() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let ch2 = &kepub.chapters[1];
    // "naïve" (word 7) through "Zürich." (word 12), both inside kobo.2.1.
    let highlight = ch2.highlight(7..=12, crate::annotations::Swatch::Pink, None);

    assert_eq!(highlight.text, "naïve and still, far from Zürich.");
    let location = highlight.location.unwrap();
    assert_eq!(location.start_span, "kobo.2.1");
    assert_eq!(location.start_char, 22);
    assert_eq!(location.end_span, "kobo.2.1");
    assert_eq!(location.end_char, 55);
}

#[test]
fn highlight_carries_utf16_offsets_over_an_astral_fraktur_word() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let ch2 = &kepub.chapters[1];
    // "ridge" (word 17) through the astral Fraktur "𝔨𝔞𝔦𝔫𝔞𝔦" (word 18, 6
    // characters each outside the BMP — 2 UTF-16 units apiece), both
    // inside kobo.3.1: "Travelers called that cold ridge 𝔨𝔞𝔦𝔫𝔞𝔦 in old maps."
    let highlight = ch2.highlight(17..=18, crate::annotations::Swatch::Green, None);

    assert_eq!(highlight.text, "ridge 𝔨𝔞𝔦𝔫𝔞𝔦");
    let location = highlight.location.unwrap();
    assert_eq!(location.start_span, "kobo.3.1");
    assert_eq!(location.start_char, 27);
    assert_eq!(location.end_span, "kobo.3.1");
    assert_eq!(location.end_char, 45);
}

#[test]
fn highlight_inserts_a_space_between_spans_of_different_paragraphs() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let ch1 = &kepub.chapters[0];
    // "dawn." (kobo.2.1, last word of its paragraph) through "Paul"
    // (kobo.3.1, first word of the next) — the book's own markup puts no
    // space between the two spans' text.
    let highlight = ch1.highlight(7..=8, crate::annotations::Swatch::Yellow, None);

    assert_eq!(highlight.text, "dawn. Paul");
}

#[test]
fn highlight_crosses_spans_with_the_books_own_spacing() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let ch1 = &kepub.chapters[0];
    // "feet," (kobo.5.1) through "silent." (kobo.5.3), crossing the
    // <em>-split paragraph's three spans.
    let highlight = ch1.highlight(
        32..=34,
        crate::annotations::Swatch::Blue,
        Some("note".into()),
    );

    assert_eq!(highlight.text, "feet, utterly silent.");
    assert_eq!(highlight.note, Some("note".to_owned()));
    let location = highlight.location.unwrap();
    assert_eq!(location.start_span, "kobo.5.1");
    assert_eq!(location.start_char, 38);
    assert_eq!(location.end_span, "kobo.5.3");
    assert_eq!(location.end_char, 8);
}

#[test]
fn covered_words_returns_the_words_a_range_overlaps() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let ch2 = &kepub.chapters[1];
    // "naïve" through "Zürich." (words 7-12); start_char cut mid-"naïve"
    // (22..27) still covers the whole word.
    let range = crate::annotations::SpanRange {
        chapter: "ch2.xhtml".into(),
        start_span: "kobo.2.1".into(),
        start_char: 24,
        end_span: "kobo.2.1".into(),
        end_char: 55,
    };

    assert_eq!(ch2.covered_words(&range), Some(7..=12));
}

#[test]
fn covered_words_returns_none_for_another_chapter() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let ch2 = &kepub.chapters[1];
    let range = crate::annotations::SpanRange {
        chapter: "ch1.xhtml".into(),
        start_span: "kobo.2.1".into(),
        start_char: 0,
        end_span: "kobo.2.1".into(),
        end_char: 1,
    };

    assert_eq!(ch2.covered_words(&range), None);
}

#[test]
fn find_passage_returns_the_first_whole_word_run() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();

    let found = kepub.find_passage("Paul and Jessica walked");

    assert_eq!(found, Some((0, 8..=11)));
}

#[test]
fn find_passage_returns_none_for_a_partial_word() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();

    assert_eq!(kepub.find_passage("Paul and Jessic"), None);
}

#[test]
fn find_passage_returns_none_across_a_chapter_boundary() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();

    // "light." is ch1's last word; "Chapter" is ch2's first — never adjacent
    // within one chapter's word list.
    assert_eq!(kepub.find_passage("light. Chapter"), None);
}
