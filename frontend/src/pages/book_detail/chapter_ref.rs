//! Resolve a reader chapter from an EPUB CFI. The book-detail resume readout
//! and the saved-passage locator both name the chapter the reader opens, so
//! they derive it the same way — from the CFI's spine item, and its place
//! among the anchors of chapters sharing that item — rather than the rounded
//! whole-book percent that lands one chapter ahead when a boundary falls
//! inside the rounding window.

use omnibus_shared::AlignmentEbookChapter;

/// 1-based spine index encoded in a CFI's pre-`!` package step.
///
/// A CFI opens with the path through the package document — `/6/14[chap3]!…`
/// — where `/6` selects the `<spine>` and the step after it is the *child*
/// index of the spine item. Child indices are even (odd steps address text
/// nodes), so the item's ordinal is that step halved.
pub(super) fn cfi_spine_ordinal(cfi: &str) -> Option<u32> {
    let inner = cfi.trim().strip_prefix("epubcfi(")?.strip_suffix(')')?;
    // Everything up to the first `!` is the package-document path; what follows
    // steps inside the spine item itself.
    let package = inner.split('!').next()?;
    let step = package.rsplit('/').find(|s| !s.is_empty())?;
    // Drop a trailing `[id]` assertion (`14[chap3]` → `14`).
    let digits = step.split('[').next()?;
    let raw: u32 = digits.parse().ok()?;
    // Odd or zero means this isn't an element step, so the halving would be a
    // fabrication. Report nothing instead.
    if raw == 0 || !raw.is_multiple_of(2) {
        return None;
    }
    Some(raw / 2)
}

/// Index of the chapter a CFI sits in. `chapters` are in TOC order.
///
/// By spine item first: the reader navigates by spine document, so one
/// chapter per item resolves exactly, and the percent-rounding off-by-one
/// across a chapter boundary can't occur. Where several chapters share the
/// CFI's item, the position inside the document decides — the last whose
/// anchor is at or before it, or the item's first when it is ahead of every
/// anchor. A chapter with no anchor recorded counts as opening the item, so a
/// book extracted before anchors were recorded keeps naming the item's last.
///
/// `None` when the CFI carries no readable spine step or sits before the
/// first chapter's item, letting the caller fall back to the percent-based
/// estimate.
pub(super) fn chapter_index_for_cfi(
    chapters: &[AlignmentEbookChapter],
    cfi: &str,
) -> Option<usize> {
    let spine = i64::from(cfi_spine_ordinal(cfi)?) - 1;
    let Some(first) = chapters.iter().position(|c| c.spine_index == spine) else {
        return chapters.iter().rposition(|c| c.spine_index <= spine);
    };
    let last = chapters.iter().rposition(|c| c.spine_index == spine)?;
    if first == last {
        return Some(first);
    }
    let Some(position) = cfi_doc_steps(cfi) else {
        return Some(last);
    };
    let within = (first..=last).rev().find(|&i| {
        chapters[i].spine_index == spine
            && chapters[i]
                .anchor_path
                .as_deref()
                .and_then(steps)
                .is_none_or(|anchor| anchor <= position)
    });
    Some(within.unwrap_or(first))
}

/// A CFI's in-document steps — after the `!`, to the start of a range — as
/// numbers: `epubcfi(/6/8!/4/2[c1]/10,/1:5,/1:9)` → `[4, 2, 10, 1]`.
fn cfi_doc_steps(cfi: &str) -> Option<Vec<u32>> {
    let inner = cfi.trim().strip_prefix("epubcfi(")?.strip_suffix(')')?;
    let bare = strip_assertions(inner);
    let (_, doc) = bare.split_once('!')?;
    let mut parts = doc.splitn(3, ',');
    let parent = parts.next()?;
    let start = parts.next().unwrap_or("");
    steps(&format!("{parent}{start}"))
}

/// `/4/2:5` → `[4, 2]`: each step's leading number, its offset dropped.
fn steps(path: &str) -> Option<Vec<u32>> {
    path.split('/')
        .filter(|s| !s.is_empty())
        .map(|s| s.split(|c: char| !c.is_ascii_digit()).next()?.parse().ok())
        .collect()
}

/// A CFI without its `[…]` assertions, whose text may hold `,` or `/`.
fn strip_assertions(cfi: &str) -> String {
    let mut out = String::with_capacity(cfi.len());
    let mut depth = 0usize;
    for ch in cfi.chars() {
        match ch {
            '[' => depth += 1,
            ']' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests;
