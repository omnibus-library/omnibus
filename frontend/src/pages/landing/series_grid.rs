//! Series-stack layout for the landing grid. [`grid_items`] turns the page's
//! rows and the stacks riding with them into the cells
//! [`super::grid::BookGrid`] renders — a stack in its lead's slot or, dealt
//! out, a head card then its volumes — plus the per-stack values the tiles
//! draw from. Pure, so the placement rules are testable without a runtime.

use std::collections::HashMap;

use omnibus_shared::{EbookMetadata, SeriesStack};

use super::sorting::row_diff_key;

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

impl GridItem {
    /// The cell's diff key: a book's own key, or its stack's lead for a stack or head card.
    pub(super) fn key(&self) -> String {
        match self {
            GridItem::Book(book) => row_diff_key(book),
            GridItem::Vol(cell) => row_diff_key(&cell.book),
            GridItem::Stack(stack) => format!("stack-{}", stack.lead_uuid),
            GridItem::Cap(stack) => format!("cap-{}", stack.lead_uuid),
        }
    }
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

/// The grid's cells: a stack's lead row becomes the stack, or its head card and volumes when open.
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

/// The lead uuids of the stacks [`grid_items`] folds (two or more members).
pub(super) fn stack_leads(stacks: &[SeriesStack]) -> Vec<String> {
    stacks
        .iter()
        .filter(|s| s.members.len() >= 2)
        .map(|s| s.lead_uuid.clone())
        .collect()
}

/// Whether `key` names no current stack's lead: an open run or refocus left from an older page.
pub(super) fn is_stale(key: Option<&str>, leads: &[String]) -> bool {
    key.is_some_and(|k| !leads.iter().any(|lead| lead == k))
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

/// "Vol. N" (series index, else run position), with " · read" once the viewer finished it.
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

/// ` --sa: <accent>;` — the front volume's accent, else the page's; leading space to append.
pub(super) fn band_style(stack: &SeriesStack) -> String {
    let accent = stack
        .front()
        .and_then(|b| b.accent.as_deref())
        .unwrap_or("var(--accent)");
    format!(" --sa: {accent};")
}

/// The covers a folded stack fans: the front volume, then series order, at most three.
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

/// Per-volume segment fill (0-100) in series order; `None` until the viewer starts one.
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
