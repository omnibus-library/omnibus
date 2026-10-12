//! `draw` through ratatui's `TestBackend`: what a 100x30 terminal shows for a given `Screen`.

use std::collections::BTreeMap;
use std::path::Path;

use ratatui::backend::TestBackend;
use ratatui::style::Color;
use ratatui::Terminal;

use crate::control::{LastSync, RESET_MESSAGE};
use crate::device::Book;
use crate::firmware::Quirk;
use crate::tui::app::{Edit, Field, Mode, Status};

use super::*;

fn view() -> DeviceView {
    DeviceView {
        hardware_id: "mock-ab12".to_owned(),
        url: "http://127.0.0.1:3000".to_owned(),
        syncing: false,
        last_sync: None,
        sync_token: None,
        library: BTreeMap::new(),
    }
}

fn book(title: &str, authors: &[&str], archived: bool) -> Book {
    Book {
        title: title.to_owned(),
        description: String::new(),
        authors: authors.iter().map(|a| (*a).to_owned()).collect(),
        series: None,
        downloaded: false,
        archived,
    }
}

fn view_with_books(books: Vec<(&str, Book)>) -> DeviceView {
    let library = books
        .into_iter()
        .map(|(id, book)| (id.to_owned(), book))
        .collect();
    DeviceView { library, ..view() }
}

fn request(method: &str, path: &str, status: u16) -> RequestRecord {
    RequestRecord {
        method: method.to_owned(),
        path: path.to_owned(),
        status,
    }
}

fn editing(field: Field, buffer: &str) -> App {
    App {
        mode: Mode::Editing(Edit {
            field,
            buffer: buffer.to_owned(),
        }),
        ..App::default()
    }
}

fn terminal(width: u16, height: u16) -> Terminal<TestBackend> {
    Terminal::new(TestBackend::new(width, height)).unwrap()
}

/// Draw one frame of `view`, `requests` and `app` into `terminal`.
fn draw_screen(
    terminal: &mut Terminal<TestBackend>,
    view: &DeviceView,
    requests: &[RequestRecord],
    app: &App,
) {
    let screen = Screen {
        view,
        requests,
        port: 47431,
        state: Path::new(".claude/runtime/mock-kobo.json"),
        app,
    };
    terminal.draw(|frame| draw(frame, &screen)).unwrap();
}

/// Each row of the last frame drawn into `terminal`, as text.
fn screen_rows(terminal: &Terminal<TestBackend>) -> Vec<String> {
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .map(|y| {
            (0..buffer.area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect()
        })
        .collect()
}

/// What a 100x30 terminal shows for `view` and `app`, with no requests.
fn shown(view: &DeviceView, app: &App) -> String {
    shown_with_requests(view, &[], app)
}

fn shown_with_requests(view: &DeviceView, requests: &[RequestRecord], app: &App) -> String {
    let mut terminal = terminal(100, 30);
    draw_screen(&mut terminal, view, requests, app);
    terminal.backend().to_string()
}

#[test]
fn draw_shows_hardware_id_url_control_port_and_state_file() {
    let shown = shown(&view(), &App::default());

    assert!(shown.contains("Mock Kobo mock-ab12"), "{shown}");
    assert!(shown.contains("URL http://127.0.0.1:3000"), "{shown}");
    assert!(
        shown.contains("control API http://127.0.0.1:47431"),
        "{shown}"
    );
    assert!(
        shown.contains("state .claude/runtime/mock-kobo.json"),
        "{shown}"
    );
}

#[test]
fn draw_lists_each_book_with_its_authors() {
    let view = view_with_books(vec![
        ("b-1", book("Dune", &["Frank Herbert"], false)),
        (
            "b-2",
            book("Good Omens", &["Terry Pratchett", "Neil Gaiman"], false),
        ),
    ]);

    let shown = shown(&view, &App::default());

    assert!(shown.contains("Library (2)"), "{shown}");
    assert!(shown.contains("Dune — Frank Herbert"), "{shown}");
    assert!(
        shown.contains("Good Omens — Terry Pratchett, Neil Gaiman"),
        "{shown}"
    );
}

#[test]
fn draw_marks_archived_books() {
    let view = view_with_books(vec![
        ("b-1", book("Dune", &["Frank Herbert"], true)),
        ("b-2", book("Emma", &["Jane Austen"], false)),
    ]);

    let shown = shown(&view, &App::default());

    assert!(shown.contains("Dune — Frank Herbert (archived)"), "{shown}");
    assert!(!shown.contains("Emma — Jane Austen (archived)"), "{shown}");
}

#[test]
fn draw_shows_no_books_hint_when_library_empty() {
    let shown = shown(&view(), &App::default());

    assert!(shown.contains("Library (0)"), "{shown}");
    assert!(shown.contains("no books: press s to sync"), "{shown}");
}

#[test]
fn draw_shows_last_sync_never_before_first_sync() {
    let shown = shown(&view(), &App::default());

    assert!(shown.contains("last sync: never"), "{shown}");
}

#[test]
fn draw_shows_synced_pages_after_sync() {
    let view = DeviceView {
        last_sync: Some(LastSync::Synced { pages: 2 }),
        ..view()
    };

    let shown = shown(&view, &App::default());

    assert!(shown.contains("last sync: synced 2 page(s)"), "{shown}");
}

#[test]
fn draw_shows_failed_sync_message_after_failed_sync() {
    let message = "sync failed (StorePaths): /kobo/<token>/v1/user/profile answered 404 Not Found";
    let view = DeviceView {
        last_sync: Some(LastSync::Failed {
            quirk: Some(Quirk::StorePaths),
            message: message.to_owned(),
        }),
        ..view()
    };

    let shown = shown(&view, &App::default());

    assert!(shown.contains(&format!("last sync: {message}")), "{shown}");
}

#[test]
fn draw_shows_syncing_while_sync_runs() {
    let idle = shown(&view(), &App::default());
    let running = DeviceView {
        syncing: true,
        ..view()
    };

    let shown = shown(&running, &App::default());

    assert!(shown.contains("last sync: never · syncing…"), "{shown}");
    assert!(!idle.contains("syncing…"), "{idle}");
}

#[test]
fn draw_shows_newest_requests_when_log_overflows() {
    let requests: Vec<_> = (0..40)
        .map(|n| request("GET", &format!("/kobo/<token>/v1/step-{n:02}"), 200))
        .collect();

    let shown = shown_with_requests(&view(), &requests, &App::default());

    assert!(shown.contains("Requests (40)"), "{shown}");
    assert!(shown.contains("/v1/step-39 200"), "{shown}");
    assert!(!shown.contains("/v1/step-00 200"), "{shown}");
}

#[test]
fn draw_shows_request_method_path_and_status() {
    let requests = [
        request("GET", "/kobo/<token>/v1/initialization", 200),
        request("GET", "/kobo/<token>/v1/user/profile", 404),
    ];

    let shown = shown_with_requests(&view(), &requests, &App::default());

    assert!(
        shown.contains("GET /kobo/<token>/v1/initialization 200"),
        "{shown}"
    );
    assert!(
        shown.contains("GET /kobo/<token>/v1/user/profile 404"),
        "{shown}"
    );
}

#[test]
fn draw_shows_status_message() {
    let app = App {
        status: Some(Status::Info("sync complete".to_owned())),
        ..App::default()
    };

    let shown = shown(&view(), &app);

    assert!(shown.contains("sync complete"), "{shown}");
}

#[test]
fn draw_wraps_long_status_so_its_end_is_visible() {
    let app = App {
        status: Some(Status::Info(RESET_MESSAGE.to_owned())),
        ..App::default()
    };
    let mut terminal = terminal(120, 30);

    draw_screen(&mut terminal, &view(), &[], &app);

    let words = screen_rows(&terminal).join(" ");
    let words = words.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(words.contains(RESET_MESSAGE), "{words}");
}

#[test]
fn draw_styles_error_status_red() {
    let app = App {
        status: Some(Status::Error("invalid server URL: nope".to_owned())),
        ..App::default()
    };
    let mut terminal = terminal(100, 30);

    draw_screen(&mut terminal, &view(), &[], &app);

    let (x, y) = screen_rows(&terminal)
        .iter()
        .zip(0..)
        .find_map(|(row, y)| row.find("invalid server URL: nope").map(|x| (x as u16, y)))
        .expect("the error is on screen");
    assert_eq!(terminal.backend().buffer()[(x, y)].fg, Color::Red);
}

#[test]
fn draw_shows_edit_field_and_buffer_while_editing() {
    let app = editing(Field::Url, "http://127.0.0.1:3001");

    let shown = shown(&view(), &app);

    assert!(shown.contains("URL: http://127.0.0.1:3001"), "{shown}");
    assert!(shown.contains("Enter save · Esc cancel"), "{shown}");
    assert!(!shown.contains("s sync"), "{shown}");
}

#[test]
fn draw_labels_token_edit_as_token_while_editing() {
    let app = editing(Field::Token, "new-token");

    let shown = shown(&view(), &app);

    assert!(shown.contains("token: new-token"), "{shown}");
}

#[test]
fn draw_shows_key_help_in_normal_mode() {
    let shown = shown(&view(), &App::default());

    let help = "s sync · r reset · u edit URL · t edit token · w wire · q quit";
    assert!(shown.contains(help), "{shown}");
    assert!(!shown.contains("Enter save"), "{shown}");
}

#[test]
fn draw_puts_cursor_after_edit_buffer_while_editing() {
    let app = editing(Field::Url, "abc");
    let mut terminal = terminal(100, 30);

    draw_screen(&mut terminal, &view(), &[], &app);

    let position = terminal.get_cursor_position().unwrap();
    let row = terminal
        .backend()
        .to_string()
        .lines()
        .position(|line| line.contains("URL: abc"));
    assert_eq!(Some(usize::from(position.y)), row);
    assert_eq!(position.x, "URL: abc".len() as u16);
}

#[test]
fn draw_keeps_cursor_inside_a_terminal_narrower_than_the_edit() {
    let app = editing(Field::Token, "a-token-longer-than-the-terminal-is-wide");
    let mut terminal = terminal(12, 4);

    draw_screen(&mut terminal, &view(), &[], &app);

    let position = terminal.get_cursor_position().unwrap();
    assert!(position.x < 12, "{position:?}");
    assert!(position.y < 4, "{position:?}");
}
