//! The shared stack grouping: the key two books must share, which volume a
//! stack shows in front, and how a whole client-side list collapses.

use super::*;

fn book(uuid: &str, series: Option<&str>, index: Option<&str>) -> EbookMetadata {
    EbookMetadata {
        unique_identifier: Some(uuid.to_string()),
        series: series.map(str::to_string),
        series_index: index.map(str::to_string),
        ..Default::default()
    }
}

fn uuids(books: &[EbookMetadata]) -> Vec<String> {
    books
        .iter()
        .filter_map(|b| b.unique_identifier.clone())
        .collect()
}

fn state(uuid: &str, started: bool, finished: bool) -> StackMemberState {
    StackMemberState {
        uuid: uuid.to_string(),
        percent: None,
        started,
        finished,
    }
}

fn saga(members: Vec<EbookMetadata>, states: Vec<StackMemberState>) -> SeriesStack {
    SeriesStack {
        lead_uuid: "a".into(),
        name: "Saga".into(),
        series_id: None,
        members,
        states,
    }
}

#[test]
fn series_group_key_trims_lowercases_and_drops_blank_names() {
    assert_eq!(
        series_group_key(Some("  The Saga ")),
        Some("the saga".to_string())
    );
    assert_eq!(series_group_key(Some("   ")), None);
    assert_eq!(series_group_key(None), None);
}

#[test]
fn series_group_key_trims_ascii_spaces_only_like_sqlites_trim() {
    assert_eq!(
        series_group_key(Some("\tSaga\t")),
        Some("\tsaga\t".to_string())
    );
}

#[test]
fn front_prefers_the_first_volume_in_progress() {
    let stack = saga(
        vec![
            book("a", Some("Saga"), Some("1")),
            book("b", Some("Saga"), Some("2")),
            book("c", Some("Saga"), Some("3")),
        ],
        vec![
            state("a", true, true),
            state("b", true, false),
            state("c", true, false),
        ],
    );
    assert_eq!(
        stack.front().and_then(|b| b.unique_identifier.as_deref()),
        Some("b")
    );
}

#[test]
fn front_falls_back_to_the_first_volume_when_none_is_in_progress() {
    let stack = saga(
        vec![
            book("a", Some("Saga"), Some("1")),
            book("b", Some("Saga"), Some("2")),
        ],
        vec![state("a", true, true), state("b", true, true)],
    );
    assert_eq!(
        stack.front().and_then(|b| b.unique_identifier.as_deref()),
        Some("a")
    );
}

#[test]
fn stack_books_collapses_a_series_into_the_slot_of_its_first_listed_member() {
    let books = vec![
        book("x", None, None),
        book("s2", Some("Saga"), Some("2")),
        book("y", None, None),
        book("s1", Some("Saga"), Some("1")),
    ];
    let (rows, stacks) = stack_books(&books);
    assert_eq!(uuids(&rows), vec!["x", "s2", "y"]);
    assert_eq!(stacks.len(), 1);
    assert_eq!(stacks[0].lead_uuid, "s2");
    assert_eq!(stacks[0].name, "Saga");
    assert_eq!(uuids(&stacks[0].members), vec!["s1", "s2"]);
    assert!(
        stacks[0].states.is_empty(),
        "a client-side stack reads no state"
    );
}

#[test]
fn stack_books_leaves_singleton_series_and_seriesless_books_unstacked() {
    let books = vec![
        book("a", Some("Solo"), Some("1")),
        book("b", None, None),
        book("c", Some("   "), None),
    ];
    let (rows, stacks) = stack_books(&books);
    assert_eq!(uuids(&rows), vec!["a", "b", "c"]);
    assert!(stacks.is_empty());
}

#[test]
fn stack_books_groups_names_differing_only_in_case_and_spacing() {
    let books = vec![
        book("a", Some("The Saga"), Some("1")),
        book("b", Some(" the saga "), Some("2")),
    ];
    let (rows, stacks) = stack_books(&books);
    assert_eq!(uuids(&rows), vec!["a"]);
    assert_eq!(uuids(&stacks[0].members), vec!["a", "b"]);
}

#[test]
fn stack_books_orders_members_numerically_with_unnumbered_volumes_last() {
    let books = vec![
        book("ten", Some("Saga"), Some("10")),
        book("none", Some("Saga"), None),
        book("two", Some("Saga"), Some("2")),
    ];
    let (_, stacks) = stack_books(&books);
    assert_eq!(uuids(&stacks[0].members), vec!["two", "ten", "none"]);
}

#[test]
fn stack_books_breaks_index_ties_by_dictionary_title_then_id() {
    let mut z = book("z", Some("Saga"), Some("1"));
    (z.title, z.id) = (Some("Echo".to_string()), 3);
    let mut a1 = book("a1", Some("Saga"), Some("1"));
    (a1.title, a1.id) = (Some("Alpha".to_string()), 1);
    let mut a2 = book("a2", Some("Saga"), Some("1"));
    (a2.title, a2.id) = (Some("Alpha".to_string()), 2);
    let books = vec![z, a2, a1];

    let (_, stacks) = stack_books(&books);

    assert_eq!(uuids(&stacks[0].members), vec!["a1", "a2", "z"]);
}
