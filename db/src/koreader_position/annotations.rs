//! Highlight ranges: a KOReader `(pos0, pos1)` XPointer pair and the range CFI
//! the annotation store keeps. Called by the KOReader annotation routes. Each
//! end goes through the same proof rules as a reading position, so a range is
//! only returned when both ends are provable; a batch opens the EPUB once and
//! walks each spine item once.

use std::path::Path;

use super::{point_tail, tail_xpointer, xpointer, Walks};
use crate::kobo_position::{book, format_range_cfi, parse_range_cfi, CfiTail};

/// KOReader→web: one range CFI per `(pos0, pos1)`; `None` when either end is unprovable,
/// the ends sit in different spine items, or end precedes start. `Err` only on open/read failure.
pub fn annotation_cfis(
    source_epub: &Path,
    anchors: &[(String, String)],
) -> anyhow::Result<Vec<Option<String>>> {
    if anchors.is_empty() {
        return Ok(Vec::new());
    }
    let mut doc = book::open_doc(source_epub)?;
    let mut walks = Walks::new();
    anchors
        .iter()
        .map(|(start, end)| range_cfi(&mut doc, &mut walks, start, end))
        .collect()
}

/// Web→KOReader: the inverse; `None` for anything `parse_range_cfi` rejects or any unprovable end.
pub fn annotation_xpointers(
    source_epub: &Path,
    cfi_ranges: &[String],
) -> anyhow::Result<Vec<Option<(String, String)>>> {
    if cfi_ranges.is_empty() {
        return Ok(Vec::new());
    }
    let mut doc = book::open_doc(source_epub)?;
    let mut walks = Walks::new();
    cfi_ranges
        .iter()
        .map(|cfi| range_xpointers(&mut doc, &mut walks, cfi))
        .collect()
}

fn range_cfi(
    doc: &mut book::Doc,
    walks: &mut Walks,
    start: &str,
    end: &str,
) -> anyhow::Result<Option<String>> {
    let (Some(start), Some(end)) = (xpointer::parse(start), xpointer::parse(end)) else {
        return Ok(None);
    };
    let Some((spine_index, start)) = point_tail(doc, walks, &start)? else {
        return Ok(None);
    };
    let Some((end_spine_index, end)) = point_tail(doc, walks, &end)? else {
        return Ok(None);
    };
    if end_spine_index != spine_index || document_position(&end) < document_position(&start) {
        return Ok(None);
    }
    Ok(Some(format_range_cfi(spine_index, &start, &end)))
}

fn range_xpointers(
    doc: &mut book::Doc,
    walks: &mut Walks,
    cfi: &str,
) -> anyhow::Result<Option<(String, String)>> {
    let Some(range) = parse_range_cfi(cfi) else {
        return Ok(None);
    };
    let Some(start) = tail_xpointer(doc, walks, range.spine_index, &range.start)? else {
        return Ok(None);
    };
    let Some(end) = tail_xpointer(doc, walks, range.spine_index, &range.end)? else {
        return Ok(None);
    };
    Ok(Some((start, end)))
}

/// A sortable key for where a tail sits in its document: CFI steps are numbered
/// in document order, so the element steps, text step and offset compare lexicographically.
fn document_position(tail: &CfiTail) -> (Vec<u32>, u32) {
    let mut steps = tail.element_steps.clone();
    steps.push(tail.text_index);
    (steps, tail.offset_utf16)
}
