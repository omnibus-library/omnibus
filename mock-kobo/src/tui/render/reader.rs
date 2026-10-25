//! Drawing the reader: the open page (with its cursor underlined), or a
//! metadata-only view for a book that hasn't been downloaded. [`page_area`]
//! is the layout's only shared piece — the loop fits pagination to the same
//! rect this draws into, so a page never wraps differently than it's shown.

use std::collections::HashMap;

use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span as TextSpan};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

use crate::annotations::{span_range, Annotation, Swatch};
use crate::device::Book;
use crate::tui::app::Status;
use crate::tui::reader::{Page, Reader, ReaderView, Selection};

const PAGE_HELP: &str = "←/→ page · [/] chapter · ↑/↓ cursor · v select · h highlights · Esc close";
const SELECTION_HELP: &str = "←/→ extend · 1-4 highlight · n note · Esc cancel";
const HIGHLIGHTS_HELP: &str = "↓/↑ move · x delete · Esc back";
const METADATA_HELP: &str = "h highlights · Esc close";

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
/// book that vanished from the library mid-session draws blank. `status`
/// (BUSY, a failed job, a bookmark the book doesn't hold) borrows the help
/// line when set — the reader has no separate status row.
pub fn draw(
    frame: &mut Frame,
    area: Rect,
    reader: &Reader,
    book: Option<&Book>,
    status: Option<&Status>,
) {
    let [header, body, help] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Fill(1),
        Constraint::Length(1),
    ])
    .areas(area);
    let Some(book) = book else {
        return;
    };
    if let ReaderView::Highlights(selected) = &reader.view {
        let chapter = reader
            .text
            .as_ref()
            .map(|kepub| &kepub.chapters[reader.chapter]);
        draw_highlights_list(
            frame,
            header.union(body),
            chapter,
            &reader.annotations,
            *selected,
        );
        draw_help_line(frame, help, HIGHLIGHTS_HELP, status);
        return;
    }
    match &reader.text {
        Some(kepub) => {
            let pages = reader.pages();
            let Some(page) = pages.get(reader.page) else {
                return;
            };
            draw_page_header(frame, header, book, reader, page, pages.len());
            let chapter = &kepub.chapters[reader.chapter];
            match &reader.view {
                ReaderView::Highlights(_) => unreachable!("handled above"),
                ReaderView::Note(buffer) => {
                    draw_page(
                        frame,
                        body,
                        chapter,
                        page,
                        reader.cursor,
                        reader.selection.as_ref(),
                        &reader.annotations,
                    );
                    super::draw_prompt(frame, help, "note", buffer);
                }
                ReaderView::Page => {
                    draw_page(
                        frame,
                        body,
                        chapter,
                        page,
                        reader.cursor,
                        reader.selection.as_ref(),
                        &reader.annotations,
                    );
                    let help_line = if reader.selection.is_some() {
                        SELECTION_HELP
                    } else {
                        PAGE_HELP
                    };
                    draw_help_line(frame, help, help_line, status);
                }
            }
        }
        None => {
            draw_metadata(frame, header.union(body), book);
            draw_help_line(frame, help, METADATA_HELP, status);
        }
    }
}

/// `help` normally, or `status` instead when one is set.
fn draw_help_line(frame: &mut Frame, area: Rect, help: &str, status: Option<&Status>) {
    match status {
        Some(status) => frame.render_widget(super::status_line(status), area),
        None => frame.render_widget(Line::raw(help), area),
    }
}

fn draw_page_header(
    frame: &mut Frame,
    area: Rect,
    book: &Book,
    reader: &Reader,
    page: &Page,
    page_count: usize,
) {
    let chapter_count = reader.text.as_ref().map_or(0, |kepub| kepub.chapters.len());
    let percent = u8::from(page.percent);
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
    selection: Option<&Selection>,
    annotations: &[Annotation],
) {
    let colors = highlight_colors(chapter, annotations);
    let lines: Vec<Line> = page
        .lines
        .iter()
        .map(|range| {
            let mut spans = Vec::new();
            for (position, word_index) in range.clone().enumerate() {
                let word = &chapter.words[word_index];
                if position > 0 && !word.glued {
                    spans.push(TextSpan::raw(" "));
                }
                let mut style = Style::new();
                if let Some(&swatch) = colors.get(&word_index) {
                    style = style.bg(swatch_color(swatch)).fg(Color::Black);
                }
                if selection.is_some_and(|s| (s.start..=s.end).contains(&word_index)) {
                    style = style.add_modifier(Modifier::REVERSED);
                }
                if word_index == cursor {
                    style = style.add_modifier(Modifier::UNDERLINED);
                }
                spans.push(TextSpan::styled(word.text.clone(), style));
            }
            Line::from(spans)
        })
        .collect();
    frame.render_widget(Paragraph::new(lines), area);
}

/// Every word `annotations` covers, mapped to its swatch — the last
/// annotation covering a word wins on an (unlikely) overlap.
fn highlight_colors(
    chapter: &crate::kepub::Chapter,
    annotations: &[Annotation],
) -> HashMap<usize, Swatch> {
    let mut colors = HashMap::new();
    for annotation in annotations {
        let Some(range) = span_range(&annotation.location) else {
            continue;
        };
        let Some(words) = chapter.covered_words(&range) else {
            continue;
        };
        for word in words {
            colors.insert(word, annotation.color);
        }
    }
    colors
}

/// A swatch's inline background, with a black foreground on top (set by the caller).
fn swatch_color(swatch: Swatch) -> Color {
    match swatch {
        Swatch::Yellow => Color::Yellow,
        Swatch::Pink => Color::Magenta,
        Swatch::Blue => Color::Cyan,
        Swatch::Green => Color::Green,
    }
}

/// The highlights list: each row's colour, text and note, `(not placed)`
/// when the chapter can't locate it (never shown without a chapter — a
/// metadata-only book can't say either way); "no highlights on this book"
/// when empty. Scrolls so the selected row stays visible, the same way the
/// library list does.
fn draw_highlights_list(
    frame: &mut Frame,
    area: Rect,
    chapter: Option<&crate::kepub::Chapter>,
    annotations: &[Annotation],
    selected: usize,
) {
    if annotations.is_empty() {
        frame.render_widget(Line::raw("no highlights on this book"), area);
        return;
    }
    let lines: Vec<Line> = annotations
        .iter()
        .enumerate()
        .map(|(index, annotation)| {
            let suffix = match chapter {
                Some(chapter) => {
                    let placed = span_range(&annotation.location)
                        .and_then(|range| chapter.covered_words(&range))
                        .is_some();
                    if placed {
                        ""
                    } else {
                        " (not placed)"
                    }
                }
                None => "",
            };
            let note_part = annotation
                .note
                .as_deref()
                .map(|note| format!(" — {note}"))
                .unwrap_or_default();
            let text = format!(
                "[{}] \"{}\"{note_part}{suffix}",
                annotation.color.name(),
                annotation.text
            );
            if index == selected {
                Line::styled(text, Style::new().add_modifier(Modifier::BOLD))
            } else {
                Line::raw(text)
            }
        })
        .collect();
    let rows = usize::from(area.height);
    let offset = selected.saturating_sub(rows.saturating_sub(1));
    let offset = u16::try_from(offset).unwrap_or(u16::MAX);
    frame.render_widget(Paragraph::new(lines).scroll((offset, 0)), area);
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
        let number = series.number.map_or_else(String::new, |n| n.to_string());
        lines.push(Line::raw(format!("{} #{number}", series.name)));
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

#[cfg(test)]
mod tests;
