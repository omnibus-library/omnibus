//! Tests for route parsing, the redirects old addresses take, and the
//! query-separator trim every internal link goes through.

use std::str::FromStr;

use omnibus_shared::{ProgressFormat, ProgressRecord, ResumePoint};

use super::*;

#[test]
fn route_from_str_parses_stats_with_and_without_a_user() {
    assert_eq!(
        Route::from_str("/stats").unwrap(),
        Route::Stats { user: None }
    );
    assert_eq!(
        Route::from_str("/stats?user=7").unwrap(),
        Route::Stats { user: Some(7) }
    );
}

#[test]
fn route_from_str_parses_admin_with_its_section() {
    assert_eq!(
        Route::from_str("/admin").unwrap(),
        Route::Admin { section: None }
    );
    assert_eq!(
        Route::from_str("/admin?section=logs").unwrap(),
        Route::Admin {
            section: Some("logs".into())
        }
    );
}

#[test]
fn route_from_str_parses_the_cleanup_review_under_admin() {
    assert_eq!(
        Route::from_str("/admin/cleanup/authors").unwrap(),
        Route::CleanupReview {
            kind: "authors".into()
        }
    );
    assert_eq!(
        Route::from_str("/settings/cleanup/authors").unwrap(),
        Route::LegacyCleanupReview {
            kind: "authors".into()
        }
    );
}

#[test]
fn link_target_writes_the_admin_section_only_when_it_is_set() {
    assert_eq!(
        link_target(Route::Admin { section: None }),
        NavigationTarget::Internal("/admin".into())
    );
    assert_eq!(
        link_target(Route::Admin {
            section: Some("people".into())
        }),
        NavigationTarget::Internal("/admin?section=people".into())
    );
}

fn point(format: ProgressFormat, book_file_id: Option<i64>) -> ResumePoint {
    ResumePoint {
        record: ProgressRecord {
            book_uuid: "book-a".into(),
            format,
            epub_cfi: None,
            audio_position_seconds: None,
            book_file_id,
            progress_percent: None,
            kobo_location: None,
            updated_at: 0,
            client_updated_at: 0,
            total_duration_seconds: None,
            resolved: None,
            derived_epub_cfi: None,
        },
        book: Default::default(),
        linked: false,
        cross_format: None,
        audio_part: None,
        audio_part_count: None,
        playback_rate: None,
    }
}

#[test]
fn link_target_drops_the_separator_when_no_query_argument_is_set() {
    // The reported Files-section Listen href: `/listen/book-a?`.
    assert_eq!(
        link_target(Route::BookListen {
            uuid: "book-a".into(),
            file_id: None,
        }),
        NavigationTarget::Internal("/listen/book-a".into())
    );
    assert_eq!(
        link_target(Route::Settings { section: None }),
        NavigationTarget::Internal("/settings".into())
    );
    assert_eq!(
        link_target(Route::Stats { user: None }),
        NavigationTarget::Internal("/stats".into())
    );
}

#[test]
fn link_target_keeps_a_query_argument_that_is_set() {
    assert_eq!(
        link_target(Route::BookListen {
            uuid: "book-a".into(),
            file_id: Some(917),
        }),
        NavigationTarget::Internal("/listen/book-a?file_id=917".into())
    );
    assert_eq!(
        link_target(Route::Settings {
            section: Some("library".into()),
        }),
        NavigationTarget::Internal("/settings?section=library".into())
    );
    assert_eq!(
        link_target(Route::Stats { user: Some(7) }),
        NavigationTarget::Internal("/stats?user=7".into())
    );
}

#[test]
fn link_target_leaves_a_route_with_no_query_segment_alone() {
    assert_eq!(
        link_target(Route::BookRead {
            uuid: "book-a".into(),
        }),
        NavigationTarget::Internal("/read/book-a".into())
    );
}

#[test]
fn resume_route_sends_a_cbz_only_book_to_the_comic_pager() {
    let mut p = point(ProgressFormat::Epub, None);
    p.book.formats = vec!["CBZ".into()];
    assert_eq!(
        resume_route(&p),
        Route::ComicRead {
            uuid: "book-a".into()
        }
    );
}

#[test]
fn resume_route_sends_a_pdf_only_book_to_the_pdf_reader() {
    let mut p = point(ProgressFormat::Epub, None);
    p.book.formats = vec!["PDF".into()];
    assert_eq!(
        resume_route(&p),
        Route::PdfRead {
            uuid: "book-a".into(),
            file_id: None,
            page: None,
        }
    );
}

#[test]
fn resume_route_prefers_the_epub_reader_over_a_pdf_on_a_mixed_book() {
    // The `pdf-page:` anchor on the shared record must never reach
    // epub.js, but the EPUB is still the book's reader: the PDF is only
    // reachable through the file picker.
    let mut p = point(ProgressFormat::Epub, None);
    p.book.formats = vec!["PDF".into(), "EPUB".into()];
    assert_eq!(
        resume_route(&p),
        Route::BookRead {
            uuid: "book-a".into()
        }
    );
}

#[test]
fn resume_route_prefers_the_comic_pager_over_a_pdf() {
    let mut p = point(ProgressFormat::Epub, None);
    p.book.formats = vec!["pdf".into(), "cbz".into()];
    assert_eq!(
        resume_route(&p),
        Route::ComicRead {
            uuid: "book-a".into()
        }
    );
}

#[test]
fn link_target_trims_the_separators_left_by_one_absent_query_argument() {
    // Two optional query args: setting only the first leaves a trailing
    // `&`, only the second a leading `?&`. Neither belongs in an href.
    assert_eq!(
        link_target(Route::PdfRead {
            uuid: "book-a".into(),
            file_id: Some(917),
            page: None,
        }),
        NavigationTarget::Internal("/pdf/book-a?file_id=917".into())
    );
    assert_eq!(
        link_target(Route::PdfRead {
            uuid: "book-a".into(),
            file_id: None,
            page: Some(4),
        }),
        NavigationTarget::Internal("/pdf/book-a?page=4".into())
    );
    assert_eq!(trim_query_separators("/x?a=1&"), "/x?a=1");
    assert_eq!(trim_query_separators("/x?&b=2"), "/x?b=2");
    assert_eq!(trim_query_separators("/x?&"), "/x");
}

#[test]
fn link_target_trims_the_pdf_route_with_no_query_arguments() {
    assert_eq!(
        link_target(Route::PdfRead {
            uuid: "book-a".into(),
            file_id: None,
            page: None,
        }),
        NavigationTarget::Internal("/pdf/book-a".into())
    );
    assert_eq!(
        link_target(Route::PdfRead {
            uuid: "book-a".into(),
            file_id: Some(917),
            page: Some(4),
        }),
        NavigationTarget::Internal("/pdf/book-a?file_id=917&page=4".into())
    );
}

#[test]
fn resume_route_keeps_the_epub_reader_when_a_book_has_both_formats() {
    let mut p = point(ProgressFormat::Epub, None);
    p.book.formats = vec!["EPUB".into(), "CBZ".into()];
    assert_eq!(
        resume_route(&p),
        Route::BookRead {
            uuid: "book-a".into()
        }
    );
}

#[test]
fn resume_route_carries_the_audio_file_the_position_was_taken_in() {
    assert_eq!(
        resume_route(&point(ProgressFormat::Audio, Some(917))),
        Route::BookListen {
            uuid: "book-a".into(),
            file_id: Some(917),
        }
    );
}

#[test]
fn resume_route_leaves_the_file_open_when_the_point_names_none() {
    assert_eq!(
        resume_route(&point(ProgressFormat::Audio, None)),
        Route::BookListen {
            uuid: "book-a".into(),
            file_id: None,
        }
    );
}

#[test]
fn resume_route_sends_an_epub_position_to_the_reader() {
    assert_eq!(
        resume_route(&point(ProgressFormat::Epub, None)),
        Route::BookRead {
            uuid: "book-a".into()
        }
    );
}

#[test]
fn reader_route_opens_an_unread_audio_only_book_in_the_player() {
    assert_eq!(
        reader_route("book-a".into(), None, None, &["m4b".into()]),
        Route::BookListen {
            uuid: "book-a".into(),
            file_id: None
        }
    );
}

#[test]
fn reader_route_opens_an_unread_dual_format_book_in_the_reader() {
    assert_eq!(
        reader_route("book-a".into(), None, None, &["m4b".into(), "epub".into()]),
        Route::BookRead {
            uuid: "book-a".into()
        }
    );
}
