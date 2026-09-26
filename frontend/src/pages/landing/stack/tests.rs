//! Unit tests for the stack's pure derivations: the per-point display facts
//! the fan and the edge ribbon both read, and the page accent the lead book
//! hands to the whole surface.

use omnibus_shared::{Contributor, EbookMetadata, ProgressFormat, ProgressRecord, ResumePoint};

use super::*;

/// `stack_entries` with an empty cache-bust map — every test here is about
/// the derivation, not about cover URLs.
fn stack_entries_for_test(points: &[ResumePoint], server_url: &str) -> Vec<StackEntry> {
    stack_entries(points, server_url, &std::collections::HashMap::new())
}

fn book(uuid: &str, title: &str, accent: Option<&str>, formats: &[&str]) -> EbookMetadata {
    EbookMetadata {
        unique_identifier: Some(uuid.to_string()),
        title: Some(title.to_string()),
        creators: vec![Contributor {
            name: "Susanna Clarke".to_string(),
            ..Default::default()
        }],
        accent: accent.map(str::to_string),
        formats: formats.iter().map(|f| (*f).to_string()).collect(),
        ..Default::default()
    }
}

fn point(uuid: &str, format: ProgressFormat, pct: Option<i64>) -> ResumePoint {
    ResumePoint {
        record: ProgressRecord {
            book_uuid: uuid.to_string(),
            format,
            epub_cfi: None,
            audio_position_seconds: Some(600.0),
            progress_percent: pct,
            kobo_location: None,
            book_file_id: None,
            updated_at: 0,
            client_updated_at: 0,
            total_duration_seconds: Some(3600.0),
            resolved: None,
            derived_epub_cfi: None,
        },
        book: book(uuid, "Piranesi", Some("oklch(0.7 0.1 200)"), &["epub"]),
        linked: false,
        cross_format: None,
        audio_part: None,
        audio_part_count: None,
        playback_rate: None,
    }
}

#[test]
fn stack_entries_prefix_the_position_line_with_the_format_being_resumed() {
    let epub = &stack_entries_for_test(&[point("a", ProgressFormat::Epub, Some(55))], "")[0];
    assert!(
        epub.where_line.starts_with("Ebook \u{00b7} "),
        "got {}",
        epub.where_line
    );

    let audio = &stack_entries_for_test(&[point("b", ProgressFormat::Audio, None)], "")[0];
    assert!(
        audio.where_line.starts_with("Audiobook \u{00b7} "),
        "got {}",
        audio.where_line
    );
}

#[test]
fn stack_entries_label_the_veil_with_the_formats_verb_and_the_percent() {
    let epub = &stack_entries_for_test(&[point("a", ProgressFormat::Epub, Some(55))], "")[0];
    assert_eq!(epub.veil_label, "resume \u{00b7} 55%");

    // Audio derives its percent from the position/duration pair.
    let audio = &stack_entries_for_test(&[point("b", ProgressFormat::Audio, None)], "")[0];
    assert_eq!(audio.veil_label, "play \u{00b7} 17%");
}

#[test]
fn stack_entries_fall_back_to_a_bare_verb_when_no_percent_is_known() {
    let mut p = point("a", ProgressFormat::Epub, None);
    p.record.progress_percent = None;
    let entry = &stack_entries_for_test(&[p], "")[0];
    assert_eq!(entry.veil_label, "resume");
    assert_eq!(entry.pct, None);
}

#[test]
fn stack_entries_mark_dual_format_books_linked_or_unlinked_but_never_both() {
    let mut unlinked = point("a", ProgressFormat::Epub, Some(10));
    unlinked.book = book("a", "Piranesi", None, &["epub", "m4b"]);
    let entry = &stack_entries_for_test(&[unlinked.clone()], "")[0];
    assert!(entry.dual_unlinked && !entry.dual_linked);

    let mut linked = unlinked;
    linked.linked = true;
    let entry = &stack_entries_for_test(&[linked], "")[0];
    assert!(entry.dual_linked && !entry.dual_unlinked);

    // A single-format book is neither, so it grows no cross-format chips.
    let entry = &stack_entries_for_test(&[point("c", ProgressFormat::Epub, Some(10))], "")[0];
    assert!(!entry.dual_linked && !entry.dual_unlinked);
}

#[test]
fn lead_accent_style_follows_the_front_book_and_is_empty_without_one() {
    let mut plain = point("b", ProgressFormat::Epub, Some(20));
    plain.book = book("b", "Babel", None, &["epub"]);
    let entries = stack_entries_for_test(&[point("a", ProgressFormat::Epub, Some(10)), plain], "");

    assert_eq!(
        lead_accent_style(&entries, 0),
        "--accent: oklch(0.7 0.1 200);"
    );
    // A book with no stored accent leaves the page on the Atrium default
    // rather than inheriting the previous lead's colour.
    assert_eq!(lead_accent_style(&entries, 1), "");
    // Out of range (a refetch that shortened the list) is the same case.
    assert_eq!(lead_accent_style(&entries, 9), "");
    assert_eq!(lead_accent_style(&[], 0), "");
}

#[test]
fn stack_kicker_names_a_single_book_instead_of_counting_a_stack() {
    // One book on the fan: nothing to bring forward, so nothing implies a
    // stack behind it.
    assert_eq!(stack_kicker(1), "your in-progress book");
    // A defensive zero renders the same line — the stack is hidden anyway.
    assert_eq!(stack_kicker(0), "your in-progress book");
    assert_eq!(stack_kicker(2), "2 books open");
    assert_eq!(stack_kicker(5), "5 books open");
}

#[test]
fn stack_entries_keys_the_two_formats_of_one_book_apart() {
    // Progress is stored per format, so a dual-format book open in both is two
    // points sharing a uuid. Keying the fan on the uuid alone gave them one
    // key, which mis-diffs the whole page (#2633).
    let points = vec![
        point("dual", ProgressFormat::Epub, Some(30)),
        point("dual", ProgressFormat::Audio, Some(40)),
    ];

    let keys: Vec<String> = stack_entries_for_test(&points, "http://x")
        .into_iter()
        .map(|e| e.key)
        .collect();

    assert_eq!(keys.len(), 2);
    assert_ne!(keys[0], keys[1]);
}

/// A point whose resolved book carries `id` — what `open_book_count` folds on.
fn point_on_book(uuid: &str, format: ProgressFormat, book_id: i64) -> ResumePoint {
    let mut p = point(uuid, format, Some(30));
    p.book.id = book_id;
    p
}

#[test]
fn open_book_count_counts_books_not_fan_cards() {
    // A book open in both formats holds two cards; the kicker above them
    // says "N books open", so it must not count the cards.
    let entries = stack_entries_for_test(
        &[
            point_on_book("dual", ProgressFormat::Epub, 1),
            point_on_book("dual", ProgressFormat::Audio, 1),
            point_on_book("other", ProgressFormat::Epub, 2),
        ],
        "http://x",
    );

    assert_eq!(entries.len(), 3);
    assert_eq!(open_book_count(&entries), 2);
    assert_eq!(stack_kicker(open_book_count(&entries)), "2 books open");
}

#[test]
fn open_book_count_folds_two_rows_that_resolve_to_one_book() {
    // `get_book_by_uuid` resolves both rows through `merged_uuids` to the one
    // surviving book, so the points differ in `record.book_uuid` alone and
    // carry an identical `book` — which is why the fold is on that book and
    // not on the uuid `resume_key` deliberately keys apart.
    let survivor = point_on_book("survivor", ProgressFormat::Epub, 1).book;
    let mut old = point_on_book("old-uuid", ProgressFormat::Epub, 1);
    old.book = survivor.clone();
    let mut new = point_on_book("new-uuid", ProgressFormat::Audio, 1);
    new.book = survivor;

    let entries = stack_entries_for_test(&[old, new], "http://x");

    assert_eq!(entries.len(), 2);
    assert_eq!(open_book_count(&entries), 1);
    assert_eq!(
        stack_kicker(open_book_count(&entries)),
        "your in-progress book"
    );
}

#[cfg(feature = "server")]
#[test]
fn resume_stack_pending_holds_the_stacks_place_with_a_dealt_fan_of_plates() {
    let html = crate::test_support::render(rsx! { ResumeStackPending {} });
    assert!(html.contains("continue-stack-pending"), "{html}");
    assert_eq!(html.matches("lmq-fcard-pending").count(), 3, "{html}");
    // Not the real stack: specs and the marquee glue key on that testid.
    assert!(!html.contains("\"continue-stack\""), "{html}");
}
