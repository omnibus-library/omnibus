//! The TUI's state machine: a key press in, the job it asks for out.
//! Nothing here touches the terminal or the device, so every key is a unit test.
//! Work that waits on the device or the network is handed back as a [`Job`],
//! and the app refuses another until [`App::finish`] reports the first.

use std::collections::BTreeMap;

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use crate::annotations::NewHighlight;
use crate::cli;
use crate::device::Book;
use crate::kepub::Kepub;
use crate::reading::{KoboSpan, Percent};
use crate::tui::reader::{Reader, ReaderAction};

/// What a key press asks of the loop.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    Quit,
    Run(Job),
    /// Open the named book's reader; local, so never refused while a job runs.
    Open(String),
}

/// Work that waits on the device or the network, so it never runs on the draw loop.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Job {
    Sync,
    Reset,
    /// An origin `cli::valid_url` already reduced.
    SetUrl(String),
    /// A token `cli::valid_token` already accepted.
    SetToken(String),
    /// Auto-wire a token for the device's current URL.
    Wire,
    /// Download the selected book.
    Download(String),
    /// Send the selected book's position. The percent edit sends `None`;
    /// the reader view sends the open page's span (see `tui::reader`).
    Read {
        book: String,
        percent: Percent,
        location: Option<KoboSpan>,
    },
    /// Mark the selected book finished.
    Finish(String),
    /// Clear the selected book's downloaded flag, locally.
    RemoveDownload(String),
    /// Make a highlight on the selected book.
    Highlight {
        book: String,
        highlight: NewHighlight,
    },
    /// Delete one of the reader's listed highlights, by id.
    DeleteHighlight {
        book: String,
        highlight: String,
    },
}

/// Shown for `d`/`f`/`x`/`p` with no book selected.
const NO_BOOK: &str = "no books to act on: press s to sync first";

/// What the screen is doing besides showing the device.
#[derive(Debug, Default)]
pub struct App {
    pub mode: Mode,
    /// The last thing worth telling the user, if anything.
    pub status: Option<Status>,
    /// A job is running; another is refused until `finish`.
    pub busy: bool,
    /// Quit was asked for while a job ran; it happens when the job finishes.
    pub(super) quit_deferred: bool,
    /// The library's uuids in screen order, as of the last `show_library`.
    pub books: Vec<String>,
    /// Index into `books`; clamped whenever the library changes.
    pub selected: usize,
    /// The device's own `syncing` flag as of the last tick — a sync begun
    /// over the control API by someone else, distinct from `busy` (a job
    /// this app itself started).
    pub device_syncing: bool,
}

/// Whether keys are commands or text for a field, or the reader is open.
/// `Reading` is boxed to keep this small — clippy's `large_enum_variant`.
/// Not `Eq`: `Reader` isn't either.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum Mode {
    #[default]
    Normal,
    Editing(Edit),
    Reading(Box<Reader>),
}

/// A field being typed into.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Edit {
    pub field: Field,
    pub buffer: String,
}

/// Which setting an edit changes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Field {
    Url,
    Token,
    /// A percent for the book (uuid) this edit was opened on.
    Percent(String),
}

/// The line under the device: how the last action went.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Status {
    Info(String),
    Error(String),
}

/// Shown when a job key arrives while another job runs.
pub const BUSY: &str = "still working on the last action; try again when it finishes";

/// Shown when the first quit key arrives while a job runs.
const QUIT_DEFERRED: &str = "finishing the last action, then quitting; press q again to quit now";

impl App {
    /// A fresh screen; `notice`, if any, is the first status.
    pub fn new(notice: Option<String>) -> Self {
        Self {
            status: notice.map(Status::Info),
            ..Self::default()
        }
    }

    /// Act on `key`; `current_url` prefills the URL edit. Only presses act.
    pub fn on_key(&mut self, key: KeyEvent, current_url: &str) -> Option<Action> {
        if key.kind != KeyEventKind::Press {
            return None;
        }
        if is_ctrl_c(key) {
            return self.quit_from_reading().or_else(|| self.quit());
        }
        match self.mode {
            Mode::Normal => self.on_normal_key(key, current_url),
            Mode::Editing(_) => self.on_edit_key(key, current_url),
            Mode::Reading(_) => self.on_reading_key(key),
        }
    }

    /// Ctrl-C from `Mode::Reading` with a downloaded book first sends the
    /// open page's close job, same as Esc, so the last position is never
    /// lost on exit; `None` leaves the normal quit path (any other mode,
    /// a device mid-exchange, or a metadata-only book with no job to send)
    /// to run instead.
    fn quit_from_reading(&mut self) -> Option<Action> {
        let Mode::Reading(reader) = &self.mode else {
            return None;
        };
        if self.device_syncing || reader.text.is_none() {
            return None;
        }
        let ReaderAction::Close(Some(job)) = reader.close() else {
            return None;
        };
        let action = self.start(job);
        if action.is_some() {
            self.mode = Mode::Normal;
            self.quit_deferred = true;
        }
        action
    }

    /// A job ended: the app takes jobs again and shows how it went.
    pub fn finish(&mut self, status: Status) {
        self.busy = false;
        self.status = Some(status);
    }

    /// Take in this tick's library, in screen order, clamping the selection to it.
    pub fn show_library(&mut self, uuids: Vec<String>) {
        self.books = uuids;
        self.selected = self.selected.min(self.books.len().saturating_sub(1));
    }

    /// The uuid the selection marker sits on, if the library isn't empty.
    pub fn selected_book(&self) -> Option<&str> {
        self.books.get(self.selected).map(String::as_str)
    }

    /// Whether a quit asked for while a job ran can happen now that it has finished.
    pub fn quit_requested(&self) -> bool {
        self.quit_deferred && !self.busy
    }

    fn on_normal_key(&mut self, key: KeyEvent, current_url: &str) -> Option<Action> {
        match key.code {
            KeyCode::Up => {
                self.move_selection(-1);
                return None;
            }
            KeyCode::Down => {
                self.move_selection(1);
                return None;
            }
            KeyCode::Enter => return self.open_selected(),
            _ => {}
        }
        // Caps Lock or Shift must not silence a command key.
        let job = match typed_char(key)?.to_ascii_lowercase() {
            'q' => return self.quit(),
            'u' => {
                self.open_edit(Field::Url, current_url);
                return None;
            }
            't' => {
                self.open_edit(Field::Token, "");
                return None;
            }
            'p' => return self.open_percent_edit(),
            's' => Job::Sync,
            'r' => Job::Reset,
            'w' => Job::Wire,
            'd' => return self.book_action(Job::Download),
            'f' => return self.book_action(Job::Finish),
            'x' => return self.book_action(Job::RemoveDownload),
            _ => return None,
        };
        self.start(job)
    }

    /// Move the selection by `delta`, wrapping; a no-op on an empty library.
    fn move_selection(&mut self, delta: i32) {
        let Some(len) = i32::try_from(self.books.len()).ok().filter(|n| *n > 0) else {
            return;
        };
        let current = i32::try_from(self.selected).unwrap_or(0);
        self.selected = (current + delta).rem_euclid(len) as usize;
    }

    /// Start `make_job(selected uuid)`, or show [`NO_BOOK`] with nothing selected.
    fn book_action(&mut self, make_job: impl FnOnce(String) -> Job) -> Option<Action> {
        let Some(book) = self.selected_book().map(str::to_owned) else {
            self.status = Some(Status::Error(NO_BOOK.to_owned()));
            return None;
        };
        self.start(make_job(book))
    }

    /// Open the percent edit for the selected book, or show [`NO_BOOK`].
    fn open_percent_edit(&mut self) -> Option<Action> {
        let Some(book) = self.selected_book().map(str::to_owned) else {
            self.status = Some(Status::Error(NO_BOOK.to_owned()));
            return None;
        };
        self.open_edit(Field::Percent(book), "");
        None
    }

    /// Open the selected book's reader, or show [`NO_BOOK`]. Opening is
    /// local, so it is not refused while a job runs.
    fn open_selected(&mut self) -> Option<Action> {
        let Some(book) = self.selected_book().map(str::to_owned) else {
            self.status = Some(Status::Error(NO_BOOK.to_owned()));
            return None;
        };
        Some(Action::Open(book))
    }

    /// Dispatch a key to the open reader; its close/run becomes a job the
    /// same way an edit's save does, so a busy refusal keeps the reader
    /// open. A key that would close or commit is refused *before* it
    /// reaches the reader — not just by `start`'s own busy check — so a
    /// refusal while busy or while the device reports its own exchange
    /// never drops the page position or an open selection the way
    /// `reader.on_key` consuming it first would.
    fn on_reading_key(&mut self, key: KeyEvent) -> Option<Action> {
        let Mode::Reading(reader) = &mut self.mode else {
            return None;
        };
        if (self.busy || self.device_syncing) && reader.commits_on(key) {
            self.status = Some(Status::Error(BUSY.to_owned()));
            return None;
        }
        match reader.on_key(key)? {
            ReaderAction::Close(None) => {
                self.mode = Mode::Normal;
                None
            }
            ReaderAction::Close(Some(job)) => {
                let action = self.start(job);
                if action.is_some() {
                    self.mode = Mode::Normal;
                }
                action
            }
            ReaderAction::Run(job) => self.start(job),
        }
    }

    /// Enter's reader load finished: `Ok(Some(kepub))` opens the full
    /// reader, `Ok(None)` the metadata-only view, `Err(message)` reports it
    /// and the library stays open.
    pub fn open_book(&mut self, book: String, text: Result<Option<Kepub>, String>) {
        match text {
            Ok(kepub) => self.mode = Mode::Reading(Box::new(Reader::open(book, kepub))),
            Err(message) => self.status = Some(Status::Error(message)),
        }
    }

    /// Re-fit the open reader's pagination to `width`×`rows`; a no-op outside `Mode::Reading`.
    pub fn fit_reader(&mut self, width: u16, rows: u16) {
        if let Mode::Reading(reader) = &mut self.mode {
            reader.fit(width, rows);
        }
    }

    /// Called every tick: move the open reader to the span a newer device
    /// bookmark names. A no-op outside `Mode::Reading`, for a metadata-only
    /// book, for a book the library no longer holds, for one with no
    /// bookmark, or for a bookmark no newer than the stamp the reader last
    /// placed itself on (so the reader's own page turns are never undone).
    /// A location the book's text doesn't hold records the stamp (so the
    /// error shows once, not every tick) and reports it; one with no
    /// location also just records the stamp.
    pub fn show_book(&mut self, library: &BTreeMap<String, Book>) {
        let Mode::Reading(reader) = &mut self.mode else {
            return;
        };
        let Some(kepub) = &reader.text else {
            return;
        };
        let Some(book) = library.get(&reader.book) else {
            return;
        };
        reader.annotations = book.annotations.clone();
        let Some(bookmark) = book.reading.bookmark.as_ref() else {
            return;
        };
        if !reader.is_newer_than_placed(bookmark.modified) {
            return;
        }
        let Some(location) = &bookmark.location else {
            reader.record_placed(bookmark.modified);
            return;
        };
        match kepub.locate_span(&location.source, &location.value) {
            Some((chapter, span)) => reader.place_at_span(chapter, span, bookmark.modified),
            None => {
                let message = format!(
                    "the device's bookmark {} in {} is not in this book",
                    location.value, location.source
                );
                reader.record_placed(bookmark.modified);
                self.status = Some(Status::Error(message));
            }
        }
    }

    fn on_edit_key(&mut self, key: KeyEvent, current_url: &str) -> Option<Action> {
        let Mode::Editing(edit) = &mut self.mode else {
            return None;
        };
        match key.code {
            KeyCode::Esc => self.mode = Mode::Normal,
            KeyCode::Backspace => {
                edit.buffer.pop();
            }
            KeyCode::Enter => return self.save_edit(current_url),
            _ => {
                if let Some(c) = typed_char(key) {
                    edit.buffer.push(c);
                }
            }
        }
        None
    }

    fn open_edit(&mut self, field: Field, buffer: &str) {
        self.mode = Mode::Editing(Edit {
            field,
            buffer: buffer.to_owned(),
        });
    }

    /// Validate the open edit with the command line's rules and start its job;
    /// on a refusal the edit stays open so the user can fix it. A URL equal to
    /// `current_url` changes nothing, so it closes the edit like Esc.
    fn save_edit(&mut self, current_url: &str) -> Option<Action> {
        let Mode::Editing(edit) = &self.mode else {
            return None;
        };
        let buffer = edit.buffer.clone();
        let job: Result<Job, String> = match &edit.field {
            Field::Url => cli::valid_url(buffer)
                .map(Job::SetUrl)
                .map_err(|e| e.to_string()),
            Field::Token => cli::valid_token(buffer)
                .map(Job::SetToken)
                .map_err(|e| e.to_string()),
            Field::Percent(book) => parse_percent(&buffer)
                .map(|percent| Job::Read {
                    book: book.clone(),
                    percent,
                    location: None,
                })
                .ok_or_else(|| format!("{buffer} is not a whole number 0..=100")),
        };
        match job {
            Ok(Job::SetUrl(url)) if url == current_url => {
                self.mode = Mode::Normal;
                None
            }
            Ok(job) => {
                let action = self.start(job);
                if action.is_some() {
                    self.mode = Mode::Normal;
                }
                action
            }
            Err(error) => {
                self.status = Some(Status::Error(error));
                None
            }
        }
    }

    /// Hand `job` to the loop, or turn it away while another runs.
    fn start(&mut self, job: Job) -> Option<Action> {
        if self.busy {
            return self.refuse_busy();
        }
        self.busy = true;
        self.status = None;
        Some(Action::Run(job))
    }

    /// Quit now; while a job runs, wait for it unless this is the second ask.
    fn quit(&mut self) -> Option<Action> {
        if self.busy && !self.quit_deferred {
            self.quit_deferred = true;
            self.status = Some(Status::Info(QUIT_DEFERRED.to_owned()));
            return None;
        }
        Some(Action::Quit)
    }

    fn refuse_busy(&mut self) -> Option<Action> {
        self.status = Some(Status::Error(BUSY.to_owned()));
        None
    }
}

/// Raw mode swallows SIGINT, so Ctrl-C arrives as a key.
fn is_ctrl_c(key: KeyEvent) -> bool {
    key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL)
}

/// `buffer` as a whole-number percent, trimmed first.
fn parse_percent(buffer: &str) -> Option<Percent> {
    buffer.trim().parse::<u8>().ok().and_then(Percent::new)
}

/// The character `key` types, unless Ctrl or Alt made it a shortcut instead.
/// Shared with the reader's note view, so the two never disagree on what
/// counts as a shortcut versus typed text.
pub(crate) fn typed_char(key: KeyEvent) -> Option<char> {
    let shortcut = key
        .modifiers
        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT);
    match key.code {
        KeyCode::Char(c) if !shortcut => Some(c),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
