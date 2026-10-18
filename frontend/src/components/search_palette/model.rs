//! Flat-list item model + small helpers shared between the overlay, the
//! keyboard handler, and the results list. The overlay builds a flat
//! `Vec<FlatItem>` from grouped `PaletteResults` plus the matching settings,
//! so arrow-key navigation has a single index space across every row.

use omnibus_shared::PaletteResults;

use crate::pages::SettingsEntry;

/// A single selectable item in the flat list used for arrow-key navigation.
/// Books carry the stable `uuid` so the palette can build `/books/:uuid` URLs
/// without a second round-trip.
///
/// `Genre` is keyed on its name alone: genres have no row to navigate to.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum FlatItem {
    Book { uuid: String, title: String },
    Author { id: i64, name: String },
    Series { id: i64, name: String },
    Tag { id: i64, name: String },
    Genre { name: String },
    Setting(&'static SettingsEntry),
}

/// Build a flat ordered list of all selectable items: the server's groups,
/// then the settings, the order the list renders them in. Settings match on
/// the client, so they're listed before the server has answered.
pub(super) fn build_flat_items(
    results: &Option<PaletteResults>,
    settings: &[&'static SettingsEntry],
) -> Vec<FlatItem> {
    let mut items = Vec::new();
    if let Some(r) = results {
        push_result_items(r, &mut items);
    }
    items.extend(settings.iter().map(|entry| FlatItem::Setting(entry)));
    items
}

/// Where the highlight goes when the list changes under it: the same item in
/// `after`, or the top when it's gone. Settings list before the server answers
/// and books land ahead of them, so a plain reset would move it to a book.
pub(super) fn keep_selection(before: &[FlatItem], selected: usize, after: &[FlatItem]) -> usize {
    before
        .get(selected)
        .and_then(|item| after.iter().position(|candidate| candidate == item))
        .unwrap_or(0)
}

fn push_result_items(r: &PaletteResults, items: &mut Vec<FlatItem>) {
    for b in &r.books {
        items.push(FlatItem::Book {
            uuid: b.uuid.clone(),
            title: b.title.clone(),
        });
    }
    for a in &r.authors {
        items.push(FlatItem::Author {
            id: a.id,
            name: a.name.clone(),
        });
    }
    for s in &r.series {
        items.push(FlatItem::Series {
            id: s.id,
            name: s.name.clone(),
        });
    }
    for t in &r.tags {
        items.push(FlatItem::Tag {
            id: t.id,
            name: t.name.clone(),
        });
    }
    for g in &r.genres {
        items.push(FlatItem::Genre {
            name: g.name.clone(),
        });
    }
}

/// Check if a given flat item matches the currently selected index.
pub(super) fn is_selected(items: &[FlatItem], selected_idx: usize, candidate: &FlatItem) -> bool {
    items.get(selected_idx) == Some(candidate)
}

/// Simple English plural suffix.
pub(super) fn plural(n: usize) -> &'static str {
    if n == 1 {
        ""
    } else {
        "s"
    }
}

// `facet_query` used to live here. It moved to `crate::format` when the
// `/search` chips turned out to have their own — wrong — copy; re-exported so
// the palette's call sites read unchanged.
pub(super) use crate::format::facet_query;

#[cfg(test)]
mod tests;
