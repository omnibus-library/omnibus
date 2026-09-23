//! The author key shapes every sort surface files a book under.

use super::*;

#[test]
fn author_sort_key_reshapes_given_surname_to_surname_first() {
    assert_eq!(author_sort_key("Andy Weir"), "Weir, Andy");
    assert_eq!(author_sort_key("Ursula K. Le Guin"), "Guin, Ursula K. Le");
}

#[test]
fn author_sort_key_keeps_comma_and_mononym_forms_verbatim() {
    assert_eq!(author_sort_key("Weir, Andy"), "Weir, Andy");
    assert_eq!(author_sort_key("Plato"), "Plato");
    assert_eq!(author_sort_key("  Madonna  "), "Madonna");
}

#[test]
fn author_sort_key_is_idempotent() {
    for name in ["Andy Weir", "Weir, Andy", "Plato", "Ursula K. Le Guin"] {
        let once = author_sort_key(name);
        assert_eq!(author_sort_key(&once), once, "not idempotent for {name:?}");
    }
}

#[test]
fn creator_sort_key_trusts_a_comma_form_file_as() {
    assert_eq!(
        creator_sort_key(Some("Pérez Galdós, Benito"), "Benito Pérez Galdós"),
        "Pérez Galdós, Benito"
    );
}

#[test]
fn creator_sort_key_derives_from_the_name_when_file_as_is_given_name_form() {
    assert_eq!(
        creator_sort_key(Some("Andy Weir"), "Andy Weir"),
        "Weir, Andy"
    );
    assert_eq!(
        creator_sort_key(Some("Underwood"), "Erin A. Craig"),
        "Craig, Erin A.",
        "a bare surname or pseudonym in file-as must not win"
    );
    assert_eq!(creator_sort_key(None, "Andy Weir"), "Weir, Andy");
    assert_eq!(creator_sort_key(Some("  "), "Andy Weir"), "Weir, Andy");
}

#[test]
fn creator_sort_key_falls_back_to_file_as_when_the_name_is_blank() {
    assert_eq!(creator_sort_key(Some("Andy Weir"), " "), "Weir, Andy");
}
