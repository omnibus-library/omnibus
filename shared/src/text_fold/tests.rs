//! `fold_for_match`: the three things a match key must survive — accents,
//! case, and the LIKE metacharacters a caller has already escaped.

use super::fold_for_match;

#[test]
fn fold_for_match_strips_diacritics_and_lowercases() {
    assert_eq!(fold_for_match("Pérez Galdós"), "perez galdos");
}

#[test]
fn fold_for_match_preserves_like_wildcards_and_the_escape_char() {
    // Callers fold an already-escaped LIKE pattern, so the wildcards and the
    // ESCAPE character have to survive the fold untouched.
    assert_eq!(fold_for_match(r"a%b_c\d"), r"a%b_c\d");
}

#[test]
fn fold_for_match_keeps_punctuation_and_spacing() {
    assert_eq!(fold_for_match("O'Neill, J.-P."), "o'neill, j.-p.");
}

#[test]
fn fold_for_match_leaves_non_latin_script_intact() {
    assert_eq!(fold_for_match("東京"), "東京");
}

#[test]
fn fold_for_match_returns_empty_for_empty_input() {
    assert_eq!(fold_for_match(""), "");
}
