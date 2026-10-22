//! Tests for the series-list ordering helpers: `sort_key` prefers the stored
//! sort and drops a leading "The", names sort and file by that key, the
//! filter reads the name and the author, and the Recent sort, Reading filter
//! and default series follow the reader's progress.

use super::*;

fn series(id: i64, name: &str, author: Option<&str>, book_count: usize) -> SeriesSummary {
    SeriesSummary {
        id,
        name: name.into(),
        primary_author: author.map(Into::into),
        book_count,
        ..Default::default()
    }
}

fn named(name: &str, sort: Option<&str>) -> SeriesSummary {
    SeriesSummary {
        name: name.into(),
        sort: sort.map(Into::into),
        ..Default::default()
    }
}

fn reading(id: i64, reading: usize, last: Option<i64>) -> (i64, SeriesReading) {
    (
        id,
        SeriesReading {
            series_id: id,
            finished: 0,
            reading,
            last_read_at: last,
        },
    )
}

fn query(sort: BrowseSort) -> ListQuery<'static> {
    ListQuery {
        text: "",
        sort,
        reading: None,
        only_reading: false,
    }
}

fn names(groups: &SeriesGroups) -> Vec<&str> {
    groups.filtered.iter().map(|s| s.name.as_str()).collect()
}

#[test]
fn sort_key_prefers_the_stored_sort_and_ignores_an_empty_one() {
    assert_eq!(sort_key(&named("The Expanse", Some("Expanse"))), "Expanse");
    assert_eq!(sort_key(&named("Foundation", Some(""))), "Foundation");
}

#[test]
fn sort_key_strips_only_a_leading_the_word() {
    assert_eq!(sort_key(&named("The Foo Bar", None)), "Foo Bar");
    assert_eq!(sort_key(&named("the foo bar", None)), "foo bar");
    assert_eq!(sort_key(&named("Theology", None)), "Theology");
}

#[test]
fn first_letter_files_a_series_by_its_key() {
    assert_eq!(first_letter(&named("The Expanse", None)), 'E');
    assert_eq!(first_letter(&named("1Q84", None)), '#');
}

#[test]
fn compute_series_groups_orders_by_key_with_non_alpha_last_and_groups_letters() {
    let all = [
        series(1, "1Q84", None, 3),
        series(2, "The Expanse", None, 9),
        series(3, "Dune", None, 6),
        series(4, "Earthsea", None, 5),
    ];
    let groups = compute_series_groups(&all, query(BrowseSort::Name));
    assert_eq!(names(&groups), ["Dune", "Earthsea", "The Expanse", "1Q84"]);
    let letters: Vec<(char, usize)> = groups.letters.iter().map(|(l, g)| (*l, g.len())).collect();
    assert_eq!(letters, [('D', 1), ('E', 2), ('#', 1)]);
}

#[test]
fn compute_series_groups_sorts_by_book_count_without_letters() {
    let all = [
        series(1, "Alpha", None, 3),
        series(2, "Bravo", None, 7),
        series(3, "Charlie", None, 7),
    ];
    let groups = compute_series_groups(&all, query(BrowseSort::BookCount));
    assert_eq!(names(&groups), ["Bravo", "Charlie", "Alpha"]);
    assert!(groups.letters.is_empty());
}

#[test]
fn filter_series_matches_the_name_or_the_author_without_diacritics() {
    let all = [
        series(1, "Les Misérables", None, 1),
        series(2, "Dune", Some("Frank Herbert"), 6),
    ];
    let by_name: Vec<&str> = filter_series(&all, "miserables")
        .iter()
        .map(|s| s.name.as_str())
        .collect();
    assert_eq!(by_name, ["Les Misérables"]);
    let by_author: Vec<&str> = filter_series(&all, "herbert")
        .iter()
        .map(|s| s.name.as_str())
        .collect();
    assert_eq!(by_author, ["Dune"]);
}

#[test]
fn sort_series_by_recent_puts_the_latest_read_first_and_the_unread_after() {
    let all = [
        series(1, "Alpha", None, 1),
        series(2, "Bravo", None, 1),
        series(3, "Charlie", None, 1),
    ];
    let map: ReadingMap = [reading(2, 0, Some(10)), reading(3, 1, Some(20))].into();
    let mut rows: Vec<&SeriesSummary> = all.iter().collect();
    sort_series(&mut rows, BrowseSort::Recent, Some(&map));
    let order: Vec<&str> = rows.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(order, ["Charlie", "Bravo", "Alpha"]);
}

#[test]
fn compute_series_groups_keeps_only_series_in_progress_when_asked() {
    let all = [series(1, "Alpha", None, 2), series(2, "Bravo", None, 2)];
    let map: ReadingMap = [reading(1, 0, Some(1)), reading(2, 1, Some(2))].into();
    let groups = compute_series_groups(
        &all,
        ListQuery {
            reading: Some(&map),
            only_reading: true,
            ..query(BrowseSort::Name)
        },
    );
    assert_eq!(names(&groups), ["Bravo"]);
}

#[test]
fn compute_series_groups_ignores_the_reading_filter_until_progress_loads() {
    let all = [series(1, "Alpha", None, 2), series(2, "Bravo", None, 2)];
    let groups = compute_series_groups(
        &all,
        ListQuery {
            only_reading: true,
            ..query(BrowseSort::Name)
        },
    );
    assert_eq!(groups.filtered.len(), 2);
}

#[test]
fn default_series_is_the_one_read_most_recently() {
    let all = [series(1, "Alpha", None, 1), series(2, "Bravo", None, 1)];
    let map: ReadingMap = [reading(1, 0, Some(5)), reading(2, 0, Some(9))].into();
    assert_eq!(default_series(&all, Some(&map)), Some(2));
}

#[test]
fn default_series_falls_back_to_the_first_by_name() {
    let all = [series(1, "The Zoo", None, 1), series(2, "Bravo", None, 1)];
    assert_eq!(default_series(&all, None), Some(2));
    assert_eq!(default_series(&[], None), None);
}
