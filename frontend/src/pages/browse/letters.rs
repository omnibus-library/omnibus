//! The letter a browse row files under, the groups those letters make, and
//! the fragment each group is reached by. Pure, so the rules are tested
//! without a renderer.

use omnibus_shared::text_fold::fold_for_match;

/// The letter a sort key files under: its folded initial, or `#` for anything
/// outside A–Z (digits, punctuation, CJK, …). An accented initial files under
/// its letter (`Éluard` under E).
pub fn letter_for_key(key: &str) -> char {
    match folded_initial(key) {
        Some(c) if c.is_ascii_alphabetic() => c.to_ascii_uppercase(),
        _ => '#',
    }
}

/// Whether `key` files under `#` rather than A–Z.
pub fn is_non_alpha_key(key: &str) -> bool {
    !folded_initial(key).is_some_and(|c| c.is_ascii_alphabetic())
}

/// The key's first character with accents and case folded away.
fn folded_initial(key: &str) -> Option<char> {
    fold_for_match(key.chars().next()?.encode_utf8(&mut [0; 4]))
        .chars()
        .next()
}

/// Buckets consecutive same-letter rows of an already-sorted list.
pub fn group_by_letter<T: Clone>(sorted: &[T], letter: impl Fn(&T) -> char) -> Vec<(char, Vec<T>)> {
    let mut letters: Vec<(char, Vec<T>)> = Vec::new();
    for row in sorted {
        let l = letter(row);
        match letters.last_mut() {
            Some((existing, group)) if *existing == l => group.push(row.clone()),
            _ => letters.push((l, vec![row.clone()])),
        }
    }
    letters
}

/// URL-fragment-safe slug for a letter glyph: `#` would start a second
/// fragment, so the non-alpha bucket is `letter-hash`.
pub fn letter_frag(c: char) -> String {
    if c == '#' {
        "hash".to_string()
    } else {
        c.to_string()
    }
}
