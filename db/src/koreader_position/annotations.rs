//! Highlight ranges: a KOReader `(pos0, pos1)` XPointer pair and the range CFI
//! the annotation store keeps. Called by the KOReader annotation routes. Each
//! end goes through the same proof rules as a reading position, so a range is
//! only returned when both ends are provable; a batch opens the EPUB once and
//! walks each spine item once.

use std::path::Path;

use super::{exact_cluster, point_tail, spine_file_index, tail_xpointer, xpointer, Walks};
use crate::kobo_position::walk::FileIndex;
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
    if end_spine_index != spine_index || !in_order(doc, walks, spine_index, &start, &end)? {
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
    let Some(start) = tail_xpointer(doc, walks, range.spine_index, &range.start, false)? else {
        return Ok(None);
    };
    let Some(end) = tail_xpointer(doc, walks, range.spine_index, &range.end, false)? else {
        return Ok(None);
    };
    if !in_order(doc, walks, range.spine_index, &range.start, &range.end)? {
        return Ok(None);
    }
    Ok(Some((start, end)))
}

/// Whether `end` sits at or after `start` in spine item `spine_index`; `false` when either is unresolved.
fn in_order(
    doc: &mut book::Doc,
    walks: &mut Walks,
    spine_index: usize,
    start: &CfiTail,
    end: &CfiTail,
) -> anyhow::Result<bool> {
    let Some(index) = spine_file_index(doc, walks, spine_index)? else {
        return Ok(false);
    };
    let (start, end) = (
        document_position(index, start),
        document_position(index, end),
    );
    // `None` sorts first, so an unresolved end fails the comparison and only a start needs checking.
    Ok(start.is_some() && start <= end)
}

/// Where a tail sits in its document: its text node's place in the walk, which
/// keeps them in document order, then its offset. The CFI steps don't sort, as the
/// walker numbers text nodes apart from the element children between them.
fn document_position(index: &FileIndex, tail: &CfiTail) -> Option<(usize, u32)> {
    let cluster = exact_cluster(index, tail)?;
    let at = index
        .clusters()
        .iter()
        .position(|c| std::ptr::eq(c, cluster))?;
    Some((at, tail.offset_utf16))
}
