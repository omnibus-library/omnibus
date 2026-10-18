//! Tests for the library-summary formatter, the Save payload guard, the Save
//! and maintenance handlers, and the form's first paint. Handlers run inside a
//! live root scope so they can touch signals; the futures they spawn are never
//! polled, so no network call fires.

#[cfg(feature = "server")]
use crate::test_support::tag_with_testid;
use crate::test_support::{blank_form_event, blank_mouse_event, in_root_scope};

use super::*;

fn section(total: usize, counts: &[(&str, usize)]) -> LibrarySection {
    LibrarySection {
        path: Some("/lib".into()),
        total_files: total,
        counts_by_ext: counts.iter().map(|(e, c)| (e.to_string(), *c)).collect(),
        error: None,
    }
}

/// The Sources form's signals, holding `load` and the given saved paths.
fn sources_form(load: Load, ebook: &str, audiobook: &str) -> SourcesForm {
    SourcesForm {
        ebook_path: Signal::new(ebook.to_string()),
        audiobook_path: Signal::new(audiobook.to_string()),
        scan_interval_hours: Signal::new(String::new()),
        interval_error: Signal::new(None),
        load: Signal::new(load),
        reload: Signal::new(0),
        saving: Signal::new(false),
        status: Signal::new(None),
        status_is_error: Signal::new(false),
        library_refresh: Signal::new(0),
    }
}

#[test]
fn library_summary_line_counts_one_file_in_the_singular() {
    assert_eq!(library_summary_line(&section(1, &[])), "1 file found.");
}

#[test]
fn library_summary_line_appends_a_clause_per_extension() {
    let line = library_summary_line(&section(5, &[("epub", 4), ("pdf", 1)]));
    assert!(line.starts_with("5 files found."), "{line}");
    assert!(line.contains("4 .epub found."), "{line}");
    assert!(line.contains("1 .pdf found."), "{line}");
}

#[test]
fn settings_payload_refuses_until_the_saved_settings_have_loaded() {
    for load in [Load::Pending, Load::Failed] {
        assert_eq!(
            settings_payload(load, "", "", ""),
            Err(SaveRefusal::NotLoaded)
        );
    }
}

#[test]
fn settings_payload_refuses_a_non_numeric_interval() {
    assert_eq!(
        settings_payload(Load::Ready, "/books", "", "soon"),
        Err(SaveRefusal::BadInterval)
    );
}

#[test]
fn settings_payload_trims_paths_and_drops_blank_fields() {
    let payload = settings_payload(Load::Ready, " /books ", "  ", "24").unwrap();
    assert_eq!(payload.ebook_library_path.as_deref(), Some("/books"));
    assert_eq!(payload.audiobook_library_path, None);
    assert_eq!(payload.scan_interval_hours, Some(24));
}

#[test]
fn save_settings_handler_refuses_to_save_blank_fields_after_a_failed_load() {
    in_root_scope(|| {
        let form = sources_form(Load::Failed, "", "");
        let mut handler =
            save_settings_handler("http://127.0.0.1:0".to_string(), form, Signal::new(None));
        handler(blank_form_event());

        // No save started: `saving` flips before any request is spawned.
        assert!(!(form.saving)());
        assert!((form.status_is_error)());
        assert_eq!((form.status)().as_deref(), Some(NOT_LOADED_MESSAGE));
    });
}

#[test]
fn save_settings_handler_shows_a_bad_interval_at_its_field() {
    in_root_scope(|| {
        let form = sources_form(Load::Ready, "/books", "");
        let mut interval = form.scan_interval_hours;
        interval.set("soon".to_string());
        let mut handler =
            save_settings_handler("http://127.0.0.1:0".to_string(), form, Signal::new(None));
        handler(blank_form_event());

        assert!(!(form.saving)());
        assert_eq!((form.interval_error)().as_deref(), Some(INTERVAL_MESSAGE));
    });
}

#[test]
fn save_settings_handler_starts_a_save_once_the_settings_have_loaded() {
    in_root_scope(|| {
        let form = sources_form(Load::Ready, "/books", "/audio");
        let mut handler =
            save_settings_handler("http://127.0.0.1:0".to_string(), form, Signal::new(None));
        handler(blank_form_event());

        assert!((form.saving)());
        assert_eq!((form.status)(), None);
    });
}

#[test]
fn scan_library_handler_flips_in_flight_immediately_on_click() {
    in_root_scope(|| {
        let status = Signal::new(None::<String>);
        let status_is_error = Signal::new(false);
        let scan_in_flight = Signal::new(false);

        let mut handler = scan_library_handler(
            "http://127.0.0.1:0".to_string(),
            status,
            status_is_error,
            scan_in_flight,
        );
        handler(blank_mouse_event());

        assert!(scan_in_flight());
    });
}

#[test]
fn rewrite_all_epubs_handler_flips_in_flight_immediately_on_click() {
    in_root_scope(|| {
        let status = Signal::new(None::<String>);
        let status_is_error = Signal::new(false);
        let rewrite_in_flight = Signal::new(false);

        let mut handler = rewrite_all_epubs_handler(
            "http://127.0.0.1:0".to_string(),
            status,
            status_is_error,
            rewrite_in_flight,
        );
        handler(blank_mouse_event());

        assert!(rewrite_in_flight());
    });
}

#[cfg(feature = "server")]
#[test]
fn library_location_section_holds_save_until_the_settings_load() {
    let html = crate::test_support::render_in_vdom(LibraryLocationSection);
    assert!(html.contains("Save library settings"), "{html}");
    assert!(
        tag_with_testid(&html, "library-save").contains("disabled"),
        "{html}"
    );
}

#[cfg(feature = "server")]
#[test]
fn maintenance_panel_says_what_each_command_does() {
    let html = crate::test_support::render_in_vdom(MaintenancePanel);
    for name in [
        "Scan library",
        "Refetch author pictures",
        "Extract audiobook chapters",
        "Bake overrides into EPUBs",
    ] {
        assert!(html.contains(name), "{name}: {html}");
    }
    assert_eq!(html.matches("maint-desc").count(), 4, "{html}");
    assert!(
        tag_with_testid(&html, "scan-library").contains("aria-describedby"),
        "{html}"
    );
}
