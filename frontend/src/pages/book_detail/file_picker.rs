//! File picker dropdown for the hero/mobile Read + Listen CTAs — lets the
//! reader choose which physical `book_files` row to open when a book has
//! more than one file of the format the CTA opens. Mirrors `export_menu`'s
//! trigger + scrim + focus-on-mount dialog pattern; shared between the web
//! hero and the mobile CTA row.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::BookFileInfo;

use crate::focus_after_paint::focus_after_paint;

/// Which action the picker's rows perform — drives the route prefix, the
/// dialog's accessible label, and the stable testids.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum FilePickerKind {
    Read,
    Listen,
}

impl FilePickerKind {
    /// The route one row opens: the player for a Listen picker, and for a
    /// Read picker the reader its *format* wants — `/read` for an EPUB,
    /// `/pdf` for a PDF (a mixed EPUB+PDF book offers both through this
    /// menu), `/comic` for a CBZ — carrying `?file_id=` where the reader
    /// takes one so the row opens that exact file.
    fn item_href(self, uuid: &str, file: &BookFileInfo) -> String {
        match self {
            FilePickerKind::Listen => format!("/listen/{uuid}?file_id={}", file.id),
            FilePickerKind::Read => match read_route_prefix(&file.format) {
                "comic" => format!("/comic/{uuid}"),
                prefix => format!("/{prefix}/{uuid}?file_id={}", file.id),
            },
        }
    }

    /// The single-file (plain link) href: the same per-format routing as
    /// [`Self::item_href`] with no `?file_id=`, since the bare route opens
    /// the book's only file of that format.
    fn single_href(self, uuid: &str, file: Option<&BookFileInfo>) -> String {
        match self {
            FilePickerKind::Listen => format!("/listen/{uuid}"),
            FilePickerKind::Read => {
                let prefix = file.map_or("read", |f| read_route_prefix(&f.format));
                format!("/{prefix}/{uuid}")
            }
        }
    }

    fn testid(self) -> &'static str {
        match self {
            FilePickerKind::Read => "read-file-picker",
            FilePickerKind::Listen => "listen-file-picker",
        }
    }

    fn aria_label(self) -> &'static str {
        match self {
            FilePickerKind::Read => "Choose which file to read",
            FilePickerKind::Listen => "Choose which file to listen to",
        }
    }
}

/// The reader route prefix a readable `book_files.format` opens in — the
/// per-file form of the EPUB > CBZ > PDF ladder `routes::resume_route`
/// applies per book. Anything unrecognised goes to the EPUB reader, the
/// pre-PDF behaviour.
fn read_route_prefix(format: &str) -> &'static str {
    if format.eq_ignore_ascii_case("PDF") {
        "pdf"
    } else if format.eq_ignore_ascii_case("CBZ") {
        "comic"
    } else {
        "read"
    }
}

/// True for the `book_files.format` values the Read picker offers: the
/// EPUBs and PDFs (each row opens its own reader — see
/// [`FilePickerKind::item_href`]). A CBZ has its own CTA and takes no file
/// id, so it stays out of the menu.
pub(super) fn is_readable_book_file(f: &BookFileInfo) -> bool {
    f.format.eq_ignore_ascii_case("EPUB") || f.format.eq_ignore_ascii_case("PDF")
}

/// True for the audio `book_files.format` values the listen path resolves
/// (mirrors `db::hls::resolve_audiobook_file`'s `format IN ('M4B', 'M4A',
/// 'MP3')` filter, since M4A shares the M4B container/code path).
pub(super) fn is_audio_book_file(f: &BookFileInfo) -> bool {
    f.format.eq_ignore_ascii_case("M4B")
        || f.format.eq_ignore_ascii_case("M4A")
        || f.format.eq_ignore_ascii_case("MP3")
}

fn file_picker_item_title(file: &BookFileInfo, kind: FilePickerKind) -> String {
    let format = match kind {
        FilePickerKind::Read => file.format.to_uppercase(),
        FilePickerKind::Listen => "Audiobook".to_string(),
    };
    let label = file
        .label
        .as_deref()
        .filter(|label| !label.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("Part {}", file.ordinal + 1));
    format!("{format} \u{b7} {label}")
}

fn file_picker_item_meta(file: &BookFileInfo, kind: FilePickerKind) -> Option<String> {
    let size = crate::format::file_size(file.size_bytes)?;
    let label = file
        .label
        .as_deref()
        .filter(|label| !label.trim().is_empty());
    match (kind, label) {
        (FilePickerKind::Listen, Some(label)) => Some(format!("{label} \u{b7} {size}")),
        _ => Some(size),
    }
}

/// How the picker's trigger presents itself: its label, the button classes it
/// wears, and the testid the single-file (plain link) form carries.
#[derive(Clone, PartialEq)]
pub(super) struct FilePickerChrome {
    pub label: String,
    pub button_class: String,
    pub single_testid: String,
}

/// Read/listen action that expands into a file picker when multiple files match.
#[component]
pub(super) fn BdFilePickerMenu(
    uuid: String,
    kind: FilePickerKind,
    files: Vec<BookFileInfo>,
    chrome: FilePickerChrome,
) -> Element {
    let FilePickerChrome {
        label,
        button_class,
        single_testid,
    } = chrome;
    if files.len() < 2 {
        let href = kind.single_href(&uuid, files.first());
        return rsx! {
            Link {
                to: "{href}",
                class: "{button_class}",
                "data-testid": "{single_testid}",
                "{label}"
            }
        };
    }
    let mut open = use_signal(|| false);
    let testid = kind.testid();
    let trigger_class = format!("{button_class} bd-file-picker-trigger");
    rsx! {
        div { class: "bd-file-picker",
            button {
                class: "{trigger_class}",
                "data-testid": "{testid}-trigger",
                r#type: "button",
                "aria-haspopup": "dialog",
                "aria-expanded": "{open()}",
                "aria-label": kind.aria_label(),
                onclick: move |_| {
                    let next = !open();
                    open.set(next);
                },
                "{label}"
                span { class: "bd-file-picker-caret", aria_hidden: "true", "\u{25be}" }
            }
            if open() {
                div {
                    class: "bd-export-scrim",
                    "data-testid": "{testid}-scrim",
                    onclick: move |_| open.set(false),
                }
                BdFilePickerPanel { uuid: uuid.clone(), kind, files: files.clone(), open }
            }
        }
    }
}

/// The open dropdown body. Split out (same reason as `BdExportPanel`) so
/// `onmounted` can focus it and ESC reaches the panel-level `onkeydown`.
#[component]
fn BdFilePickerPanel(
    uuid: String,
    kind: FilePickerKind,
    files: Vec<BookFileInfo>,
    open: Signal<bool>,
) -> Element {
    let mut open = open;
    let on_keydown = move |evt: Event<KeyboardData>| {
        if evt.key() == Key::Escape {
            evt.prevent_default();
            open.set(false);
        }
    };
    let testid = kind.testid();
    let heading_testid = format!("{testid}-heading");
    rsx! {
        div {
            class: "bd-export-panel bd-file-picker-panel card",
            role: "dialog",
            "aria-label": kind.aria_label(),
            "data-testid": "{testid}-panel",
            tabindex: "-1",
            onkeydown: on_keydown,
            onmounted: move |evt: MountedEvent| focus_after_paint(&evt),

            div {
                class: "label bd-file-picker-heading",
                "data-testid": "{heading_testid}",
                "{files.len()} files \u{b7} choose one"
            }
            for file in files.iter() {
                {
                    let title = file_picker_item_title(file, kind);
                    let meta = file_picker_item_meta(file, kind);
                    let href = kind.item_href(&uuid, file);
                    let item_testid = format!("{testid}-item-{}", file.id);
                    rsx! {
                        Link {
                            key: "{file.id}",
                            to: "{href}",
                            class: "bd-export-item bd-file-picker-item",
                            "data-testid": "{item_testid}",
                            onclick: move |_| open.set(false),
                            div { class: "bd-file-picker-item-copy",
                                div { class: "bd-file-picker-item-title", "{title}" }
                                if let Some(meta) = meta.as_deref() {
                                    div { class: "mono bd-file-picker-item-meta", "{meta}" }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(format: &str, id: i64, ordinal: i64) -> BookFileInfo {
        BookFileInfo {
            id,
            format: format.to_string(),
            filename: format!("part-{ordinal}.{}", format.to_lowercase()),
            ordinal,
            label: None,
            size_bytes: 0,
            path: None,
            etag: None,
            duration_seconds: None,
        }
    }

    #[test]
    fn is_audio_book_file_matches_every_hls_audio_format_case_insensitively() {
        for fmt in ["M4B", "m4b", "M4A", "m4a", "MP3", "mp3"] {
            assert!(is_audio_book_file(&file(fmt, 1, 0)));
        }
    }

    #[test]
    fn is_readable_book_file_admits_epubs_and_pdfs_only() {
        assert!(is_readable_book_file(&file("EPUB", 1, 0)));
        assert!(is_readable_book_file(&file("pdf", 1, 0)));
        assert!(!is_readable_book_file(&file("CBZ", 1, 0)));
        assert!(!is_readable_book_file(&file("M4B", 1, 0)));
    }

    #[test]
    fn is_audio_book_file_rejects_non_audio_formats() {
        assert!(!is_audio_book_file(&file("EPUB", 1, 0)));
        assert!(!is_audio_book_file(&file("PDF", 1, 0)));
    }

    #[test]
    fn file_picker_item_title_matches_the_read_and_listen_design_labels() {
        let mut epub = file("EPUB", 1, 0);
        epub.label = Some("10th anniversary".to_string());
        let mut audiobook = file("M4B", 2, 1);
        audiobook.label = Some("Full cast".to_string());

        assert_eq!(
            file_picker_item_title(&epub, FilePickerKind::Read),
            "EPUB · 10th anniversary"
        );
        assert_eq!(
            file_picker_item_title(&audiobook, FilePickerKind::Listen),
            "Audiobook · Full cast"
        );
    }

    #[test]
    fn file_picker_item_meta_formats_file_size_and_audio_label() {
        let mut epub = file("EPUB", 1, 0);
        epub.size_bytes = 3_100_000;
        let mut audiobook = file("M4B", 2, 1);
        audiobook.label = Some("Full cast".to_string());
        audiobook.size_bytes = 512_000_000;

        assert_eq!(
            file_picker_item_meta(&epub, FilePickerKind::Read),
            Some("3.1 MB".to_string())
        );
        assert_eq!(
            file_picker_item_meta(&audiobook, FilePickerKind::Listen),
            Some("Full cast · 512.0 MB".to_string())
        );
    }

    #[cfg(feature = "server")]
    #[test]
    fn file_picker_menu_integrates_the_caret_into_the_action_for_multiple_files() {
        let html = dioxus::ssr::render_element(rsx! {
            BdFilePickerMenu {
                uuid: "book-a".to_string(),
                kind: FilePickerKind::Listen,
                files: vec![file("MP3", 1, 0), file("MP3", 2, 1)],
                chrome: FilePickerChrome {
                    label: "Start listening".to_string(),
                    button_class: "btn primary lg".to_string(),
                    single_testid: "start-listening".to_string(),
                },
            }
        });

        assert!(html.contains("data-testid=\"listen-file-picker-trigger\""));
        assert!(html.contains("Start listening"));
        assert!(html.contains("\u{25be}"));
        assert!(!html.contains("data-testid=\"start-listening\""));
    }

    #[test]
    fn read_picker_rows_route_each_file_by_its_format() {
        // AC4: a mixed EPUB+PDF book keeps the EPUB as its reader and offers
        // the PDF through the same menu at `/pdf/{uuid}?file_id=`.
        assert_eq!(
            FilePickerKind::Read.item_href("book-a", &file("EPUB", 1, 0)),
            "/read/book-a?file_id=1"
        );
        assert_eq!(
            FilePickerKind::Read.item_href("book-a", &file("pdf", 2, 1)),
            "/pdf/book-a?file_id=2"
        );
        // The comic pager takes no file id.
        assert_eq!(
            FilePickerKind::Read.item_href("book-a", &file("CBZ", 3, 2)),
            "/comic/book-a"
        );
        assert_eq!(
            FilePickerKind::Listen.item_href("book-a", &file("M4B", 4, 0)),
            "/listen/book-a?file_id=4"
        );
    }

    #[test]
    fn single_file_links_route_by_format_and_carry_no_file_id() {
        assert_eq!(
            FilePickerKind::Read.single_href("book-a", Some(&file("PDF", 9, 0))),
            "/pdf/book-a"
        );
        assert_eq!(
            FilePickerKind::Read.single_href("book-a", Some(&file("EPUB", 9, 0))),
            "/read/book-a"
        );
        assert_eq!(
            FilePickerKind::Read.single_href("book-a", None),
            "/read/book-a"
        );
        assert_eq!(
            FilePickerKind::Listen.single_href("book-a", Some(&file("MP3", 9, 0))),
            "/listen/book-a"
        );
    }

    #[test]
    fn file_picker_kinds_carry_their_own_testids() {
        assert_eq!(FilePickerKind::Read.testid(), "read-file-picker");
        assert_eq!(FilePickerKind::Listen.testid(), "listen-file-picker");
    }
}
