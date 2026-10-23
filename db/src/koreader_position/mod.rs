//! Translation between the crengine XPointers KOReader reads and writes and the
//! EPUB CFIs the web and iOS readers speak, so a book opens on the same
//! paragraph on either. Called by the KOReader state routes. A conversion is
//! only returned when every proof rule holds (a grammar-valid path that
//! resolves in the XHTML, no SVG/MathML/`pre` text, no run crengine may split
//! or read differently, an offset inside the node); otherwise `Ok(None)`, and
//! the caller keeps the whole-book percent. Reuses the Kobo module's EPUB glue,
//! XHTML walk and CFI parser — it adds no second parser.

mod crengine_text;
#[cfg(test)]
mod tests;
mod xpointer;

use std::path::Path;

use crate::kobo_position::walk::{Cluster, Element, FileIndex};
use crate::kobo_position::{book, format_cfi, parse_cfi, CfiTail};

/// crengine splits a text run into separate nodes at this many source chars.
const TEXT_SPLIT_SIZE: usize = 8192;

/// Elements whose text the proof rules never vouch for.
const UNPROVABLE_ANCESTORS: [&str; 4] = ["svg", "math", "pre", "textarea"];

/// KOReader→web: the point CFI for a crengine XPointer into `source_epub`.
/// `Ok(None)` for every unprovable input; `Err` only when the EPUB can't be opened or read.
pub fn xpointer_to_cfi(source_epub: &Path, xpointer: &str) -> anyhow::Result<Option<String>> {
    let Some(xp) = xpointer::parse(xpointer) else {
        return Ok(None);
    };
    let mut doc = book::open_doc(source_epub)?;
    let Some(spine_index) = spine_index_of(&doc, xp.fragment) else {
        return Ok(None);
    };
    let Some(index) = spine_file_index(&mut doc, spine_index)? else {
        return Ok(None);
    };
    Ok(cfi_tail_for(&index, &xp).map(|tail| format_cfi(spine_index, &tail)))
}

/// Web→KOReader: the canonical XPointer for a stored point CFI. Same `Ok(None)` / `Err` split.
pub fn cfi_to_xpointer(source_epub: &Path, cfi: &str) -> anyhow::Result<Option<String>> {
    let Some(parsed) = parse_cfi(cfi) else {
        return Ok(None);
    };
    let mut doc = book::open_doc(source_epub)?;
    // The CFI parser bounds the step to a u32, so the +1 fits.
    let fragment = (parsed.spine_index + 1) as u32;
    let Some(spine_index) = spine_index_of(&doc, Some(fragment)) else {
        return Ok(None);
    };
    let Some(index) = spine_file_index(&mut doc, spine_index)? else {
        return Ok(None);
    };
    let named = (doc.spine.len() > 1).then_some(fragment);
    Ok(xpointer_for(
        &index,
        &parsed.tail,
        parsed.element_anchored,
        named,
    ))
}

/// The 0-based spine index a `DocFragment` names: bare only for a one-item
/// spine, `[N]` within 1..=len. `None` when any spine item has no manifest
/// entry, since crengine's fragment numbering would then differ from ours.
fn spine_index_of(doc: &book::Doc, fragment: Option<u32>) -> Option<usize> {
    let len = doc.spine.len();
    if (0..len).any(|i| book::spine_href(doc, i).is_none()) {
        return None;
    }
    let n = match fragment {
        Some(n) => usize::try_from(n).ok()?,
        None if len == 1 => 1,
        None => return None,
    };
    (1..=len).contains(&n).then(|| n - 1)
}

/// The walk of spine item `i`; `Ok(None)` when its XHTML can't be parsed.
fn spine_file_index(doc: &mut book::Doc, i: usize) -> anyhow::Result<Option<FileIndex>> {
    let bytes = book::read_spine_entry(doc, i)?;
    Ok(crate::kobo_position::walk::index_file(&bytes).ok())
}

/// The CFI tail for a parsed XPointer, or `None` when a proof rule fails.
fn cfi_tail_for(index: &FileIndex, xp: &xpointer::XPointer) -> Option<CfiTail> {
    let elements = index.elements();
    let mut element = child_element(elements, 0, "body", 1)?;
    for step in &xp.steps {
        element = child_element(elements, element, &step.name, step.index)?;
    }
    match &xp.text {
        Some(text) => text_tail(index, element, text),
        None => first_text_tail(index, element),
    }
}

/// The CFI tail for a text step: the k-th text node of `element`, offset mapped
/// from crengine's collapsed text back to the raw text.
fn text_tail(index: &FileIndex, element: usize, text: &xpointer::TextStep) -> Option<CfiTail> {
    if inside_unprovable(index.elements(), element) {
        return None;
    }
    let nodes = text_nodes(index, element);
    let k = usize::try_from(text.index).ok()?;
    if !nodes.get(..k)?.iter().all(|c| stable_run(c)) {
        return None;
    }
    let target = nodes[k - 1];
    Some(CfiTail {
        element_steps: target.element_steps.clone(),
        text_index: target.text_index,
        offset_utf16: crengine_text::raw_offset(&target.raw, text.offset)?,
    })
}

/// The CFI tail at the first visible character inside `element`; `None` when
/// the element holds no visible text, or only text the rules reject.
fn first_text_tail(index: &FileIndex, element: usize) -> Option<CfiTail> {
    let elements = index.elements();
    let first = index
        .clusters()
        .iter()
        .find(|c| c.norm_len > 0 && ancestors(elements, c.parent).any(|a| a == element))?;
    let (tail, _) = index.tail_at(first.norm_start)?;
    let landed = exact_cluster(index, &tail)?;
    let inside = ancestors(elements, landed.parent).any(|a| a == element);
    (inside && stable_run(landed) && !inside_unprovable(elements, landed.parent)).then_some(tail)
}

/// The canonical XPointer for a CFI tail; `fragment` is `None` for a one-item spine.
fn xpointer_for(
    index: &FileIndex,
    tail: &CfiTail,
    element_anchored: bool,
    fragment: Option<u32>,
) -> Option<String> {
    let (cluster, utf16_offset) = landed_cluster(index, tail, element_anchored)?;
    let elements = index.elements();
    if inside_unprovable(elements, cluster.parent) {
        return None;
    }
    let nodes = text_nodes(index, cluster.parent);
    let k = nodes
        .iter()
        .position(|c| c.text_index == cluster.text_index)?
        + 1;
    if !nodes[..k].iter().all(|c| stable_run(c)) {
        return None;
    }
    let offset = crengine_text::crengine_offset(&cluster.raw, utf16_offset)?;
    let several = nodes
        .iter()
        .filter(|c| !crengine_text::is_blank(&c.raw))
        .count()
        > 1;
    Some(xpointer::format(
        fragment,
        &element_path(elements, cluster.parent)?,
        Some((several.then_some(k as u32), offset)),
    ))
}

/// The cluster a tail names, with the offset to use in it. An element-anchored
/// tail lands on the element's first visible character, which must still be
/// inside that element.
fn landed_cluster<'a>(
    index: &'a FileIndex,
    tail: &CfiTail,
    element_anchored: bool,
) -> Option<(&'a Cluster, u32)> {
    if !element_anchored {
        return exact_cluster(index, tail).map(|cluster| (cluster, tail.offset_utf16));
    }
    let under = |c: &Cluster| c.element_steps.starts_with(&tail.element_steps);
    let first = index
        .clusters()
        .iter()
        .find(|c| c.norm_len > 0 && under(c))?;
    let (landed, _) = index.tail_at(first.norm_start)?;
    let cluster = exact_cluster(index, &landed)?;
    under(cluster).then_some((cluster, landed.offset_utf16))
}

fn exact_cluster<'a>(index: &'a FileIndex, tail: &CfiTail) -> Option<&'a Cluster> {
    index
        .clusters()
        .iter()
        .find(|c| c.element_steps == tail.element_steps && c.text_index == tail.text_index)
}

/// The text nodes directly under `element`, in document order.
fn text_nodes(index: &FileIndex, element: usize) -> Vec<&Cluster> {
    index
        .clusters()
        .iter()
        .filter(|c| c.parent == element)
        .collect()
}

/// A run crengine keeps as one node and counts like we do: not whitespace-only
/// (it may drop those), no markup splitting it, below its split size.
fn stable_run(cluster: &Cluster) -> bool {
    !cluster.markup_inside
        && cluster.source_bytes < TEXT_SPLIT_SIZE
        && !crengine_text::is_blank(&cluster.raw)
}

/// The child elements of `parent` named `name` (ASCII case-insensitively), in document order.
fn same_name_siblings<'a>(
    elements: &'a [Element],
    parent: Option<usize>,
    name: &'a str,
) -> impl Iterator<Item = usize> + 'a {
    elements
        .iter()
        .enumerate()
        .filter(move |(_, e)| e.parent == parent && e.local.eq_ignore_ascii_case(name))
        .map(|(i, _)| i)
}

/// The `index`-th (1-based) child element of `parent` named `name`.
fn child_element(elements: &[Element], parent: usize, name: &str, index: u32) -> Option<usize> {
    let nth = usize::try_from(index).ok()?.checked_sub(1)?;
    same_name_siblings(elements, Some(parent), name).nth(nth)
}

/// `idx` and its ancestors, nearest first.
fn ancestors(elements: &[Element], idx: usize) -> impl Iterator<Item = usize> + '_ {
    std::iter::successors(Some(idx), |&i| elements[i].parent)
}

/// Whether `idx` is, or sits inside, an SVG, MathML or preformatted element.
fn inside_unprovable(elements: &[Element], idx: usize) -> bool {
    ancestors(elements, idx).any(|i| {
        let local = elements[i].local.rsplit(':').next().unwrap_or_default();
        UNPROVABLE_ANCESTORS
            .iter()
            .any(|name| local.eq_ignore_ascii_case(name))
    })
}

/// Canonical element steps from `<body>` down to `idx`: lowercased names, an
/// index only where the parent holds several same-name children.
fn element_path(elements: &[Element], idx: usize) -> Option<Vec<(String, Option<u32>)>> {
    let mut chain: Vec<usize> = ancestors(elements, idx).collect();
    chain.reverse();
    let body = *chain.get(1)?;
    if !elements[body].local.eq_ignore_ascii_case("body") {
        return None;
    }
    chain[2..]
        .iter()
        .map(|&i| {
            let name = elements[i].local.to_ascii_lowercase();
            if !xpointer::is_name(&name) {
                return None;
            }
            let siblings: Vec<usize> =
                same_name_siblings(elements, elements[i].parent, &name).collect();
            let position = siblings.iter().position(|&s| s == i)? + 1;
            Some((name, (siblings.len() > 1).then_some(position as u32)))
        })
        .collect()
}
