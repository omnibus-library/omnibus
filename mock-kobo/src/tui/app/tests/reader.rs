//! Opening the reader, closing it with a Read job, the busy/device-syncing
//! gate on closing or committing while it's open, and `show_book` placing
//! the reader on the device's own bookmark.

use super::*;

#[test]
fn open_book_shows_metadata_only_for_a_book_that_is_not_downloaded() {
    let mut app = App::new(None);

    app.open_book("book-1".into(), Ok(None));

    match &app.mode {
        Mode::Reading(reader) => assert_eq!(reader.text, None),
        other => panic!("expected Reading, got {other:?}"),
    }
}

#[test]
fn open_book_reports_an_unreadable_book_and_stays_in_the_library() {
    let mut app = App::new(None);

    app.open_book("book-1".into(), Err("not a kepub".into()));

    assert_eq!(app.mode, Mode::Normal);
    assert_eq!(app.status, Some(Status::Error("not a kepub".to_owned())));
}

#[test]
fn on_key_returns_the_read_job_when_the_reader_closes() {
    let mut app = App::new(None);
    app.open_book("book-1".into(), Ok(Some(reader_kepub())));
    app.fit_reader(24, 3);

    let action = app.on_key(code(KeyCode::Esc), URL);

    match action {
        Some(Action::Run(Job::Read {
            book,
            percent,
            location,
        })) => {
            assert_eq!(book, "book-1");
            assert_eq!(u8::from(percent), 0);
            assert!(location.is_some());
        }
        other => panic!("expected a Read job, got {other:?}"),
    }
    assert_eq!(app.mode, Mode::Normal);
}

#[test]
fn on_key_keeps_the_reader_open_when_closing_while_busy() {
    let mut app = App::new(None);
    app.open_book("book-1".into(), Ok(Some(reader_kepub())));
    app.fit_reader(24, 3);
    app.busy = true;

    let action = app.on_key(code(KeyCode::Esc), URL);

    assert_eq!(action, None);
    assert!(matches!(app.mode, Mode::Reading(_)));
    assert_eq!(app.status, Some(Status::Error(BUSY.to_owned())));
}

#[test]
fn show_book_opens_the_reader_on_the_page_holding_the_bookmarked_span() {
    let mut app = opened_reader_app();
    let bookmark = crate::reading::Bookmark {
        percent: Percent::new(80),
        location: Some(KoboSpan {
            source: "ch2.xhtml".into(),
            value: "kobo.3.1".into(),
        }),
        modified: 1,
    };

    app.show_book(&library_with(book_with_bookmark(Some(bookmark))));

    // ch2's `kobo.3.1` (span 2) starts at word 13; at 24x3 that word falls
    // on page 1 (page 0 covers words 0-10, page 1 words 11-20).
    assert_eq!(reader_position(&app), (1, 1));
}

#[test]
fn show_book_moves_the_page_when_a_newer_bookmark_arrives_while_reading() {
    let mut app = opened_reader_app();
    let first = crate::reading::Bookmark {
        percent: Percent::new(80),
        location: Some(KoboSpan {
            source: "ch2.xhtml".into(),
            value: "kobo.3.1".into(),
        }),
        modified: 1,
    };
    app.show_book(&library_with(book_with_bookmark(Some(first))));
    assert_eq!(reader_position(&app), (1, 1));

    let newer = crate::reading::Bookmark {
        percent: Percent::new(0),
        location: Some(KoboSpan {
            source: "ch1.xhtml".into(),
            value: "kobo.1.1".into(),
        }),
        modified: 2,
    };
    app.show_book(&library_with(book_with_bookmark(Some(newer))));

    assert_eq!(reader_position(&app), (0, 0));
}

#[test]
fn show_book_keeps_the_page_for_a_bookmark_no_newer_than_the_last_placed() {
    let mut app = opened_reader_app();
    let bookmark = crate::reading::Bookmark {
        percent: Percent::new(80),
        location: Some(KoboSpan {
            source: "ch2.xhtml".into(),
            value: "kobo.3.1".into(),
        }),
        modified: 5,
    };
    app.show_book(&library_with(book_with_bookmark(Some(bookmark.clone()))));
    assert_eq!(reader_position(&app), (1, 1));
    app.on_key(code(KeyCode::Right), URL); // the reader's own page turn

    app.show_book(&library_with(book_with_bookmark(Some(bookmark))));

    assert_eq!(
        reader_position(&app),
        (1, 2),
        "a bookmark no newer than the last placed one must not undo a page turn"
    );
}

#[test]
fn on_key_refuses_a_readers_highlight_while_another_job_runs() {
    let mut app = opened_reader_app();
    if let Mode::Reading(reader) = &mut app.mode {
        reader.chapter = 1;
        reader.cursor = 2;
        reader.fit(24, 3);
        reader.selection = Some(crate::tui::reader::Selection {
            start: 2,
            end: 4,
            note: None,
        });
    }
    app.busy = true;

    let action = app.on_key(code(KeyCode::Char('3')), URL);

    assert_eq!(action, None);
    assert!(
        matches!(app.mode, Mode::Reading(_)),
        "the reader stays open"
    );
    assert_eq!(app.status, Some(Status::Error(BUSY.to_owned())));
}

#[test]
fn show_book_clears_a_stale_selection_when_it_moves_to_another_chapter() {
    let mut app = opened_reader_app();
    if let Mode::Reading(reader) = &mut app.mode {
        reader.cursor = 45; // a late word in ch1 (50 words, 0-49)
    }
    app.on_key(code(KeyCode::Char('v')), URL);
    match &app.mode {
        Mode::Reading(reader) => assert!(reader.selection.is_some(), "selection started"),
        other => panic!("expected Reading, got {other:?}"),
    }
    // ch3 (index 2) has only 8 words (0-7) — far shorter than word 45.
    let bookmark = crate::reading::Bookmark {
        percent: Percent::new(90),
        location: Some(KoboSpan {
            source: "ch3.xhtml".into(),
            value: "kobo.2.1".into(),
        }),
        modified: 1,
    };

    app.show_book(&library_with(book_with_bookmark(Some(bookmark))));

    assert_eq!(reader_position(&app).0, 2, "moved to ch3");
    match &app.mode {
        Mode::Reading(reader) => assert_eq!(
            reader.selection, None,
            "the selection must not survive the jump"
        ),
        other => panic!("expected Reading, got {other:?}"),
    }

    let right = app.on_key(code(KeyCode::Right), URL);
    let digit = app.on_key(code(KeyCode::Char('1')), URL);

    assert_eq!(
        right, None,
        "no stray action from extending a cleared selection"
    );
    assert_eq!(digit, None, "no Highlight job without an open selection");
}

#[test]
fn on_key_refuses_to_close_the_reader_while_the_device_is_syncing() {
    let mut app = opened_reader_app();
    app.device_syncing = true;

    let action = app.on_key(code(KeyCode::Esc), URL);

    assert_eq!(action, None);
    assert!(
        matches!(app.mode, Mode::Reading(_)),
        "the reader stays open"
    );
    assert_eq!(app.status, Some(Status::Error(BUSY.to_owned())));
}

#[test]
fn on_key_types_a_digit_into_the_note_buffer_while_the_device_is_syncing() {
    let mut app = opened_reader_app();
    if let Mode::Reading(reader) = &mut app.mode {
        reader.chapter = 1;
        reader.cursor = 2;
        reader.fit(24, 3);
        reader.selection = Some(crate::tui::reader::Selection {
            start: 2,
            end: 4,
            note: None,
        });
        reader.view = crate::tui::reader::ReaderView::Note(String::new());
    }
    app.device_syncing = true;

    let action = app.on_key(code(KeyCode::Char('4')), URL);

    assert_eq!(action, None);
    match &app.mode {
        Mode::Reading(reader) => assert_eq!(
            reader.view,
            crate::tui::reader::ReaderView::Note("4".to_owned()),
            "the digit must reach the note buffer, not the busy gate"
        ),
        other => panic!("expected Reading, got {other:?}"),
    }
}

#[test]
fn on_key_refuses_to_commit_a_highlight_while_the_device_is_syncing() {
    let mut app = opened_reader_app();
    if let Mode::Reading(reader) = &mut app.mode {
        reader.chapter = 1;
        reader.cursor = 2;
        reader.fit(24, 3);
        reader.selection = Some(crate::tui::reader::Selection {
            start: 2,
            end: 4,
            note: None,
        });
    }
    app.device_syncing = true;

    let action = app.on_key(code(KeyCode::Char('1')), URL);

    assert_eq!(action, None);
    match &app.mode {
        Mode::Reading(reader) => assert!(reader.selection.is_some(), "the selection survives"),
        other => panic!("expected Reading, got {other:?}"),
    }
    assert_eq!(app.status, Some(Status::Error(BUSY.to_owned())));
}

#[test]
fn ctrl_c_in_the_reader_sends_the_read_job_before_quitting() {
    let mut app = opened_reader_app();

    let action = app.on_key(ctrl_c(), URL);

    match action {
        Some(Action::Run(Job::Read { book, .. })) => assert_eq!(book, "book-1"),
        other => panic!("expected a Read job, got {other:?}"),
    }
    assert_eq!(app.mode, Mode::Normal);
    assert!(app.busy, "quit waits for the job, same as a busy job today");
}

#[test]
fn show_book_records_the_stamp_for_a_bookmark_with_neither_location_nor_percent() {
    let mut app = opened_reader_app();
    let bookmark = crate::reading::Bookmark {
        percent: None,
        location: None,
        modified: 1,
    };

    app.show_book(&library_with(book_with_bookmark(Some(bookmark))));

    assert_eq!(reader_position(&app), (0, 0), "no location or percent means no move");
    assert_eq!(app.status, None, "a missing location is not an error");

    let older = crate::reading::Bookmark {
        percent: Percent::new(50),
        location: Some(KoboSpan {
            source: "ch2.xhtml".into(),
            value: "kobo.3.1".into(),
        }),
        modified: 0,
    };
    app.show_book(&library_with(book_with_bookmark(Some(older))));
    assert_eq!(
        reader_position(&app),
        (0, 0),
        "the recorded stamp blocks an older bookmark that arrives later"
    );
}

#[test]
fn show_book_keeps_the_page_for_a_bookmark_older_than_the_last_placed() {
    let mut app = opened_reader_app();
    let newer = crate::reading::Bookmark {
        percent: Percent::new(80),
        location: Some(KoboSpan {
            source: "ch2.xhtml".into(),
            value: "kobo.3.1".into(),
        }),
        modified: 5,
    };
    app.show_book(&library_with(book_with_bookmark(Some(newer))));
    assert_eq!(reader_position(&app), (1, 1));

    let older = crate::reading::Bookmark {
        percent: Percent::new(0),
        location: Some(KoboSpan {
            source: "ch1.xhtml".into(),
            value: "kobo.1.1".into(),
        }),
        modified: 3,
    };
    app.show_book(&library_with(book_with_bookmark(Some(older))));

    assert_eq!(
        reader_position(&app),
        (1, 1),
        "an older bookmark must not move the reader back"
    );
}

#[test]
fn show_book_opens_on_the_page_matching_a_percent_only_bookmark() {
    let mut app = opened_reader_app();
    let bookmark = crate::reading::Bookmark {
        percent: Percent::new(55),
        location: None,
        modified: 1,
    };

    app.show_book(&library_with(book_with_bookmark(Some(bookmark))));

    let page_percent = match &app.mode {
        Mode::Reading(reader) => i16::from(u8::from(reader.pages()[reader.page].percent)),
        other => panic!("expected Reading, got {other:?}"),
    };
    assert!(
        (page_percent - 55).abs() <= 25,
        "page percent {page_percent} should land near the bookmark's 55%"
    );

    let action = app.on_key(code(KeyCode::Esc), URL);
    match action {
        Some(Action::Run(Job::Read { percent, .. })) => {
            assert_ne!(u8::from(percent), 0, "must not have fallen back to the book's start");
        }
        other => panic!("expected a Read job, got {other:?}"),
    }
}

#[test]
fn show_book_before_the_first_fit_lands_on_the_right_page_once_fitted() {
    let mut app = App::new(None);
    app.open_book("book-1".into(), Ok(Some(reader_kepub())));
    let bookmark = crate::reading::Bookmark {
        percent: Percent::new(80),
        location: Some(KoboSpan {
            source: "ch2.xhtml".into(),
            value: "kobo.3.1".into(),
        }),
        modified: 1,
    };
    app.show_book(&library_with(book_with_bookmark(Some(bookmark))));

    app.fit_reader(24, 3);

    // ch2's kobo.3.1 (span 2) starts at word 13; at 24x3 that word falls
    // on page 1 (page 0 covers words 0-10, page 1 words 11-20) — the same
    // landing spot as show_book_opens_the_reader_on_the_page_holding_the_bookmarked_span,
    // which fits before calling show_book.
    assert_eq!(reader_position(&app), (1, 1));
}

#[test]
fn show_book_reports_a_bookmarked_span_the_book_does_not_hold() {
    let mut app = opened_reader_app();
    let bookmark = crate::reading::Bookmark {
        percent: Percent::new(10),
        location: Some(KoboSpan {
            source: "ch9.xhtml".into(),
            value: "kobo.9.9".into(),
        }),
        modified: 1,
    };

    app.show_book(&library_with(book_with_bookmark(Some(bookmark))));

    assert_eq!(reader_position(&app), (0, 0), "the reader stays put");
    assert!(matches!(app.status, Some(Status::Error(_))));
}
