//! The author key every sort surface files a book under: the `db` sync
//! writers store it in `books.author_sort`, and the browser's client-side
//! sorts derive the same one. Keeping the rule here is what stops the server
//! and the page from disagreeing about which letter an author files under.

use std::borrow::Cow;

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

#[cfg(test)]
mod tests;
