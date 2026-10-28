//! The startup prompt `mock-kobo tui` shows when it isn't told where to sync:
//! one line for the device's sync URL, taken before the device exists. `Prompt`
//! is the key state machine and needs no terminal; `run` is the thin glue.

use std::io;

use ratatui::crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind};
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Style};
use ratatui::text::Line;
use ratatui::{DefaultTerminal, Frame};

use crate::cli::{self, SyncUrl};
use crate::tui::app::{is_ctrl_c, typed_char};
use crate::tui::render;

/// How a key ended the prompt.
#[derive(Debug, PartialEq, Eq)]
pub enum PromptOutcome {
    Submit(SyncUrl),
    Quit,
}

/// The sync URL typed so far, and why the last attempt to submit it was refused.
#[derive(Debug, Default)]
pub struct Prompt {
    pub buffer: String,
    pub error: Option<String>,
}

impl Prompt {
    /// Edit the buffer, submit it on Enter if it is a sync URL, or quit on Esc and Ctrl-C.
    pub fn on_key(&mut self, key: KeyEvent) -> Option<PromptOutcome> {
        if key.kind != KeyEventKind::Press {
            return None;
        }
        if is_ctrl_c(key) {
            return Some(PromptOutcome::Quit);
        }
        match key.code {
            KeyCode::Esc => return Some(PromptOutcome::Quit),
            KeyCode::Enter => return self.submit(),
            KeyCode::Backspace => {
                self.buffer.pop();
                self.error = None;
            }
            _ => {
                if let Some(c) = typed_char(key) {
                    self.buffer.push(c);
                    self.error = None;
                }
            }
        }
        None
    }

    fn submit(&mut self) -> Option<PromptOutcome> {
        match cli::valid_sync_url(self.buffer.clone()) {
            Ok(sync_url) => Some(PromptOutcome::Submit(sync_url)),
            Err(error) => {
                self.error = Some(error.to_string());
                None
            }
        }
    }

    fn draw(&self, frame: &mut Frame) {
        let [title, hint, input, error, help] =
            Layout::vertical([Constraint::Length(1); 5]).areas(frame.area());
        frame.render_widget(Line::raw("Mock Kobo"), title);
        frame.render_widget(
            Line::raw("Paste the device's sync URL from Omnibus (Settings > Devices)."),
            hint,
        );
        render::draw_prompt(frame, input, "Sync URL", &self.buffer);
        if let Some(message) = &self.error {
            frame.render_widget(
                Line::styled(message.as_str(), Style::new().fg(Color::Red)),
                error,
            );
        }
        frame.render_widget(Line::raw("Enter connect · Esc quit"), help);
    }
}

/// Take over the terminal until a valid sync URL is entered (`Some`) or the user quits (`None`).
pub fn run() -> io::Result<Option<SyncUrl>> {
    super::with_terminal(ask)
}

fn ask(terminal: &mut DefaultTerminal) -> io::Result<Option<SyncUrl>> {
    let mut prompt = Prompt::default();
    loop {
        terminal.draw(|frame| prompt.draw(frame))?;
        let Event::Key(key) = event::read()? else {
            continue;
        };
        match prompt.on_key(key) {
            Some(PromptOutcome::Submit(sync_url)) => return Ok(Some(sync_url)),
            Some(PromptOutcome::Quit) => return Ok(None),
            None => {}
        }
    }
}

#[cfg(test)]
mod tests;
