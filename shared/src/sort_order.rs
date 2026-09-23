//! The one dictionary order every sort surface shares: the SQLite collations
//! `db` registers on each pooled connection, and the browser's client-side
//! sorts (the Authors index, the search result set, the offline replica).
//! Keeping the comparator here is what stops the server and the page from
//! disagreeing about where `Pérez` files.

use std::borrow::Cow;
use std::cmp::Ordering;

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Dictionary order: accents and case are ignored, and the plain spelling
/// files first only when two strings are otherwise identical (`Perez` before
/// `Pérez`). A comma files before a space, so a surname ends at its comma and
/// every `Perez, …` lands ahead of `Pérez Galdós, …`.
///
/// Total and antisymmetric — two strings compare `Equal` only when they are
/// byte-identical — which is what SQLite requires of a collation and what
/// keeps a keyset cursor's `=` consistent with its `>`.
pub fn dictionary_cmp(a: &str, b: &str) -> Ordering {
    let folded = if a.is_ascii() && b.is_ascii() {
        // Same result as `fold`, minus the decomposition machinery: this is
        // the comparison a whole-library sort spends its time in.
        a.bytes().map(fold_ascii).cmp(b.bytes().map(fold_ascii))
    } else {
        fold(a).cmp(fold(b))
    };
    folded.then_with(|| a.cmp(b))
}

/// [`dictionary_cmp`] as a precomputed key: `(dictionary_key(a), a)` orders
/// exactly as `dictionary_cmp(a, _)` does, for sorts that build one key per
/// row instead of folding on every comparison.
pub fn dictionary_key(s: &str) -> String {
    fold(s).collect()
}

/// Dictionary order over two author names, each reshaped by
/// [`author_sort_key`] first — so a display name typed into the editor
/// (`Andy Weir`) files beside a stored surname-first key (`Weir, Andy`).
/// Two names with the same key compare `Equal`.
pub fn author_dictionary_cmp(a: &str, b: &str) -> Ordering {
    dictionary_cmp(&author_key(a), &author_key(b))
}

/// Surname-first sort key for an author *display name*:
/// - a name already in `"Surname, Given"` form (it carries a comma) is kept
///   verbatim — some Calibre dumps store the display name that way;
/// - a mononym (no whitespace) is kept verbatim;
/// - otherwise the last space-separated token becomes the surname:
///   `"Andy Weir"` → `"Weir, Andy"`.
pub fn author_sort_key(name: &str) -> String {
    author_key(name).into_owned()
}

/// The key a book or author files under, given its `file_as` and display
/// name. `file_as` is trusted only in `"Surname, Given"` form; a comma-less
/// one is as often a display name (`Andy Weir`), a bare surname or a
/// pseudonym as a real key, so the key is derived from the display name
/// instead — from `file_as` only when there is no name to derive it from.
pub fn creator_sort_key(file_as: Option<&str>, name: &str) -> String {
    match file_as.map(str::trim).filter(|s| !s.is_empty()) {
        Some(fa) if fa.contains(',') => fa.to_string(),
        Some(fa) if name.trim().is_empty() => author_sort_key(fa),
        _ => author_sort_key(name),
    }
}

/// [`author_sort_key`] without the allocation when the name is already a key.
fn author_key(name: &str) -> Cow<'_, str> {
    let name = name.trim();
    if name.contains(',') {
        return Cow::Borrowed(name);
    }
    match name.rsplit_once(' ') {
        Some((rest, last)) => Cow::Owned(format!("{last}, {rest}")),
        None => Cow::Borrowed(name),
    }
}

/// The folded character stream [`dictionary_cmp`] compares: compatibility
/// decomposition with combining marks dropped and case folded (the same fold
/// as `text_fold::fold_for_match`), with the comma lowered below every
/// printable character.
fn fold(s: &str) -> impl Iterator<Item = char> + '_ {
    s.nfkd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .map(|c| if c == ',' { COMMA } else { c })
}

/// [`fold`] for one ASCII byte, where decomposition is the identity.
fn fold_ascii(b: u8) -> u8 {
    if b == b',' {
        0
    } else {
        b.to_ascii_lowercase()
    }
}

/// What a comma folds to: below the space, so `"Perez, Ana"` files ahead of
/// `"Perez Galdos, Benito"`.
const COMMA: char = '\0';

#[cfg(test)]
mod tests;
