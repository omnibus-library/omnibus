//! Unit tests for CFI → chapter resolution: the spine step, and a
//! position placed among the anchors of chapters sharing a spine item.

use super::*;

#[test]
fn cfi_spine_ordinal_halves_the_even_package_step() {
    assert_eq!(cfi_spine_ordinal("epubcfi(/6/14[chap3]!/4/2/1:0)"), Some(7));
    assert_eq!(cfi_spine_ordinal("epubcfi(/6/2!/4)"), Some(1));
}

#[test]
fn cfi_spine_ordinal_rejects_non_element_and_malformed_steps() {
    assert_eq!(cfi_spine_ordinal("epubcfi(/6/13!/4)"), None); // odd step
    assert_eq!(cfi_spine_ordinal("epubcfi(/6/0!/4)"), None); // zero
    assert_eq!(cfi_spine_ordinal("not-a-cfi"), None);
}

fn chapter(spine_index: i64, anchor_path: Option<&str>) -> AlignmentEbookChapter {
    AlignmentEbookChapter {
        title: String::new(),
        percent: 0.0,
        spine_index,
        anchor_path: anchor_path.map(str::to_string),
    }
}

fn spines(indices: &[i64]) -> Vec<AlignmentEbookChapter> {
    indices.iter().map(|&s| chapter(s, None)).collect()
}

#[test]
fn chapter_index_for_cfi_picks_the_chapter_by_spine_not_percent() {
    // Three chapters starting in spine items 2, 4 and 6 (0-based). A CFI in
    // spine item 4 (package step 10 → ordinal 5 → 0-based 4) resolves to the
    // chapter that *starts* at spine 4 — the middle one — regardless of how
    // close the whole-book percents of the neighbours round.
    let chapters = spines(&[2, 4, 6]);
    assert_eq!(
        chapter_index_for_cfi(&chapters, "epubcfi(/6/10!/4/2:0)"),
        Some(1)
    );
    // A CFI past the last chapter's spine stays on the last chapter.
    assert_eq!(
        chapter_index_for_cfi(&chapters, "epubcfi(/6/20!/4)"),
        Some(2)
    );
    // A CFI before the first chapter's spine resolves to nothing (the
    // caller keeps the percent fallback / chapter 1).
    assert_eq!(chapter_index_for_cfi(&chapters, "epubcfi(/6/2!/4)"), None);
}

#[test]
fn chapter_index_for_cfi_places_a_position_among_anchors_sharing_a_spine_item() {
    // Front matter opens spine item 3; chapters one and two follow inside
    // it at `/4/32` and `/4/68`, and chapter three has item 5 to itself.
    let chapters = vec![
        chapter(0, None),
        chapter(3, None),
        chapter(3, Some("/4/32")),
        chapter(3, Some("/4/68")),
        chapter(5, None),
    ];
    let at = |cfi: &str| chapter_index_for_cfi(&chapters, cfi);
    // Ahead of chapter one's anchor: the front matter.
    assert_eq!(at("epubcfi(/6/8!/4/24/1:0)"), Some(1));
    // The anchor itself, then text inside and after it: chapter one.
    assert_eq!(at("epubcfi(/6/8!/4/32)"), Some(2));
    assert_eq!(at("epubcfi(/6/8!/4/32/1:4)"), Some(2));
    assert_eq!(at("epubcfi(/6/8[item4]!/4/50/1:120)"), Some(2));
    // A highlight's range starts where its parent path and first part say.
    assert_eq!(at("epubcfi(/6/8!/4/50,/1:0,/1:20)"), Some(2));
    // Past chapter two's anchor, to the end of the item.
    assert_eq!(at("epubcfi(/6/8!/4/68/1:0)"), Some(3));
    assert_eq!(at("epubcfi(/6/8!/4/300/3:9)"), Some(3));
    // The next item is its own chapter.
    assert_eq!(at("epubcfi(/6/12!/4/2/1:0)"), Some(4));
}

#[test]
fn chapter_index_for_cfi_opens_a_shared_item_on_its_first_chapter_ahead_of_every_anchor() {
    let chapters = vec![chapter(3, Some("/4/32")), chapter(3, Some("/4/68"))];
    assert_eq!(
        chapter_index_for_cfi(&chapters, "epubcfi(/6/8!/4/2/1:0)"),
        Some(0)
    );
}

#[test]
fn chapter_index_for_cfi_names_the_last_of_a_shared_item_without_recorded_anchors() {
    // Structure extracted before anchors were recorded can't place the
    // position inside the item, and keeps naming its last chapter.
    let chapters = spines(&[0, 3, 3, 5]);
    assert_eq!(
        chapter_index_for_cfi(&chapters, "epubcfi(/6/8!/4)"),
        Some(2)
    );
}
