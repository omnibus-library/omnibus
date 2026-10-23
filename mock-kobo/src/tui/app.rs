//! The TUI's state machine: a key press in, the job it asks for out.
//! Nothing here touches the terminal or the device, so every key is a unit test.
//! Work that waits on the device or the network is handed back as a [`Job`],
//! and the app refuses another until [`App::finish`] reports the first.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use crate::cli;
use crate::reading::Percent;

/// What a key press asks of the loop.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    Quit,
    Run(Job),
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
    /// Send the selected book's position; the TUI never supplies a `KoboSpan` (#2738 does).
    Read {
        book: String,
        percent: Percent,
    },
    /// Mark the selected book finished.
    Finish(String),
    /// Clear the selected book's downloaded flag, locally.
    RemoveDownload(String),
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
}

/// Whether keys are commands or text for a field.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Mode {
    #[default]
    Normal,
    Editing(Edit),
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
            return self.quit();
        }
        match self.mode {
            Mode::Normal => self.on_normal_key(key, current_url),
            Mode::Editing(_) => self.on_edit_key(key, current_url),
        }
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
fn typed_char(key: KeyEvent) -> Option<char> {
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
