//! Tests for the authors-list ordering helpers: `sort_key` prefers the
//! explicit sort field, `first_letter` groups by that same key, names sort in
//! the library's dictionary order, and the Recent sort, Reading filter and
//! default author follow the reader's progress.

use super::*;

fn reading(id: i64, reading: usize, last: Option<i64>) -> (i64, AuthorReading) {
    (
        id,
        AuthorReading {
            author_id: id,
            finished: 0,
            reading,
            last_read_at: last,
        },
    )
}

fn query(sort: AuthorSort) -> ListQuery<'static> {
    ListQuery {
        text: "",
        sort,
        reading: None,
        only_reading: false,
    }
}

fn author(name: &str, sort: Option<&str>) -> AuthorSummary {
    AuthorSummary {
        id: 0,
        name: name.into(),
        sort: sort.map(Into::into),
        book_count: 0,
        accent: None,
        has_photo: false,
    }
}

#[test]
fn sort_key_uses_comma_form_sort_verbatim() {
    let a = author("Louisa May Alcott", Some("Alcott, Louisa May"));
    assert_eq!(sort_key(&a), "Alcott, Louisa May");
    assert_eq!(first_letter(&a), 'A');
}

#[test]
fn sort_key_ignores_commaless_sort_and_falls_back_to_name() {
    // Regression: a comma-less `sort` value (some real-world dumps
    // stuff a pseudonym or bare surname here, e.g. "Underwood" for
    // an author whose display name is "Erin A. Craig") used to win,
    // grouping Erin under U. Now we treat it as garbage and derive
    // the surname from the display name instead.
    let a = author("Erin A. Craig", Some("Underwood"));
    assert_eq!(sort_key(&a), "Craig, Erin A.");
    assert_eq!(first_letter(&a), 'C');
}

#[test]
fn sort_key_falls_back_to_name_when_sort_missing() {
    let a = author("Ada Lovelace", None);
    assert_eq!(sort_key(&a), "Lovelace, Ada");
    assert_eq!(first_letter(&a), 'L');
}

#[test]
fn sort_key_treats_lastname_first_display_name_verbatim() {
    // Some Calibre dumps store the display name itself as
    // "Surname, Given". Keep it as-is — `rsplitn(2, ' ')` would
    // otherwise treat "Olivia" as the surname.
    let a = author("Atwater, Olivia", None);
    assert_eq!(sort_key(&a), "Atwater, Olivia");
    assert_eq!(first_letter(&a), 'A');
}

#[test]
fn sort_key_handles_mononym() {
    let a = author("Plato", None);
    assert_eq!(sort_key(&a), "Plato");
    assert_eq!(first_letter(&a), 'P');
}

#[test]
fn sort_key_handles_empty_sort_string() {
    // Explicit empty string in `sort` should be ignored the same
    // way as `None`.
    let a = author("Ada Lovelace", Some(""));
    assert_eq!(sort_key(&a), "Lovelace, Ada");
    assert_eq!(first_letter(&a), 'L');
}

#[test]
fn first_letter_buckets_non_alpha_under_hash() {
    // Digits, punctuation, and non-Latin scripts collapse into the
    // single '#' section after Z. The test names use mononyms so
    // `sort_key` doesn't pull a Latin surname out of a multi-word
    // string (e.g. "1984 Editorial" would derive "Editorial, 1984"
    // and land under E — which is correct, but not what this test
    // is checking).
    //
    // We also avoid Latin diacritics here because their byte form
    // depends on source-file Unicode normalization — `chars().next()`
    // on NFD-encoded "Émile" returns plain `E`, which would land
    // under E. Either bucket is defensible; what matters is that
    // unambiguously-non-Latin starts land under '#'.
    assert_eq!(first_letter(&author("1984", None)), '#');
    assert_eq!(first_letter(&author("[Anonymous]", None)), '#');
    assert_eq!(first_letter(&author("\u{4E2D}\u{6587}", None)), '#');
}

#[test]
fn is_non_alpha_key_classifies_keys() {
    assert!(!is_non_alpha_key("Alcott, Louisa May"));
    assert!(!is_non_alpha_key("zZz"));
    assert!(is_non_alpha_key("1984"));
    assert!(is_non_alpha_key("[Anonymous]"));
    assert!(is_non_alpha_key("\u{4E2D}\u{6587}"));
    assert!(is_non_alpha_key(""));
}

#[test]
fn filter_authors_returns_all_when_query_is_empty() {
    let all = [
        author("Ada Lovelace", None),
        author("Louisa May Alcott", None),
    ];
    let out = filter_authors(&all, "");
    assert_eq!(out.len(), 2);
}

#[test]
fn filter_authors_matches_lowercase_query_against_mixed_case_name() {
    // `filter_authors` folds each author's name before comparing, but
    // takes `query` as-is — callers (e.g. `AuthorsIndexPage`) are
    // responsible for folding the query first.
    let all = [
        author("Ada Lovelace", None),
        author("Louisa May Alcott", None),
    ];
    let out = filter_authors(&all, "lovelace");
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].name, "Ada Lovelace");
}

#[test]
fn filter_authors_matches_a_query_typed_without_the_names_diacritics() {
    let all = [
        author("Benito Pérez Galdós", None),
        author("Ada Lovelace", None),
    ];
    assert_eq!(filter_authors(&all, "perez galdos").len(), 1);
}

#[test]
fn compute_author_groups_keeps_an_accented_name_in_its_existing_letter_bucket() {
    let all = [
        author("Benito Pérez Galdós", None),
        author("Ada Lovelace", None),
    ];
    let groups = compute_author_groups(&all, query(AuthorSort::Name));

    let letters: Vec<(char, Vec<&str>)> = groups
        .letters
        .iter()
        .map(|(letter, authors)| {
            (
                *letter,
                authors.iter().map(|author| author.name.as_str()).collect(),
            )
        })
        .collect();
    assert_eq!(
        letters,
        vec![
            ('G', vec!["Benito Pérez Galdós"]),
            ('L', vec!["Ada Lovelace"]),
        ]
    );
}

#[test]
fn sort_authors_by_name_orders_alpha_before_non_alpha_bucket() {
    let all = [author("1984", None), author("Ada Lovelace", None)];
    let mut filtered: Vec<&AuthorSummary> = all.iter().collect();
    sort_authors(&mut filtered, AuthorSort::Name, None);
    assert_eq!(filtered[0].name, "Ada Lovelace");
    assert_eq!(filtered[1].name, "1984");
}

/// A given-name-form `sort` keys from the display name, as the library does.
#[test]
fn sort_authors_by_name_orders_accented_surnames_in_dictionary_order() {
    let all = [
        author("Sarah Polk", Some("Polk, Sarah")),
        author("Benito Pérez Galdós", Some("Pérez Galdós, Benito")),
        author("Anne Perry", None),
        author("Bret Pettichord", Some("Bret Pettichord")),
        author("Ana Pérez", Some("Pérez, Ana")),
        author("Ana Perez", Some("Perez, Ana")),
    ];
    let mut filtered: Vec<&AuthorSummary> = all.iter().collect();
    sort_authors(&mut filtered, AuthorSort::Name, None);
    let names: Vec<&str> = filtered.iter().map(|a| a.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "Ana Perez",
            "Ana Pérez",
            "Benito Pérez Galdós",
            "Anne Perry",
            "Bret Pettichord",
            "Sarah Polk",
        ]
    );
    assert!(filtered.iter().all(|a| first_letter(a) == 'P'));
}

#[test]
fn first_letter_files_an_accented_initial_under_its_letter() {
    let a = author("Paul Éluard", None);
    assert_eq!(sort_key(&a), "Éluard, Paul");
    assert_eq!(first_letter(&a), 'E');
    assert!(!is_non_alpha_key(&sort_key(&a)));
}

#[test]
fn sort_authors_by_book_count_orders_descending_then_name() {
    let mut low = author("Alpha", None);
    low.book_count = 3;
    let mut high = author("Bravo", None);
    high.book_count = 7;
    let all = [low, high];
    let mut filtered: Vec<&AuthorSummary> = all.iter().collect();
    sort_authors(&mut filtered, AuthorSort::BookCount, None);
    assert_eq!(filtered[0].name, "Bravo");
    assert_eq!(filtered[1].name, "Alpha");
}

#[test]
fn group_by_letter_buckets_by_first_letter_when_shown() {
    // `group_by_letter` only merges *consecutive* same-letter entries — it
    // relies on the caller (the `use_memo` pipeline in `AuthorsIndexPage`)
    // to have already run `sort_authors` first. Both surnames here
    // ("Lovelace", "Lowe") start with 'L' and are given already in sorted
    // order, matching that contract.
    let all = [author("Ada Lovelace", None), author("Bob Lowe", None)];
    let groups = group_by_letter(&all, true);
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].0, 'L');
    assert_eq!(groups[0].1.len(), 2);
}

#[test]
fn group_by_letter_returns_empty_when_show_letters_is_false() {
    let all = [author("Ada Lovelace", None)];
    let groups = group_by_letter(&all, false);
    assert!(groups.is_empty());
}

#[test]
fn sort_authors_by_recent_puts_the_latest_read_first_and_the_unread_after() {
    let mut all = [
        author("Ada Lovelace", None),
        author("Bob Lowe", None),
        author("Cy Twombly", None),
    ];
    for (i, a) in all.iter_mut().enumerate() {
        a.id = i as i64 + 1;
    }
    let map: ReadingMap = [reading(1, 0, Some(10)), reading(3, 1, Some(20))].into();
    let mut filtered: Vec<&AuthorSummary> = all.iter().collect();
    sort_authors(&mut filtered, AuthorSort::Recent, Some(&map));
    let names: Vec<&str> = filtered.iter().map(|a| a.name.as_str()).collect();
    assert_eq!(names, ["Cy Twombly", "Ada Lovelace", "Bob Lowe"]);
}

#[test]
fn compute_author_groups_keeps_only_authors_in_progress_when_asked() {
    let mut all = [author("Ada Lovelace", None), author("Bob Lowe", None)];
    all[0].id = 1;
    all[1].id = 2;
    let map: ReadingMap = [reading(1, 0, Some(10)), reading(2, 1, Some(5))].into();
    let groups = compute_author_groups(
        &all,
        ListQuery {
            reading: Some(&map),
            only_reading: true,
            ..query(AuthorSort::Name)
        },
    );
    let names: Vec<&str> = groups.filtered.iter().map(|a| a.name.as_str()).collect();
    assert_eq!(names, ["Bob Lowe"]);
}

#[test]
fn compute_author_groups_ignores_the_reading_filter_until_progress_loads() {
    let all = [author("Ada Lovelace", None)];
    let groups = compute_author_groups(
        &all,
        ListQuery {
            only_reading: true,
            ..query(AuthorSort::Name)
        },
    );
    assert_eq!(groups.filtered.len(), 1);
}

#[test]
fn default_author_is_the_one_read_most_recently() {
    let mut all = [author("Ada Lovelace", None), author("Bob Lowe", None)];
    all[0].id = 1;
    all[1].id = 2;
    let map: ReadingMap = [reading(1, 0, Some(10)), reading(2, 0, Some(50))].into();
    assert_eq!(default_author(&all, Some(&map)), Some(2));
}

#[test]
fn default_author_falls_back_to_the_first_by_surname() {
    let mut all = [author("Bob Lowe", None), author("Ada Abbott", None)];
    all[0].id = 1;
    all[1].id = 2;
    assert_eq!(default_author(&all, None), Some(2));
    assert_eq!(default_author(&[], None), None);
}

#[test]
fn name_parts_splits_the_surname_key_and_keeps_a_mononym_whole() {
    assert_eq!(
        name_parts(&author("Ursula K. Le Guin", Some("Le Guin, Ursula K."))),
        ("Le Guin".to_string(), "Ursula K.".to_string())
    );
    assert_eq!(
        name_parts(&author("Plato", None)),
        ("Plato".to_string(), String::new())
    );
}
