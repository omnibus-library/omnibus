//! Drawing the reader: the open page (with its cursor underlined), or a
//! metadata-only view for a book that hasn't been downloaded. [`page_area`]
//! is the layout's only shared piece — the loop fits pagination to the same
//! rect this draws into, so a page never wraps differently than it's shown.

use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span as TextSpan};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

use crate::device::Book;
use crate::tui::reader::Reader;

const PAGE_HELP: &str = "←/→ page · [/] chapter · ↑/↓ cursor · Esc close";
const METADATA_HELP: &str = "Esc close";

/// The rect pages are fitted to: a one-line header and a one-line help
/// bracket the page itself.
pub fn page_area(frame: Rect) -> Rect {
    let [_, page, _] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Fill(1),
        Constraint::Length(1),
    ])
    .areas(frame);
    page
}

/// Draw the reader into `area`: the header line, the page or metadata view,
/// and the key help. `book` is the device's record for `reader.book`; a
/// book that vanished from the library mid-session draws blank.
pub fn draw(frame: &mut Frame, area: Rect, reader: &Reader, book: Option<&Book>) {
    let [header, body, help] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Fill(1),
        Constraint::Length(1),
    ])
    .areas(area);
    let Some(book) = book else {
        return;
    };
    match &reader.text {
        Some(kepub) => {
            let pages = reader.pages();
            let Some(page) = pages.get(reader.page) else {
                return;
            };
            draw_page_header(frame, header, book, reader, pages.len());
            draw_page(
                frame,
                body,
                &kepub.chapters[reader.chapter],
                page,
                reader.cursor,
            );
            frame.render_widget(Line::raw(PAGE_HELP), help);
        }
        None => {
            draw_metadata(frame, header.union(body), book);
            frame.render_widget(Line::raw(METADATA_HELP), help);
        }
    }
}

fn draw_page_header(
    frame: &mut Frame,
    area: Rect,
    book: &Book,
    reader: &Reader,
    page_count: usize,
) {
    let chapter_count = reader.text.as_ref().map_or(0, |kepub| kepub.chapters.len());
    let percent = reader
        .pages()
        .get(reader.page)
        .map_or(0, |p| u8::from(p.percent));
    let line = format!(
        "{} · ch {}/{chapter_count} · p {}/{page_count} · {percent}%",
        book.title,
        reader.chapter + 1,
        reader.page + 1,
    );
    frame.render_widget(Line::raw(line), area);
}

fn draw_page(
    frame: &mut Frame,
    area: Rect,
    chapter: &crate::kepub::Chapter,
    page: &crate::tui::reader::Page,
    cursor: usize,
) {
    let lines: Vec<Line> = page
        .lines
        .iter()
        .map(|range| {
            let mut spans = Vec::new();
            for (position, word_index) in range.clone().enumerate() {
                if position > 0 {
                    spans.push(TextSpan::raw(" "));
                }
                let word = &chapter.words[word_index];
                let style = if word_index == cursor {
                    Style::new().add_modifier(Modifier::UNDERLINED)
                } else {
                    Style::new()
                };
                spans.push(TextSpan::styled(word.text.clone(), style));
            }
            Line::from(spans)
        })
        .collect();
    frame.render_widget(Paragraph::new(lines), area);
}

/// The metadata-only view: title, authors, series, description, a
/// "not downloaded" line, and (when any) a waiting-highlights count
/// ([`crate::firmware::Quirk::AnnotationsUnheld`]).
fn draw_metadata(frame: &mut Frame, area: Rect, book: &Book) {
    let mut lines = vec![
        Line::styled(
            book.title.clone(),
            Style::new().add_modifier(Modifier::BOLD),
        ),
        Line::raw(book.authors.join(", ")),
    ];
    if let Some(series) = &book.series {
        lines.push(Line::raw(format!(
            "{} #{}",
            series.name,
            format_number(series.number)
        )));
    }
    if !book.description.is_empty() {
        lines.push(Line::raw(book.description.clone()));
    }
    lines.push(Line::raw("not downloaded"));
    if book.dropped_annotations > 0 {
        lines.push(Line::raw(format!(
            "{} highlights wait for the download",
            book.dropped_annotations
        )));
    }
    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: true }), area);
}

fn format_number(number: Option<f64>) -> String {
    number.map_or_else(String::new, |n| n.to_string())
}

#[cfg(test)]
mod tests;
