//! Control-API equivalents of the reader view's own actions: `read_to` and
//! `highlight_words` resolve a passage of whole words copied from the web
//! reader through the same `Kepub::bookmark` and `Chapter::highlight` the
//! reader view uses, so an exploration agent reads and highlights exactly
//! as a person would — no span id or word index ever crosses the wire.

use std::ops::RangeInclusive;
use std::sync::Arc;

use crate::annotations::{NewHighlight, Swatch};
use crate::kepub::Kepub;

use super::{Acted, Control, ControlError};

impl Control {
    /// Read to the first whole-word run `passage` names: the span holding
    /// its first word, and the book percent there — the same pair a page
    /// starting there would send through the reader view. Every refusal
    /// (an unknown book, one not downloaded, an unreadable or plain-EPUB
    /// file, or a passage the book doesn't hold) happens before any request.
    pub async fn read_to(
        self: &Arc<Self>,
        book: String,
        passage: String,
    ) -> Result<Acted, ControlError> {
        let (kepub, chapter, words) = self.locate_passage(&book, &passage).await?;
        let span = kepub.chapters[chapter].words[*words.start()].span;
        let (percent, location) = kepub.bookmark(chapter, span);
        self.read(book, percent, Some(location)).await
    }

    /// Highlight the first whole-word run `passage` names, in `color`.
    /// Refusals are the same as [`Control::read_to`]'s.
    pub async fn highlight_words(
        self: &Arc<Self>,
        book: String,
        passage: String,
        color: Swatch,
        note: Option<String>,
    ) -> Result<Acted, ControlError> {
        let (kepub, chapter, words) = self.locate_passage(&book, &passage).await?;
        let highlight: NewHighlight = kepub.chapters[chapter].highlight(words, color, note);
        self.highlight(book, highlight).await
    }

    /// Resolve `passage` against `book`'s downloaded KEPUB: look up its
    /// file, load it off the executor (parsing is file and CPU work), then
    /// find the passage. Every refusal happens here, before any request.
    async fn locate_passage(
        &self,
        book: &str,
        passage: &str,
    ) -> Result<(Kepub, usize, RangeInclusive<usize>), ControlError> {
        let path = self.book_file(book)?;
        let kepub = match tokio::task::spawn_blocking(move || Kepub::open(&path)).await {
            Ok(result) => result,
            Err(error) => std::panic::resume_unwind(
                error
                    .try_into_panic()
                    .unwrap_or_else(|cancelled| Box::new(cancelled.to_string())),
            ),
        }?;
        let (chapter, words) = kepub
            .find_passage(passage)
            .ok_or_else(|| ControlError::PassageNotFound(passage.to_owned()))?;
        Ok((kepub, chapter, words))
    }
}

#[cfg(test)]
mod tests;
