//! Diacritic folding for user-typed match input.
//!
//! Shared by the server's author-search predicate and the browser's
//! authors-index filter, so a reader typing a name without its accents
//! reaches the same rows either way. Punctuation and spacing survive —
//! this folds characters, it does not tokenize.

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Fold `s` to a case- and accent-insensitive match key: decompose, drop
/// combining marks, lowercase.
///
/// NFKD also folds compatibility forms (`ﬁ` → `fi`), making this slightly
/// stronger than SQLite FTS5's `remove_diacritics 2` — strictly more
/// folding, never less, so a folded query never misses what FTS matches.
pub fn fold_for_match(s: &str) -> String {
    s.nfkd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests;
