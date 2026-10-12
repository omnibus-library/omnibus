//! Drawing the TUI screen: a [`Screen`] snapshot in, one frame out.
//! The loop gathers a `Screen` each tick, so drawing never reads the device or
//! does I/O. Each section of the frame is its own helper.

use std::path::Path;

use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Line;
use ratatui::widgets::{Block, Paragraph, Wrap};
use ratatui::Frame;

use crate::client::RequestRecord;
use crate::control::{DeviceView, LastSync};
use crate::device::Book;
use crate::tui::app::{App, Edit, Field, Mode, Status};

const HELP: &str = "s sync · r reset · u edit URL · t edit token · w wire · q quit";
const EDIT_HELP: &str = "Enter save · Esc cancel";

/// Rows the status line may wrap onto before the rest is cut.
const STATUS_ROWS: u16 = 3;

/// Everything one frame shows, read once per tick.
pub struct Screen<'a> {
    pub view: &'a DeviceView,
    pub requests: &'a [RequestRecord],
    pub port: u16,
    pub state: &'a Path,
    pub app: &'a App,
}

/// Draw `screen`: header, library, last sync, request log, status line, key help.
pub fn draw(frame: &mut Frame, screen: &Screen) {
    let [header, library, last_sync, requests, footer] = Layout::vertical([
        Constraint::Length(4),
        Constraint::Percentage(35),
        Constraint::Length(1),
        Constraint::Fill(1),
        Constraint::Length(STATUS_ROWS + 2),
    ])
    .areas(frame.area());
    draw_header(frame, header, screen);
    draw_library(frame, library, screen.view);
    draw_last_sync(frame, last_sync, screen.view);
    draw_requests(frame, requests, screen.requests);
    draw_footer(frame, footer, screen.app);
}

fn draw_header(frame: &mut Frame, area: Rect, screen: &Screen) {
    let title = Style::new().add_modifier(Modifier::BOLD);
    let lines = vec![
        Line::styled(format!("Mock Kobo {}", screen.view.hardware_id), title),
        Line::raw(format!("URL {}", screen.view.url)),
        Line::raw(format!("control API http://127.0.0.1:{}", screen.port)),
        Line::raw(format!("state {}", screen.state.display())),
    ];
    frame.render_widget(Paragraph::new(lines), area);
}

fn draw_library(frame: &mut Frame, area: Rect, view: &DeviceView) {
    let lines: Vec<Line> = if view.library.is_empty() {
        vec![Line::raw("no books: press s to sync")]
    } else {
        view.library.values().map(book_line).collect()
    };
    let block = Block::bordered().title(format!("Library ({})", view.library.len()));
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn book_line(book: &Book) -> Line<'static> {
    let archived = if book.archived { " (archived)" } else { "" };
    let authors = book.authors.join(", ");
    Line::raw(format!("{} — {authors}{archived}", book.title))
}

fn draw_last_sync(frame: &mut Frame, area: Rect, view: &DeviceView) {
    let outcome = match &view.last_sync {
        None => "never".to_owned(),
        Some(LastSync::Synced { pages }) => format!("synced {pages} page(s)"),
        Some(LastSync::Failed { message, .. }) => message.clone(),
    };
    let syncing = if view.syncing { " · syncing…" } else { "" };
    frame.render_widget(Line::raw(format!("last sync: {outcome}{syncing}")), area);
}

/// The newest requests that fit, oldest first, so the latest sits at the bottom.
fn draw_requests(frame: &mut Frame, area: Rect, requests: &[RequestRecord]) {
    let block = Block::bordered().title(format!("Requests ({})", requests.len()));
    let rows = usize::from(block.inner(area).height);
    let lines: Vec<Line> = requests
        .iter()
        .skip(requests.len().saturating_sub(rows))
        .map(|r| Line::raw(format!("{} {} {}", r.method, r.path, r.status)))
        .collect();
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

/// The status message (wrapped), the edit prompt while editing, and the key help.
fn draw_footer(frame: &mut Frame, area: Rect, app: &App) {
    let [status_area, edit_area, help_area] = Layout::vertical([
        Constraint::Length(STATUS_ROWS),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .areas(area);
    if let Some(status) = &app.status {
        let wrapped = Paragraph::new(status_line(status)).wrap(Wrap { trim: true });
        frame.render_widget(wrapped, status_area);
    }
    match &app.mode {
        Mode::Normal => frame.render_widget(Line::raw(HELP), help_area),
        Mode::Editing(edit) => {
            draw_edit(frame, edit_area, edit);
            frame.render_widget(Line::raw(EDIT_HELP), help_area);
        }
    }
}

fn status_line(status: &Status) -> Line<'_> {
    match status {
        Status::Info(message) => Line::raw(message.as_str()),
        Status::Error(message) => Line::styled(message.as_str(), Style::new().fg(Color::Red)),
    }
}

/// The prompt, with the terminal cursor after what has been typed (kept on screen).
fn draw_edit(frame: &mut Frame, area: Rect, edit: &Edit) {
    let label = match edit.field {
        Field::Url => "URL",
        Field::Token => "token",
    };
    let prompt = Line::raw(format!("{label}: {}", edit.buffer));
    let typed = u16::try_from(prompt.width()).unwrap_or(u16::MAX);
    let x = area
        .x
        .saturating_add(typed)
        .min(area.right().saturating_sub(1));
    frame.set_cursor_position((x, area.y));
    frame.render_widget(prompt, area);
}

#[cfg(test)]
mod tests;
