//! Tests for the XPointer↔CFI converter. Literals are worked by hand from the
//! fixtures' markup, never recomputed with the converter's own rules.

use std::path::{Path, PathBuf};

use super::*;
use crate::kobo_position::{book, format_cfi, walk, CfiTail};
use crate::test_support::{build_test_epub, make_test_dir};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../test_data/epubs/generated")
        .join(name)
}

/// Write an EPUB whose spine items are the given `<body>` contents, in order.
fn epub_of(tag: &str, bodies: &[&str]) -> PathBuf {
    let docs: Vec<(String, String)> = bodies
        .iter()
        .enumerate()
        .map(|(i, body)| {
            let xhtml = format!(
                r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>{body}</body></html>"#
            );
            (format!("c{i}.xhtml"), xhtml)
        })
        .collect();
    let spine: Vec<(&str, &str)> = docs.iter().map(|(h, x)| (h.as_str(), x.as_str())).collect();
    let path = make_test_dir(&format!("koreader_position_{tag}")).join("book.epub");
    std::fs::write(&path, build_test_epub(&spine)).unwrap();
    path
}

fn one_chapter(tag: &str, body: &str) -> PathBuf {
    epub_of(tag, &[body])
}

fn to_cfi(epub: &Path, xp: &str) -> Option<String> {
    xpointer_to_cfi(epub, xp).unwrap()
}

fn to_xpointer(epub: &Path, cfi: &str) -> Option<String> {
    cfi_to_xpointer(epub, cfi).unwrap()
}

/// Both directions of one hand-worked pair.
fn assert_pair(epub: &Path, xp: &str, cfi: &str) {
    assert_eq!(to_cfi(epub, xp).as_deref(), Some(cfi), "xpointer {xp}");
    assert_eq!(to_xpointer(epub, cfi).as_deref(), Some(xp), "cfi {cfi}");
}

mod literals {
    use super::*;

    #[test]
    fn converts_a_single_chapter_paragraph_both_ways() {
        assert_pair(
            &fixture("alpha.epub"),
            "/body/DocFragment/body/p/text().10",
            "epubcfi(/6/2!/4/4/1:10)",
        );
    }

    #[test]
    fn converts_the_sixth_spine_item_of_a_multi_item_book_both_ways() {
        assert_pair(
            &fixture("frontmatter-relay.epub"),
            "/body/DocFragment[6]/body/p/text().10",
            "epubcfi(/6/12!/4/4/1:10)",
        );
    }

    #[test]
    fn converts_the_twenty_third_paragraph_of_a_long_chapter_both_ways() {
        assert_pair(
            &fixture("standalone-lagoon.epub"),
            "/body/DocFragment/body/p[23]/text().43",
            "epubcfi(/6/2!/4/48/1:43)",
        );
    }

    #[test]
    fn maps_a_collapsed_whitespace_run_to_its_raw_offset() {
        let epub = one_chapter("collapse", "<p>\n  Hello  world</p>");
        assert_pair(
            &epub,
            "/body/DocFragment/body/p/text().7",
            "epubcfi(/6/2!/4/2/1:10)",
        );
    }

    #[test]
    fn keeps_one_space_of_leading_whitespace() {
        let epub = one_chapter("leading", "<p>\n  Hello</p>");
        assert_pair(
            &epub,
            "/body/DocFragment/body/p/text().1",
            "epubcfi(/6/2!/4/2/1:3)",
        );
    }

    #[test]
    fn round_trips_an_offset_on_a_kept_space() {
        let epub = one_chapter("kept_space", "<p>\n  Hello  world</p>");
        assert_pair(
            &epub,
            "/body/DocFragment/body/p/text().6",
            "epubcfi(/6/2!/4/2/1:8)",
        );
    }

    #[test]
    fn counts_an_astral_character_as_two_utf16_units() {
        let epub = one_chapter("astral", "<p>a\u{1F600}b</p>");
        assert_pair(
            &epub,
            "/body/DocFragment/body/p/text().2",
            "epubcfi(/6/2!/4/2/1:3)",
        );
    }

    #[test]
    fn maps_a_cfi_inside_a_collapsed_run_to_the_runs_kept_space() {
        let epub = one_chapter("inside_run", "<p>\n  Hello  world</p>");
        assert_eq!(
            to_xpointer(&epub, "epubcfi(/6/2!/4/2/1:9)").as_deref(),
            Some("/body/DocFragment/body/p/text().6")
        );
    }

    #[test]
    fn names_the_second_of_several_paragraphs_and_text_nodes_canonically() {
        let epub = one_chapter("canonical", "<p>one</p><p>Hello <em>x</em> tail</p>");
        assert_pair(
            &epub,
            "/body/DocFragment/body/p[2]/text()[2].3",
            "epubcfi(/6/2!/4/4/3:3)",
        );
    }

    #[test]
    fn lowercases_element_names_and_accepts_equivalent_index_spellings() {
        let epub = one_chapter("spellings", "<p>one</p><P>two</P>");
        let cfi = "epubcfi(/6/2!/4/4/1:1)";
        assert_eq!(
            to_cfi(&epub, "/body/DocFragment[1]/body/P[2]/text()[1].1").as_deref(),
            Some(cfi)
        );
        assert_eq!(
            to_xpointer(&epub, cfi).as_deref(),
            Some("/body/DocFragment/body/p[2]/text().1")
        );
    }
}

mod element_pointers {
    use super::*;

    #[test]
    fn lands_on_the_first_visible_character_inside_the_element() {
        let epub = one_chapter("element", "<p><em>Lead</em> rest</p>");
        let cfi = Some("epubcfi(/6/2!/4/2/2/1:0)".to_string());
        assert_eq!(to_cfi(&epub, "/body/DocFragment/body/p"), cfi);
        assert_eq!(to_cfi(&epub, "/body/DocFragment/body/p.0"), cfi);
    }

    #[test]
    fn yields_nothing_for_an_element_without_visible_text() {
        let epub = one_chapter("empty_element", "<p><img src=\"x.png\"/></p><p>text</p>");
        assert_eq!(to_cfi(&epub, "/body/DocFragment/body/p[1]"), None);
    }
}

mod unmappable_xpointers {
    use super::*;

    const LONG_RUN: usize = 2000;

    /// Every case is its own one-chapter book: (case, body, xpointer).
    fn cases() -> Vec<(&'static str, String, &'static str)> {
        let p = "<p>Hello world</p>".to_string();
        vec![
            ("empty string", p.clone(), ""),
            ("id pointer", p.clone(), "#chapter-one"),
            ("v1 numeric steps", p.clone(), "/1/2/1.3"),
            (
                "fragment zero",
                p.clone(),
                "/body/DocFragment[0]/body/p/text().1",
            ),
            (
                "fragment past the spine",
                p.clone(),
                "/body/DocFragment[2]/body/p/text().1",
            ),
            (
                "absent element index",
                p.clone(),
                "/body/DocFragment/body/p[9]/text().1",
            ),
            (
                "zero element index",
                p.clone(),
                "/body/DocFragment/body/p[0]/text().1",
            ),
            (
                "absent text index",
                p.clone(),
                "/body/DocFragment/body/p/text()[2].1",
            ),
            (
                "offset past the text",
                p.clone(),
                "/body/DocFragment/body/p/text().12",
            ),
            (
                "element with an offset",
                p.clone(),
                "/body/DocFragment/body/p.3",
            ),
            (
                "huge element index",
                p.clone(),
                "/body/DocFragment/body/p[99999999999]/text().1",
            ),
            (
                "huge offset",
                p.clone(),
                "/body/DocFragment/body/p/text().99999999999",
            ),
            (
                "trailing junk after the offset",
                p.clone(),
                "/body/DocFragment/body/p/text().3junk",
            ),
            (
                "signed offset",
                p.clone(),
                "/body/DocFragment/body/p/text().+3",
            ),
            (
                "empty step",
                p.clone(),
                "/body/DocFragment/body//p/text().1",
            ),
            (
                "preformatted text",
                "<pre>code here</pre>".into(),
                "/body/DocFragment/body/pre/text().1",
            ),
            (
                "preformatted descendant",
                "<pre><code>code</code></pre>".into(),
                "/body/DocFragment/body/pre/code/text().1",
            ),
            (
                "svg element",
                "<svg><text>x</text></svg>".into(),
                "/body/DocFragment/body/svg/text/text().0",
            ),
            (
                "whitespace-only sibling before the target",
                "<p><em>a</em> <em>b</em> tail</p>".into(),
                "/body/DocFragment/body/p/text()[2].1",
            ),
            (
                "comment inside the run",
                "<p>ab<!--x-->cd</p>".into(),
                "/body/DocFragment/body/p/text().1",
            ),
            (
                "unknown entity in the run",
                "<p>ab&bogus;cd</p>".into(),
                "/body/DocFragment/body/p/text().1",
            ),
            (
                "run too long for one text node",
                format!("<p>{}</p>", "word ".repeat(LONG_RUN)),
                "/body/DocFragment/body/p/text().1",
            ),
        ]
    }

    #[test]
    fn xpointer_to_cfi_yields_nothing_for_unprovable_pointers() {
        let converted: Vec<_> = cases()
            .into_iter()
            .filter(|(_, body, xp)| to_cfi(&one_chapter("unmappable", body), xp).is_some())
            .map(|(case, ..)| case)
            .collect();
        assert!(converted.is_empty(), "converted: {converted:?}");
    }

    #[test]
    fn xpointer_to_cfi_yields_nothing_for_a_bare_fragment_on_a_multi_item_spine() {
        let epub = epub_of("bare_multi", &["<p>one</p>", "<p>two</p>"]);
        assert_eq!(to_cfi(&epub, "/body/DocFragment/body/p/text().1"), None);
    }

    #[test]
    fn xpointer_to_cfi_yields_nothing_for_an_svg_page() {
        let relay = fixture("frontmatter-relay.epub");
        assert_eq!(to_cfi(&relay, "/body/DocFragment[2]/body"), None);
        assert_eq!(to_cfi(&relay, "/body/DocFragment[2]/body/svg"), None);
    }

    #[test]
    fn xpointer_to_cfi_yields_nothing_for_an_image_only_page() {
        let relay = fixture("frontmatter-relay.epub");
        assert_eq!(to_cfi(&relay, "/body/DocFragment[1]/body"), None);
        assert_eq!(to_cfi(&relay, "/body/DocFragment[1]/body/img"), None);
    }
}

mod unmappable_cfis {
    use super::*;

    #[test]
    fn cfi_to_xpointer_yields_nothing_for_unprovable_cfis() {
        let epub = one_chapter("bad_cfi", "<pre>code</pre><p>Hello</p>");
        let cases = [
            ("garbage", "not a cfi"),
            ("range", "epubcfi(/6/2!/4,/2/1:0,/2/1:3)"),
            ("spine item past the end", "epubcfi(/6/4!/4/4/1:1)"),
            ("offset past the text", "epubcfi(/6/2!/4/4/1:6)"),
            ("preformatted text", "epubcfi(/6/2!/4/2/1:1)"),
            ("text node that does not exist", "epubcfi(/6/2!/4/4/3:1)"),
        ];
        let converted: Vec<_> = cases
            .into_iter()
            .filter(|(_, cfi)| to_xpointer(&epub, cfi).is_some())
            .map(|(case, _)| case)
            .collect();
        assert!(converted.is_empty(), "converted: {converted:?}");
    }
}

mod errors {
    use super::*;

    #[test]
    fn both_directions_fail_when_the_epub_does_not_exist() {
        let missing = Path::new("/nonexistent/omnibus/book.epub");
        assert!(xpointer_to_cfi(missing, "/body/DocFragment/body/p/text().1").is_err());
        assert!(cfi_to_xpointer(missing, "epubcfi(/6/2!/4/4/1:1)").is_err());
    }
}

mod fixture_round_trips {
    use super::*;

    /// Whether raw UTF-16 offset `u` sits strictly inside a whitespace run,
    /// where the CFI→XPointer step is deliberately lossy.
    fn inside_run(raw: &str, u: u32) -> bool {
        let units: Vec<u16> = raw.encode_utf16().collect();
        let is_space = |i: usize| matches!(units.get(i), Some(0x20 | 0x09 | 0x0a | 0x0d));
        u > 0 && is_space(u as usize - 1) && is_space(u as usize)
    }

    /// Round-trip count for one EPUB: every cluster, offsets 0, 1, len/2, len-1, len.
    fn round_trips(path: &Path) -> usize {
        let mut doc = book::open_doc(path).unwrap();
        let mut count = 0;
        for spine_index in 0..doc.spine.len() {
            let bytes = book::read_spine_entry(&mut doc, spine_index).unwrap();
            let index = walk::index_file(&bytes).unwrap();
            for cluster in index.clusters() {
                let len = cluster.raw.encode_utf16().count() as u32;
                let mut offsets = vec![0, 1, len / 2, len.saturating_sub(1), len];
                offsets.dedup();
                for offset in offsets
                    .into_iter()
                    .filter(|u| !inside_run(&cluster.raw, *u))
                {
                    let tail = CfiTail {
                        element_steps: cluster.element_steps.clone(),
                        text_index: cluster.text_index,
                        offset_utf16: offset,
                    };
                    let cfi = format_cfi(spine_index, &tail);
                    let Some(xp) = to_xpointer(path, &cfi) else {
                        continue;
                    };
                    assert_eq!(to_cfi(path, &xp), Some(cfi.clone()), "{path:?} {xp}");
                    assert_eq!(to_xpointer(path, &cfi), Some(xp), "{path:?} {cfi}");
                    count += 1;
                }
            }
        }
        count
    }

    #[test]
    fn every_generated_epub_round_trips_between_cfi_and_xpointer() {
        let dir = fixture("alpha.epub").parent().unwrap().to_path_buf();
        let mut seen = 0;
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|e| e == "epub") {
                assert!(round_trips(&path) > 0, "no round trip for {path:?}");
                seen += 1;
            }
        }
        assert!(seen > 20, "only {seen} fixtures found");
    }
}

mod annotation_ranges {
    use super::*;

    fn anchor(start: &str, end: &str) -> (String, String) {
        (start.to_owned(), end.to_owned())
    }

    fn range_cfi(epub: &Path, start: &str, end: &str) -> Option<String> {
        annotation_cfis(epub, &[anchor(start, end)])
            .unwrap()
            .remove(0)
    }

    fn range_xpointers(epub: &Path, cfi: &str) -> Option<(String, String)> {
        annotation_xpointers(epub, &[cfi.to_owned()])
            .unwrap()
            .remove(0)
    }

    /// Both directions of one hand-worked pair.
    fn assert_range_pair(epub: &Path, start: &str, end: &str, cfi: &str) {
        assert_eq!(range_cfi(epub, start, end).as_deref(), Some(cfi));
        assert_eq!(
            range_xpointers(epub, cfi),
            Some((start.to_owned(), end.to_owned()))
        );
    }

    #[test]
    fn converts_a_range_in_a_long_chapter_both_ways() {
        assert_range_pair(
            &fixture("standalone-lagoon.epub"),
            "/body/DocFragment/body/p[23]/text().43",
            "/body/DocFragment/body/p[23]/text().53",
            "epubcfi(/6/2!/4/48,/1:43,/1:53)",
        );
    }

    #[test]
    fn converts_a_range_in_the_sixth_spine_item_both_ways() {
        assert_range_pair(
            &fixture("frontmatter-relay.epub"),
            "/body/DocFragment[6]/body/p/text().10",
            "/body/DocFragment[6]/body/p/text().14",
            "epubcfi(/6/12!/4/4,/1:10,/1:14)",
        );
    }

    #[test]
    fn converts_a_range_across_two_paragraphs_both_ways() {
        let epub = one_chapter("across", "<p>one</p><p>two</p>");
        assert_range_pair(
            &epub,
            "/body/DocFragment/body/p[1]/text().2",
            "/body/DocFragment/body/p[2]/text().3",
            "epubcfi(/6/2!/4,/2/1:2,/4/1:3)",
        );
    }

    #[test]
    fn leaves_a_slot_empty_without_disturbing_the_others_in_the_batch() {
        let epub = one_chapter("batch", "<pre>code</pre><p>one</p><p>two</p>");
        let anchors = [
            anchor(
                "/body/DocFragment/body/p[1]/text().0",
                "/body/DocFragment/body/p[1]/text().3",
            ),
            anchor(
                "/body/DocFragment/body/p[1]/text().0",
                "/body/DocFragment/body/pre/text().2",
            ),
            anchor(
                "/body/DocFragment/body/p[2]/text().1",
                "/body/DocFragment/body/p[2]/text().3",
            ),
        ];
        let cfis = annotation_cfis(&epub, &anchors).unwrap();
        assert_eq!(
            cfis,
            vec![
                Some("epubcfi(/6/2!/4/4,/1:0,/1:3)".to_owned()),
                None,
                Some("epubcfi(/6/2!/4/6,/1:1,/1:3)".to_owned()),
            ]
        );
    }

    #[test]
    fn yields_nothing_when_the_ends_sit_in_different_spine_items() {
        let epub = epub_of("two_items", &["<p>one</p>", "<p>two</p>"]);
        assert_eq!(
            range_cfi(
                &epub,
                "/body/DocFragment[1]/body/p/text().1",
                "/body/DocFragment[2]/body/p/text().1"
            ),
            None
        );
    }

    #[test]
    fn yields_nothing_when_the_end_precedes_the_start() {
        let epub = one_chapter("inverted", "<p>one</p><p>two</p>");
        let later = "/body/DocFragment/body/p[2]/text().1";
        let earlier = "/body/DocFragment/body/p[1]/text().1";
        assert_eq!(range_cfi(&epub, later, earlier), None);
        assert_eq!(
            range_cfi(
                &epub,
                "/body/DocFragment/body/p[1]/text().3",
                "/body/DocFragment/body/p[1]/text().1"
            ),
            None
        );
    }

    #[test]
    fn yields_nothing_for_unparseable_xpointer_ends() {
        let epub = one_chapter("junk_ends", "<p>one</p>");
        let good = "/body/DocFragment/body/p/text().1";
        assert_eq!(range_cfi(&epub, "junk", good), None);
        assert_eq!(range_cfi(&epub, good, ""), None);
    }

    #[test]
    fn annotation_xpointers_yields_nothing_for_points_garbage_and_unprovable_ends() {
        let epub = one_chapter("bad_ranges", "<pre>code</pre><p>Hello</p>");
        let cases = [
            ("point cfi", "epubcfi(/6/2!/4/4/1:1)"),
            ("garbage", "not a cfi"),
            ("preformatted end", "epubcfi(/6/2!/4,/4/1:0,/2/1:2)"),
            ("spine item past the end", "epubcfi(/6/4!/4,/4/1:0,/4/1:2)"),
        ];
        let converted: Vec<_> = cases
            .into_iter()
            .filter(|(_, cfi)| range_xpointers(&epub, cfi).is_some())
            .map(|(case, _)| case)
            .collect();
        assert!(converted.is_empty(), "converted: {converted:?}");
    }

    #[test]
    fn empty_input_yields_empty_output_without_opening_the_file() {
        let missing = Path::new("/nonexistent/omnibus/book.epub");
        assert_eq!(annotation_cfis(missing, &[]).unwrap(), Vec::new());
        assert_eq!(annotation_xpointers(missing, &[]).unwrap(), Vec::new());
    }

    #[test]
    fn both_directions_fail_when_the_epub_does_not_exist() {
        let missing = Path::new("/nonexistent/omnibus/book.epub");
        let anchors = [anchor(
            "/body/DocFragment/body/p/text().1",
            "/body/DocFragment/body/p/text().2",
        )];
        assert!(annotation_cfis(missing, &anchors).is_err());
        assert!(annotation_xpointers(missing, &["epubcfi(/6/2!/4,/2/1:0,/4/1:2)".into()]).is_err());
    }
}
