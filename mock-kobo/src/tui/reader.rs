//! The reader's own state machine: pagination, the current page and cursor,
//! and the keys that move them. Nothing here touches the terminal or the
//! device — a page turn or a close is a pure function of the key and the
//! open book, same as [`super::app`] is for the library.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind};
use ratatui::text::Span as TextSpan;

use crate::annotations::Swatch;
use crate::kepub::{Chapter, Kepub};
use crate::reading::Percent;
use crate::tui::app::{typed_char, Job};

/// One screenful of a chapter: which word-index lines it holds, the span of
/// its first word, and that span's book percent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Page {
    /// Word-index ranges, one per line, into the chapter's `words`.
    pub lines: Vec<std::ops::RangeInclusive<usize>>,
    /// Index into the chapter's `spans` that the page's first word belongs to.
    pub span: usize,
    pub percent: Percent,
}

/// What closing, or a selection, hands back to the app.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReaderAction {
    /// Esc on the page view: the reader's own `Job::Read` (a downloaded
    /// book), or none (metadata-only).
    Close(Option<Job>),
    /// A job the reader made while staying open (a highlight).
    Run(Job),
}

/// A word-by-word selection in progress: `start`/`end` are absolute word
/// indices (inclusive, `start <= end`), and the note the `n` view attached, if any.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Selection {
    pub start: usize,
    pub end: usize,
    pub note: Option<String>,
}

/// What the reader's body is showing, besides the open page itself.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub enum ReaderView {
    #[default]
    Page,
    /// Typing a note for the open selection; the buffer typed so far.
    Note(String),
    /// The book's highlights list; the selected row.
    Highlights(usize),
}

/// An open book: its text (`None` for metadata-only), where the reader is,
/// and the size it last fit to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reader {
    pub book: String,
    pub text: Option<Kepub>,
    pub chapter: usize,
    /// Index into `pages()`'s result for `chapter`.
    pub page: usize,
    /// Absolute word index (into the chapter's `words`) the cursor sits on.
    pub cursor: usize,
    width: u16,
    rows: u16,
    /// The `modified` stamp of the last device bookmark `App::show_book`
    /// placed this reader on; `None` (older than any real stamp) before
    /// the first one, so a reader just opened on its own always takes it.
    placed_at: Option<i64>,
    pub view: ReaderView,
    /// A word selection in progress on the open page, started by `v`.
    pub selection: Option<Selection>,
}

impl Reader {
    /// Open `book` at its first page; `text: None` is a metadata-only book.
    pub fn open(book: String, text: Option<Kepub>) -> Self {
        Self {
            book,
            text,
            chapter: 0,
            page: 0,
            cursor: 0,
            width: 0,
            rows: 0,
            placed_at: None,
            view: ReaderView::Page,
            selection: None,
        }
    }

    /// Whether `modified` is newer than the stamp this reader last placed
    /// itself on — `None` counts as older than any real stamp.
    pub fn is_newer_than_placed(&self, modified: i64) -> bool {
        self.placed_at.is_none_or(|placed| modified > placed)
    }

    /// Record `modified` as placed without moving — a bookmark with no
    /// location, or one naming a span this book doesn't hold.
    pub fn record_placed(&mut self, modified: i64) {
        self.placed_at = Some(modified);
    }

    /// Move to `chapter`'s `span` (its first word) and record `modified` as
    /// placed. A no-op past the chapter's own bounds (the caller already
    /// checked `Kepub::locate_span`, so this never happens in practice).
    pub fn place_at_span(&mut self, chapter: usize, span: usize, modified: i64) {
        self.chapter = chapter;
        self.cursor = self
            .text
            .as_ref()
            .and_then(|kepub| kepub.chapters.get(chapter))
            .and_then(|text| text.words.iter().position(|w| w.span == span))
            .unwrap_or(0);
        self.placed_at = Some(modified);
        self.sync_page();
    }

    /// Re-paginate the current chapter to `width`×`rows` and keep the page
    /// holding `cursor`'s word on screen.
    pub fn fit(&mut self, width: u16, rows: u16) {
        self.width = width;
        self.rows = rows;
        self.sync_page();
    }

    /// This chapter's pages at the reader's last-fit size; empty for a
    /// metadata-only book or before the first `fit`.
    pub fn pages(&self) -> Vec<Page> {
        match &self.text {
            Some(kepub) if self.chapter < kepub.chapters.len() => {
                paginate(kepub, self.chapter, self.width, self.rows)
            }
            _ => Vec::new(),
        }
    }

    /// Act on `key`; only presses act. A metadata-only book takes only Esc.
    pub fn on_key(&mut self, key: KeyEvent) -> Option<ReaderAction> {
        if key.kind != KeyEventKind::Press {
            return None;
        }
        if self.text.is_none() {
            return (key.code == KeyCode::Esc).then_some(ReaderAction::Close(None));
        }
        if let ReaderView::Note(_) = &self.view {
            return self.on_note_key(key);
        }
        if self.selection.is_some() {
            return self.on_selection_key(key);
        }
        match key.code {
            KeyCode::Right => {
                self.next_page();
                None
            }
            KeyCode::Left => {
                self.prev_page();
                None
            }
            KeyCode::Char(']') => {
                self.jump_chapter_to_first(1);
                None
            }
            KeyCode::Char('[') => {
                self.jump_chapter_to_first(-1);
                None
            }
            KeyCode::Down => {
                self.move_cursor(1);
                None
            }
            KeyCode::Up => {
                self.move_cursor(-1);
                None
            }
            KeyCode::Char('v') => {
                self.selection = Some(Selection {
                    start: self.cursor,
                    end: self.cursor,
                    note: None,
                });
                None
            }
            KeyCode::Esc => Some(self.close()),
            _ => None,
        }
    }

    /// Keys while a selection is open: the arrows extend it, a digit
    /// highlights in that swatch and clears it, `n` opens the note view,
    /// Esc cancels it without closing the book.
    fn on_selection_key(&mut self, key: KeyEvent) -> Option<ReaderAction> {
        match key.code {
            KeyCode::Right => {
                self.extend_selection(1);
                None
            }
            KeyCode::Left => {
                self.extend_selection(-1);
                None
            }
            KeyCode::Char(digit @ '1'..='4') => {
                let color = swatch_of(digit);
                let selection = self.selection.take()?;
                let highlight = self.highlight_of(&selection, color)?;
                Some(ReaderAction::Run(Job::Highlight {
                    book: self.book.clone(),
                    highlight,
                }))
            }
            KeyCode::Char('n') => {
                let note = self
                    .selection
                    .as_ref()
                    .and_then(|s| s.note.clone())
                    .unwrap_or_default();
                self.view = ReaderView::Note(note);
                None
            }
            KeyCode::Esc => {
                self.selection = None;
                None
            }
            _ => None,
        }
    }

    /// Keys while typing a note: everything but Enter/Esc/Backspace is
    /// typed text, same rule as an edit buffer in the library.
    fn on_note_key(&mut self, key: KeyEvent) -> Option<ReaderAction> {
        let ReaderView::Note(buffer) = &mut self.view else {
            return None;
        };
        match key.code {
            KeyCode::Esc => self.view = ReaderView::Page,
            KeyCode::Backspace => {
                buffer.pop();
            }
            KeyCode::Enter => {
                let trimmed = buffer.trim();
                let note = (!trimmed.is_empty()).then(|| trimmed.to_owned());
                if let Some(selection) = self.selection.as_mut() {
                    selection.note = note;
                }
                self.view = ReaderView::Page;
            }
            _ => {
                if let Some(c) = typed_char(key) {
                    buffer.push(c);
                }
            }
        }
        None
    }

    /// Move the selection's `end` one word, clamped to `[start, the open
    /// page's last word]` — a selection never crosses off the page it started on.
    fn extend_selection(&mut self, delta: i32) {
        let Some((start, end)) = self.selection.as_ref().map(|s| (s.start, s.end)) else {
            return;
        };
        let pages = self.pages();
        let Some(page) = pages.get(self.page) else {
            return;
        };
        let max = *page
            .lines
            .last()
            .expect("a page has at least one line")
            .end();
        let current = i32::try_from(end).unwrap_or(0);
        let min_i = i32::try_from(start).unwrap_or(0);
        let max_i = i32::try_from(max).unwrap_or(i32::MAX);
        let moved = (current + delta).clamp(min_i, max_i);
        if let Some(selection) = self.selection.as_mut() {
            selection.end = usize::try_from(moved).unwrap_or(start);
        }
    }

    /// `selection`'s highlight, in `color`, over this chapter's text.
    /// `None` only if the book or chapter vanished mid-selection.
    fn highlight_of(
        &self,
        selection: &Selection,
        color: Swatch,
    ) -> Option<crate::annotations::NewHighlight> {
        let chapter = self.text.as_ref()?.chapters.get(self.chapter)?;
        Some(chapter.highlight(
            selection.start..=selection.end,
            color,
            selection.note.clone(),
        ))
    }

    /// Recompute `page` for the current `chapter`/`cursor`/size: the last
    /// page whose first word is at or before `cursor`.
    fn sync_page(&mut self) {
        let pages = self.pages();
        self.page = pages
            .iter()
            .rposition(|p| *p.lines[0].start() <= self.cursor)
            .unwrap_or(0);
    }

    fn next_page(&mut self) {
        let pages = self.pages();
        if pages.is_empty() {
            return;
        }
        if self.page + 1 < pages.len() {
            self.page += 1;
            self.cursor = *pages[self.page].lines[0].start();
        } else {
            self.jump_chapter_to_first(1);
        }
    }

    fn prev_page(&mut self) {
        let pages = self.pages();
        if pages.is_empty() {
            return;
        }
        if self.page > 0 {
            self.page -= 1;
            self.cursor = *pages[self.page].lines[0].start();
        } else {
            self.jump_chapter_to_last(-1);
        }
    }

    /// `]`/`[` and a page-turn crossing a chapter edge forward: the next or
    /// previous chapter's first page; a no-op past the book's ends.
    fn jump_chapter_to_first(&mut self, delta: i32) {
        let Some(kepub) = &self.text else { return };
        let Some(next) = adjacent_chapter(self.chapter, delta, kepub.chapters.len()) else {
            return;
        };
        self.chapter = next;
        self.cursor = 0;
        self.sync_page();
    }

    /// A page-turn crossing a chapter edge backward: the previous chapter's
    /// *last* page (unlike `[`, which opens its first).
    fn jump_chapter_to_last(&mut self, delta: i32) {
        let Some(kepub) = &self.text else { return };
        let Some(next) = adjacent_chapter(self.chapter, delta, kepub.chapters.len()) else {
            return;
        };
        self.chapter = next;
        let pages = self.pages();
        self.cursor = pages.last().map_or(0, |p| *p.lines[0].start());
        self.sync_page();
    }

    /// Move the cursor one word within the current page, clamped to it.
    fn move_cursor(&mut self, delta: i32) {
        let pages = self.pages();
        let Some(page) = pages.get(self.page) else {
            return;
        };
        let min = *page.lines[0].start();
        let max = *page
            .lines
            .last()
            .expect("a page has at least one line")
            .end();
        let current = i32::try_from(self.cursor).unwrap_or(0);
        let min_i = i32::try_from(min).unwrap_or(0);
        let max_i = i32::try_from(max).unwrap_or(i32::MAX);
        let moved = (current + delta).clamp(min_i, max_i);
        self.cursor = usize::try_from(moved).unwrap_or(min);
    }

    /// Esc on the page view: the open page's span and percent, as a read job.
    fn close(&self) -> ReaderAction {
        let Some(kepub) = &self.text else {
            return ReaderAction::Close(None);
        };
        let pages = self.pages();
        let span = pages.get(self.page).map_or(0, |p| p.span);
        let (percent, location) = kepub.bookmark(self.chapter, span);
        ReaderAction::Close(Some(Job::Read {
            book: self.book.clone(),
            percent,
            location: Some(location),
        }))
    }
}

/// The swatch a selection digit names (`Bookmark.Color` index = digit − 1).
/// Only ever called with `'1'..='4'`.
fn swatch_of(digit: char) -> Swatch {
    match digit {
        '1' => Swatch::Yellow,
        '2' => Swatch::Pink,
        '3' => Swatch::Blue,
        _ => Swatch::Green,
    }
}

/// `current + delta`, if it names a chapter index under `len`.
fn adjacent_chapter(current: usize, delta: i32, len: usize) -> Option<usize> {
    let next = i32::try_from(current).unwrap_or(0) + delta;
    usize::try_from(next).ok().filter(|n| *n < len)
}

/// `chapter`'s paragraph key: the `kobo.N` prefix shared by every span of
/// one paragraph (an inline element splits a paragraph across several spans
/// with the same `N`, different `M`).
fn paragraph_of(chapter: &Chapter, span: usize) -> &str {
    chapter.spans[span]
        .id
        .rsplit_once('.')
        .map_or(chapter.spans[span].id.as_str(), |(prefix, _)| prefix)
}

/// Display columns `text` takes, as ratatui measures it.
fn display_width(text: &str) -> u16 {
    u16::try_from(TextSpan::raw(text).width()).unwrap_or(u16::MAX)
}

/// Wrap `chapter`'s words into lines: a new line starts at every paragraph
/// break, and otherwise whenever the next word (plus its separating space)
/// would cross `width`; a word wider than `width` sits alone on its line.
fn chapter_lines(chapter: &Chapter, width: u16) -> Vec<std::ops::RangeInclusive<usize>> {
    let width = width.max(1);
    let mut lines = Vec::new();
    if chapter.words.is_empty() {
        return lines;
    }
    let mut start = 0usize;
    let mut col = display_width(&chapter.words[0].text);
    for i in 1..chapter.words.len() {
        let new_paragraph = paragraph_of(chapter, chapter.words[i].span)
            != paragraph_of(chapter, chapter.words[i - 1].span);
        let word_width = display_width(&chapter.words[i].text);
        let fits = col.saturating_add(1).saturating_add(word_width) <= width;
        if new_paragraph || !fits {
            lines.push(start..=(i - 1));
            start = i;
            col = word_width;
        } else {
            col += 1 + word_width;
        }
    }
    lines.push(start..=(chapter.words.len() - 1));
    lines
}

/// `chapter`'s pages at `width`×`rows`: `rows` consecutive lines each (0
/// counts as 1), with every chapter getting at least one page.
pub fn paginate(kepub: &Kepub, chapter: usize, width: u16, rows: u16) -> Vec<Page> {
    let rows = usize::from(rows.max(1));
    let ch = &kepub.chapters[chapter];
    let lines = chapter_lines(ch, width);
    lines
        .chunks(rows)
        .map(|chunk| {
            let page_lines = chunk.to_vec();
            let first_word = *page_lines[0].start();
            let span = ch.words[first_word].span;
            let percent = kepub.bookmark(chapter, span).0;
            Page {
                lines: page_lines,
                span,
                percent,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests;
