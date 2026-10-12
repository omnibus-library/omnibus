//! The TUI's state machine: a key press in, the job it asks for out.
//! Nothing here touches the terminal or the device, so every key is a unit test.
//! Work that waits on the device or the network is handed back as a [`Job`],
//! and the app refuses another until [`App::finish`] reports the first.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use crate::cli;

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
}

/// What the screen is doing besides showing the device.
#[derive(Debug, Default)]
pub struct App {
    pub mode: Mode,
    /// The last thing worth telling the user, if anything.
    pub status: Option<Status>,
    /// A job is running; another is refused until `finish`.
    pub busy: bool,
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Field {
    Url,
    Token,
}

/// The line under the device: how the last action went.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Status {
    Info(String),
    Error(String),
}

/// Shown when a job key arrives while another job runs.
pub const BUSY: &str = "still working on the last action; try again when it finishes";

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
            return Some(Action::Quit);
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

    fn on_normal_key(&mut self, key: KeyEvent, current_url: &str) -> Option<Action> {
        // Caps Lock or Shift must not silence a command key.
        let job = match typed_char(key)?.to_ascii_lowercase() {
            'q' => return Some(Action::Quit),
            'u' => {
                self.open_edit(Field::Url, current_url);
                return None;
            }
            't' => {
                self.open_edit(Field::Token, "");
                return None;
            }
            's' => Job::Sync,
            'r' => Job::Reset,
            'w' => Job::Wire,
            _ => return None,
        };
        self.start(job)
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
        let job = match edit.field {
            Field::Url => cli::valid_url(buffer).map(Job::SetUrl),
            Field::Token => cli::valid_token(buffer).map(Job::SetToken),
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
                self.status = Some(Status::Error(error.to_string()));
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

    fn refuse_busy(&mut self) -> Option<Action> {
        self.status = Some(Status::Error(BUSY.to_owned()));
        None
    }
}

/// Raw mode swallows SIGINT, so Ctrl-C arrives as a key.
fn is_ctrl_c(key: KeyEvent) -> bool {
    key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL)
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
