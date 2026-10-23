//! The reader's own state machine: pagination, the current page and cursor,
//! and the keys that move them. Nothing here touches the terminal or the
//! device — a page turn or a close is a pure function of the key and the
//! open book, same as [`super::app`] is for the library.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind};
use ratatui::text::Span as TextSpan;

use crate::kepub::{Chapter, Kepub};
use crate::reading::Percent;
use crate::tui::app::Job;

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
    /// Esc: the reader's own `Job::Read` (a downloaded book), or none (metadata-only).
    Close(Option<Job>),
    /// A job the reader made while staying open (a highlight, from Task 5).
    Run(Job),
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
        }
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
            KeyCode::Esc => Some(self.close()),
            _ => None,
        }
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
