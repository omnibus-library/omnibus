use super::*;

fn file(id: i64, format: &str, label: &str, path: &str) -> BookFileInfo {
    BookFileInfo {
        id,
        format: format.to_string(),
        filename: format!("book.{}", format.to_lowercase()),
        ordinal: 0,
        label: Some(label.to_string()),
        size_bytes: 1_200_000,
        path: Some(path.to_string()),
        etag: None,
        duration_seconds: None,
    }
}

fn copy(id: i64) -> PhysicalCopy {
    PhysicalCopy {
        id,
        book_uuid: "uuid-a".into(),
        isbn: Some("9781635575637".into()),
        added_by_user_id: None,
        checked_in_at: 0,
        checked_in_at_iso: None,
        note: Some("Hardback".into()),
    }
}

/// Renders one pane in isolation. The full dialog mounts a manifest-fetch
/// effect, which `render_element` can't drive without a live runtime.
#[component]
fn ChooseHarness(manifest: BookDeletionManifest) -> Element {
    render_choose(
        "Piranesi".to_string(),
        manifest,
        use_delete_dialog_signals(),
        EventHandler::new(|_| {}),
    )
}

#[component]
fn ConfirmHarness(manifest: BookDeletionManifest) -> Element {
    render_confirm(
        "Piranesi".to_string(),
        manifest,
        use_delete_dialog_signals(),
        |_| {},
        EventHandler::new(|_| {}),
    )
}

#[test]
fn choose_pane_lists_each_file_with_its_badge_size_and_path() {
    let html = dioxus::ssr::render_element(rsx! {
        ChooseHarness {
            manifest: BookDeletionManifest {
                files: vec![
                    file(1, "epub", "Piranesi (Bloomsbury)", "clarke/piranesi.epub"),
                    file(2, "m4b", "Narrated by Chiwetel Ejiofor", "clarke/piranesi.m4b"),
                ],
                ..Default::default()
            },
        }
    });

    assert!(html.contains("Delete files from “Piranesi”?"));
    assert!(html.contains("2 FILES ON DISK"));
    assert!(html.contains("data-testid=\"delete-file-1\""));
    assert!(html.contains("data-testid=\"delete-file-2\""));
    assert!(html.contains("EPUB"));
    assert!(html.contains("1.2 MB · clarke/piranesi.epub"));
}

#[test]
fn choose_pane_adds_a_physical_copies_section_when_the_book_has_one() {
    let html = dioxus::ssr::render_element(rsx! {
        ChooseHarness {
            manifest: BookDeletionManifest {
                files: vec![file(1, "epub", "Piranesi (Bloomsbury)", "clarke/piranesi.epub")],
                copies: vec![copy(7)],
                ..Default::default()
            },
        }
    });

    assert!(html.contains("PHYSICAL COPIES"));
    assert!(html.contains("data-testid=\"delete-copy-7\""));
    assert!(html.contains("ISBN 9781635575637 · no file on disk"));
    assert!(html.contains("Book record is removed only when every item here is selected."));
}

#[test]
fn confirm_pane_offers_the_record_delete_for_a_book_with_no_items() {
    let html = dioxus::ssr::render_element(rsx! {
        ConfirmHarness { manifest: BookDeletionManifest::default() }
    });

    assert!(html.contains("Delete “Piranesi”?"));
    assert!(html.contains("This book has no files on disk."));
    assert!(html.contains("Delete record"));
    // Nothing to go back to when there was no choose step.
    assert!(!html.contains("data-testid=\"delete-back\""));
}

fn manifest(files: Vec<BookFileInfo>, copies: Vec<PhysicalCopy>) -> BookDeletionManifest {
    BookDeletionManifest {
        files,
        copies,
        ..Default::default()
    }
}

fn labels(manifest: &BookDeletionManifest, files: &[i64], copies: &[i64]) -> ConfirmLabels {
    confirm_labels(
        "Piranesi",
        manifest,
        &files.iter().copied().collect(),
        &copies.iter().copied().collect(),
    )
}

#[test]
fn confirm_labels_names_the_single_picked_file_and_says_the_book_stays() {
    let m = manifest(
        vec![
            file(1, "EPUB", "EPUB edition", "a.epub"),
            file(2, "M4B", "Audio", "a.m4b"),
        ],
        vec![],
    );

    let out = labels(&m, &[1], &[]);

    assert_eq!(out.heading, "Delete 1 file?");
    assert_eq!(
        out.copy,
        "“EPUB edition” will be deleted from disk and removed from this book. Piranesi stays in your library with its 1 remaining file."
    );
    assert_eq!(out.action, "Delete file");
    assert!(out.losses.is_none());
}

#[test]
fn confirm_labels_says_a_copy_only_selection_is_un_recorded_not_deleted() {
    let m = manifest(vec![file(1, "EPUB", "EPUB", "a.epub")], vec![copy(7)]);

    let out = labels(&m, &[], &[7]);

    assert_eq!(out.heading, "Delete 1 item?");
    assert_eq!(
        out.copy,
        "1 copy will be un-recorded — nothing is deleted from disk. Piranesi stays in your library with its 1 remaining item."
    );
}

#[test]
fn confirm_labels_splits_a_mixed_selection_into_deleted_and_un_recorded() {
    let m = manifest(
        vec![
            file(1, "EPUB", "EPUB", "a.epub"),
            file(2, "M4B", "Audio", "a.m4b"),
        ],
        vec![copy(7)],
    );

    let out = labels(&m, &[1], &[7]);

    assert_eq!(out.heading, "Delete 2 items?");
    assert_eq!(
        out.copy,
        "1 file and 1 copy will be removed from this book — files deleted from disk, physical copies only un-recorded. Piranesi stays in your library with its 1 remaining item."
    );
}

#[test]
fn confirm_labels_total_delete_with_copies_names_both_fates() {
    let m = manifest(vec![file(1, "EPUB", "EPUB", "a.epub")], vec![copy(7)]);

    let out = labels(&m, &[1], &[7]);

    assert_eq!(out.heading, "Delete all 2 items?");
    assert_eq!(
        out.copy,
        "Every file for “Piranesi” will be deleted from disk, its physical copies un-recorded, and the book will be removed from your library entirely."
    );
    assert_eq!(out.action, "Delete book");
}

#[test]
fn confirm_labels_paper_only_total_delete_promises_the_filesystem_is_untouched() {
    let m = manifest(vec![], vec![copy(7)]);

    let out = labels(&m, &[], &[7]);

    assert_eq!(out.heading, "Delete “Piranesi”?");
    assert_eq!(
        out.copy,
        "“Piranesi” has no files on disk. Its physical copies will be un-recorded and the book removed from your library entirely — nothing is deleted from your filesystem."
    );
    assert_eq!(out.action, "Delete book");
}

#[test]
fn confirm_labels_total_delete_without_copies_keeps_the_files_only_wording() {
    let m = manifest(vec![file(1, "EPUB", "EPUB", "a.epub")], vec![]);

    let out = labels(&m, &[1], &[]);

    assert_eq!(
        out.copy,
        "Every file for “Piranesi” will be deleted from disk, and the book will be removed from your library entirely."
    );
}

/// Mounts the real `DeleteBookDialog`, not just its inner panes — the
/// manifest fetch is a `use_effect`-spawned future that doesn't resolve
/// within one `render_in_vdom` rebuild, so this exercises the dialog's
/// `ConfirmModal` wiring in its "loading" first paint, same as a real
/// mount before the fetch lands.
fn dialog_harness() -> Element {
    rsx! {
        DeleteBookDialog {
            uuid: "book-uuid".to_string(),
            title: "Piranesi".to_string(),
            on_deleted: move |_| {},
            on_close: move |_| {},
        }
    }
}

#[test]
fn delete_book_dialog_renders_the_confirm_modal_shell_on_first_paint() {
    let html = crate::test_support::render_in_vdom(dialog_harness);
    assert!(html.contains("data-testid=\"delete-book-dialog\""));
    assert!(html.contains("author-photo-modal-backdrop"));
    assert!(html.contains("mg-modal del-modal"));
    assert!(html.contains("Loading this book\u{2019}s files\u{2026}"));
}
