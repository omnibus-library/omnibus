//! Series-stack layout for the landing grid. [`grid_items`] turns the page's
//! rows and the stacks riding with them into the cells
//! [`super::grid::BookGrid`] renders — a stack in its lead's slot or, dealt
//! out, a head card then its volumes — plus the per-stack values the tiles
//! draw from. Pure, so the placement rules are testable without a runtime.

use std::collections::HashMap;

use omnibus_shared::{EbookMetadata, SeriesStack};

/// One cell of the landing grid.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum GridItem {
    /// An ordinary book tile.
    Book(EbookMetadata),
    /// A folded series, in its lead's slot.
    Stack(SeriesStack),
    /// The dealt-out series' head card, in the stack's own cell.
    Cap(SeriesStack),
    /// One volume of the dealt-out series.
    Vol(VolumeCell),
}

/// A volume in a dealt-out run: the book plus its run chrome.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct VolumeCell {
    pub(super) book: EbookMetadata,
    /// "Vol. 2", or "Vol. 2 · read" once finished.
    pub(super) caption: String,
    /// The run's last volume rounds the band's far end.
    pub(super) last: bool,
    /// `--sa` for the band behind the run — see [`band_style`].
    pub(super) band_style: String,
    /// The stack this volume was dealt from — its FLIP origin.
    pub(super) lead_uuid: String,
    /// Position in the deck (series order), which staggers the deal.
    pub(super) deck: usize,
}

/// The grid's cells for `books` (the rows, in order) given the `stacks` riding
/// with them. A row that leads a stack becomes the stack or — when `open`
/// names it — the head card followed by every volume in series order. A stack
/// under two members shows as its book: a stack is a series of two or more.
pub(super) fn grid_items(
    books: &[EbookMetadata],
    stacks: &[SeriesStack],
    open: Option<&str>,
) -> Vec<GridItem> {
    let by_lead: HashMap<&str, &SeriesStack> = stacks
        .iter()
        .filter(|s| s.members.len() >= 2)
        .map(|s| (s.lead_uuid.as_str(), s))
        .collect();
    let mut items = Vec::with_capacity(books.len());
    for book in books {
        let stack = book
            .unique_identifier
            .as_deref()
            .and_then(|uuid| by_lead.get(uuid).copied());
        match stack {
            None => items.push(GridItem::Book(book.clone())),
            Some(s) if open == Some(s.lead_uuid.as_str()) => {
                items.push(GridItem::Cap(s.clone()));
                items.extend(volume_cells(s).into_iter().map(GridItem::Vol));
            }
            Some(s) => items.push(GridItem::Stack(s.clone())),
        }
    }
    items
}

/// The dealt-out run's volume cells, in series order.
fn volume_cells(stack: &SeriesStack) -> Vec<VolumeCell> {
    let band = band_style(stack);
    let n = stack.members.len();
    stack
        .members
        .iter()
        .enumerate()
        .map(|(i, book)| VolumeCell {
            book: book.clone(),
            caption: volume_caption(stack, book, i),
            last: i + 1 == n,
            band_style: band.clone(),
            lead_uuid: stack.lead_uuid.clone(),
            deck: i,
        })
        .collect()
}

/// "Vol. N" — the book's series index, else its place in the run — with
/// " · read" once the viewer finished it.
pub(super) fn volume_caption(stack: &SeriesStack, book: &EbookMetadata, position: usize) -> String {
    let number = book
        .series_index
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| (position + 1).to_string());
    let read = book
        .unique_identifier
        .as_deref()
        .and_then(|uuid| stack.state_of(uuid))
        .is_some_and(|s| s.finished);
    if read {
        format!("Vol. {number} · read")
    } else {
        format!("Vol. {number}")
    }
}

/// ` --sa: <accent>;` — the run's tint: the front volume's accent, the page
/// accent when it has none. Leading space so it appends to a style string.
pub(super) fn band_style(stack: &SeriesStack) -> String {
    let accent = stack
        .front()
        .and_then(|b| b.accent.as_deref())
        .unwrap_or("var(--accent)");
    format!(" --sa: {accent};")
}

/// The covers a folded stack fans: the front volume first, then the rest in
/// series order, at most three.
pub(super) fn stack_leaves(stack: &SeriesStack) -> Vec<EbookMetadata> {
    let front = stack.front().cloned();
    let front_uuid = front.as_ref().and_then(|f| f.unique_identifier.clone());
    let mut leaves: Vec<EbookMetadata> = front.into_iter().collect();
    leaves.extend(
        stack
            .members
            .iter()
            .filter(|m| m.unique_identifier != front_uuid)
            .cloned(),
    );
    leaves.truncate(3);
    leaves
}

/// Fill (0-100) per volume for the stack's progress segments, in series
/// order; `None` until the viewer has started one — the tile then shows none.
pub(super) fn stack_segments(stack: &SeriesStack) -> Option<Vec<u8>> {
    if !stack.states.iter().any(|s| s.started || s.finished) {
        return None;
    }
    Some(
        stack
            .members
            .iter()
            .map(|m| {
                match m
                    .unique_identifier
                    .as_deref()
                    .and_then(|u| stack.state_of(u))
                {
                    Some(s) if s.finished => 100,
                    Some(s) => s.percent.unwrap_or(0).min(100),
                    None => 0,
                }
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests;
