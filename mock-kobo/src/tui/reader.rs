//! The reader's own state machine: pagination, the current page and cursor,
//! and the keys that move them. Nothing here touches the terminal or the
//! device — a page turn or a close is a pure function of the key and the
//! open book, same as [`super::app`] is for the library.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind};
use ratatui::text::Span as TextSpan;

use crate::annotations::{Annotation, Swatch};
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
/// and the size it last fit to. Not `Eq`: `annotations` carries a
/// `serde_json::Value` location, which isn't either.
#[derive(Clone, Debug, PartialEq)]
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
    /// `chapter`'s pagination at `width`×`rows`, cached: rebuilt only when
    /// `pages_key` no longer matches, so a 100ms tick never re-walks a long
    /// chapter's words just to redraw the same page.
    pages: Vec<Page>,
    /// `(chapter, width, rows)` the cached `pages` was built for.
    pages_key: (usize, u16, u16),
    /// The `modified` stamp of the last device bookmark `App::show_book`
    /// placed this reader on; `None` (older than any real stamp) before
    /// the first one, so a reader just opened on its own always takes it.
    placed_at: Option<i64>,
    pub view: ReaderView,
    /// A word selection in progress on the open page, started by `v`.
    pub selection: Option<Selection>,
    /// The book's annotations as of the last `App::show_book`; the
    /// highlights list's ids and rows come from here, never a fresh read.
    pub annotations: Vec<Annotation>,
}

impl Reader {
    /// Open `book` at its first page; `text: None` is a metadata-only book.
    pub fn open(book: String, text: Option<Kepub>) -> Self {
        let mut reader = Self {
            book,
            text,
            chapter: 0,
            page: 0,
            cursor: 0,
            width: 0,
            rows: 0,
            pages: Vec::new(),
            pages_key: (0, 0, 0),
            placed_at: None,
            view: ReaderView::Page,
            selection: None,
            annotations: Vec::new(),
        };
        reader.rebuild_pages();
        reader
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
        let word = self
            .text
            .as_ref()
            .and_then(|kepub| kepub.chapters.get(chapter))
            .and_then(|text| text.words.iter().position(|w| w.span == span))
            .unwrap_or(0);
        self.place_at_word(chapter, word, modified);
    }

    /// Move to `chapter`'s absolute word `word` and record `modified` as
    /// placed — the counterpart to `place_at_span` for a bookmark naming
    /// only a book percent, no span ([`crate::kepub::Kepub::word_at_percent`]).
    /// Clears any word selection and returns to the page view — a
    /// selection's word indices are only meaningful on the chapter/page
    /// they were started on.
    pub fn place_at_word(&mut self, chapter: usize, word: usize, modified: i64) {
        self.chapter = chapter;
        self.cursor = word;
        self.placed_at = Some(modified);
        self.selection = None;
        self.view = ReaderView::Page;
        self.rebuild_pages();
        self.sync_page();
    }

    /// Re-paginate the current chapter to `width`×`rows` and keep the page
    /// holding `cursor`'s word on screen. A no-op re-fit at an unchanged
    /// size skips the re-pagination — the tick loop calls this every 100ms.
    pub fn fit(&mut self, width: u16, rows: u16) {
        self.width = width;
        self.rows = rows;
        self.rebuild_pages();
        self.sync_page();
    }

    /// This chapter's pages at the reader's last-fit size; empty only for a
    /// metadata-only book or an out-of-range chapter.
    pub fn pages(&self) -> &[Page] {
        &self.pages
    }

    /// Recompute `pages` for the current `chapter`/`width`/`rows` — a no-op
    /// if they already match the cache's key (so a re-fit at an unchanged
    /// size, called every 100ms by the tick loop, never re-walks the words).
    fn rebuild_pages(&mut self) {
        let key = (self.chapter, self.width, self.rows);
        if key == self.pages_key {
            return;
        }
        self.pages = match &self.text {
            Some(kepub) if self.chapter < kepub.chapters.len() => {
                paginate(kepub, self.chapter, self.width, self.rows)
            }
            _ => Vec::new(),
        };
        self.pages_key = key;
    }

    /// Whether `key` would close with a job or commit a highlight right
    /// now — the two points `App` checks its device-busy slot before
    /// dispatching, so a refusal never loses the reader's position or an
    /// open selection. Only `ReaderView::Page` commits — a digit typed into
    /// an open note, or any key while the highlights list is showing, is
    /// never a close or a highlight commit.
    pub(super) fn commits_on(&self, key: KeyEvent) -> bool {
        if key.kind != KeyEventKind::Press || self.text.is_none() {
            return false;
        }
        match &self.view {
            ReaderView::Page if self.selection.is_none() => key.code == KeyCode::Esc,
            ReaderView::Page if self.selection.is_some() => {
                matches!(key.code, KeyCode::Char('1'..='4'))
            }
            _ => false,
        }
    }

    /// Act on `key`; only presses act. The highlights list (and its own
    /// delete) works even for a metadata-only book, which otherwise takes
    /// only Esc and `h`/`H`.
    pub fn on_key(&mut self, key: KeyEvent) -> Option<ReaderAction> {
        if key.kind != KeyEventKind::Press {
            return None;
        }
        if let ReaderView::Highlights(selected) = self.view {
            return self.on_highlights_key(key, selected);
        }
        if self.text.is_none() {
            return match key.code {
                KeyCode::Esc => Some(ReaderAction::Close(None)),
                KeyCode::Char(c) if c.eq_ignore_ascii_case(&'h') => {
                    self.view = ReaderView::Highlights(0);
                    None
                }
                _ => None,
            };
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
            KeyCode::Char(c) if c.eq_ignore_ascii_case(&'v') => {
                self.selection = Some(Selection {
                    start: self.cursor,
                    end: self.cursor,
                    note: None,
                });
                None
            }
            KeyCode::Char(c) if c.eq_ignore_ascii_case(&'h') => {
                self.view = ReaderView::Highlights(0);
                None
            }
            KeyCode::Esc => Some(self.close()),
            _ => None,
        }
    }

    /// Keys in the highlights list: ↓/↑ move (clamped), `x` deletes the
    /// selected row, Esc returns to the page.
    fn on_highlights_key(&mut self, key: KeyEvent, selected: usize) -> Option<ReaderAction> {
        let last = self.annotations.len().saturating_sub(1);
        match key.code {
            KeyCode::Down => {
                self.view = ReaderView::Highlights((selected + 1).min(last));
                None
            }
            KeyCode::Up => {
                self.view = ReaderView::Highlights(selected.saturating_sub(1));
                None
            }
            KeyCode::Char(c) if c.eq_ignore_ascii_case(&'x') => {
                let highlight = self.annotations.get(selected)?.id.clone();
                self.view = ReaderView::Page;
                Some(ReaderAction::Run(Job::DeleteHighlight {
                    book: self.book.clone(),
                    highlight,
                }))
            }
            KeyCode::Esc => {
                self.view = ReaderView::Page;
                None
            }
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
            KeyCode::Char(c) if c.eq_ignore_ascii_case(&'n') => {
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
    /// page's last word]` — a selection never crosses off the page it
    /// started on. A no-op if those bounds have gone stale (`start` past
    /// the current page's end), rather than panicking.
    fn extend_selection(&mut self, delta: i32) {
        let Some((start, end)) = self.selection.as_ref().map(|s| (s.start, s.end)) else {
            return;
        };
        let Some(page) = self.pages.get(self.page) else {
            return;
        };
        let Some(&max) = page.lines.last().map(std::ops::RangeInclusive::end) else {
            return;
        };
        let Some(moved) = nudge(end, delta, start, max) else {
            return;
        };
        if let Some(selection) = self.selection.as_mut() {
            selection.end = moved;
        }
    }

    /// `selection`'s highlight, in `color`, over this chapter's text.
    /// `None` if the book or chapter vanished mid-selection, or the
    /// selection's bounds no longer fit the chapter's words.
    fn highlight_of(
        &self,
        selection: &Selection,
        color: Swatch,
    ) -> Option<crate::annotations::NewHighlight> {
        let chapter = self.text.as_ref()?.chapters.get(self.chapter)?;
        if selection.end >= chapter.words.len() {
            return None;
        }
        Some(chapter.highlight(
            selection.start..=selection.end,
            color,
            selection.note.clone(),
        ))
    }

    /// Recompute `page` for the current `chapter`/`cursor`/size: the last
    /// page whose first word is at or before `cursor`.
    fn sync_page(&mut self) {
        self.page = self
            .pages
            .iter()
            .rposition(|p| *p.lines[0].start() <= self.cursor)
            .unwrap_or(0);
    }

    fn next_page(&mut self) {
        if self.pages.is_empty() {
            return;
        }
        if self.page + 1 < self.pages.len() {
            self.page += 1;
            self.cursor = *self.pages[self.page].lines[0].start();
        } else {
            self.jump_chapter_to_first(1);
        }
    }

    fn prev_page(&mut self) {
        if self.pages.is_empty() {
            return;
        }
        if self.page > 0 {
            self.page -= 1;
            self.cursor = *self.pages[self.page].lines[0].start();
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
        self.rebuild_pages();
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
        self.rebuild_pages();
        self.cursor = self.pages.last().map_or(0, |p| *p.lines[0].start());
        self.sync_page();
    }

    /// Move the cursor one word within the current page, clamped to it. A
    /// no-op if the page's bounds have gone stale, rather than panicking.
    fn move_cursor(&mut self, delta: i32) {
        let Some(page) = self.pages.get(self.page) else {
            return;
        };
        let min = *page.lines[0].start();
        let Some(&max) = page.lines.last().map(std::ops::RangeInclusive::end) else {
            return;
        };
        if let Some(moved) = nudge(self.cursor, delta, min, max) {
            self.cursor = moved;
        }
    }

    /// Esc on the page view: the open page's span and percent, as a read
    /// job. Also used directly by `App`'s Ctrl-C quit path.
    pub(super) fn close(&self) -> ReaderAction {
        let Some(kepub) = &self.text else {
            return ReaderAction::Close(None);
        };
        let span = self.pages.get(self.page).map_or(0, |p| p.span);
        let (percent, location) = kepub.bookmark(self.chapter, span);
        ReaderAction::Close(Some(Job::Read {
            book: self.book.clone(),
            percent,
            location: Some(location),
        }))
    }
}

/// `value + delta`, clamped to `[lo, hi]` — `None` if `lo > hi` (a page or
/// selection whose bounds have gone stale) rather than panicking, as
/// `i32::clamp` would.
fn nudge(value: usize, delta: i32, lo: usize, hi: usize) -> Option<usize> {
    if lo > hi {
        return None;
    }
    let value = i32::try_from(value).unwrap_or(0);
    let lo = i32::try_from(lo).unwrap_or(0);
    let hi = i32::try_from(hi).unwrap_or(i32::MAX);
    usize::try_from((value + delta).clamp(lo, hi)).ok()
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

/// Display columns `text` takes, as ratatui measures it.
fn display_width(text: &str) -> u16 {
    u16::try_from(TextSpan::raw(text).width()).unwrap_or(u16::MAX)
}

/// Wrap `chapter`'s words into lines: a new line starts at every paragraph
/// break, and otherwise whenever the next word (plus its separating space —
/// a glued word has none) would cross `width`; a word wider than `width`
/// sits alone on its line.
fn chapter_lines(chapter: &Chapter, width: u16) -> Vec<std::ops::RangeInclusive<usize>> {
    let width = width.max(1);
    let mut lines = Vec::new();
    if chapter.words.is_empty() {
        return lines;
    }
    let mut start = 0usize;
    let mut col = display_width(&chapter.words[0].text);
    for i in 1..chapter.words.len() {
        let new_paragraph = chapter.paragraph_of(chapter.words[i].span)
            != chapter.paragraph_of(chapter.words[i - 1].span);
        let word_width = display_width(&chapter.words[i].text);
        let separator = u16::from(!chapter.words[i].glued);
        let fits = col.saturating_add(separator).saturating_add(word_width) <= width;
        if new_paragraph || !fits {
            lines.push(start..=(i - 1));
            start = i;
            col = word_width;
        } else {
            col += separator + word_width;
        }
    }
    lines.push(start..=(chapter.words.len() - 1));
    lines
}

/// `chapter`'s pages at `width`×`rows`: `rows` consecutive lines each (0
/// counts as 1), with every chapter getting at least one page. Percents are
/// computed in one pass (matching `Kepub::bookmark`'s own definition)
/// rather than a `bookmark` call per page.
pub fn paginate(kepub: &Kepub, chapter: usize, width: u16, rows: u16) -> Vec<Page> {
    let rows = usize::from(rows.max(1));
    let ch = &kepub.chapters[chapter];
    let lines = chapter_lines(ch, width);
    let words_before_chapter: usize = kepub.chapters[..chapter]
        .iter()
        .map(|c| c.words.len())
        .sum();
    let total: usize = kepub.chapters.iter().map(|c| c.words.len()).sum();
    let words_before_span = words_before_span_table(ch);
    lines
        .chunks(rows)
        .map(|chunk| {
            let page_lines = chunk.to_vec();
            let first_word = *page_lines[0].start();
            let span = ch.words[first_word].span;
            let before = words_before_chapter + words_before_span[span];
            Page {
                lines: page_lines,
                span,
                percent: Percent::of(before, total),
            }
        })
        .collect()
}

/// `table[s]` = how many of `chapter`'s words sit in a span before `s` —
/// the per-page percent in one pass, instead of a `Kepub::bookmark` call
/// (itself O(chapter words)) for every page.
fn words_before_span_table(chapter: &Chapter) -> Vec<usize> {
    let mut table = vec![0usize; chapter.spans.len() + 1];
    for word in &chapter.words {
        table[word.span + 1] += 1;
    }
    for i in 1..table.len() {
        table[i] += table[i - 1];
    }
    table
}

#[cfg(test)]
mod tests;
