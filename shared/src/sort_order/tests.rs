//! The dictionary order every sort surface shares, and the author key shapes
//! it compares.

use std::cmp::Ordering;

use super::*;

/// The order the reader chose for #2451: accents ignored, the comma ending
/// the surname, so `Pérez Galdós` files after `Perez` and before `Perry`.
const DICTIONARY_ORDER: [&str; 5] = [
    "Perez, Ana",
    "Pérez Galdós, Benito",
    "Perry, Anne",
    "Pettichord, Bret",
    "Polk, Sarah",
];

#[test]
fn dictionary_cmp_files_accented_names_in_dictionary_order() {
    let mut names = DICTIONARY_ORDER;
    names.reverse();
    names.sort_by(|a, b| dictionary_cmp(a, b));
    assert_eq!(names, DICTIONARY_ORDER);
}

#[test]
fn dictionary_cmp_puts_the_plain_spelling_first_on_a_tie() {
    assert_eq!(dictionary_cmp("Perez", "Pérez"), Ordering::Less);
    assert_eq!(dictionary_cmp("Pérez", "Perez"), Ordering::Greater);
    assert_eq!(dictionary_cmp("Pérez", "Pérez"), Ordering::Equal);
}

#[test]
fn dictionary_cmp_ignores_case_before_breaking_the_tie_on_it() {
    assert_eq!(dictionary_cmp("apple", "Banana"), Ordering::Less);
    assert_eq!(dictionary_cmp("Apple", "apple"), Ordering::Less);
}

#[test]
fn dictionary_cmp_agrees_with_its_precomputed_key() {
    let names = [
        "Perez, Ana",
        "Pérez Galdós, Benito",
        "perez, ana",
        "Ōe, Kenzaburō",
        "Oe, Kenzaburo",
        "東京",
        "",
    ];
    for a in names {
        for b in names {
            assert_eq!(
                dictionary_cmp(a, b),
                (dictionary_key(a), a).cmp(&(dictionary_key(b), b)),
                "{a:?} vs {b:?}"
            );
        }
    }
}

#[test]
fn author_dictionary_cmp_files_a_display_name_beside_its_surname_first_key() {
    assert_eq!(
        author_dictionary_cmp("Andy Weir", "Weir, Andy"),
        Ordering::Equal
    );
    assert_eq!(
        author_dictionary_cmp("Benito Pérez", "Perry, Anne"),
        Ordering::Less,
        "Pérez, Benito files before Perry"
    );
}

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
