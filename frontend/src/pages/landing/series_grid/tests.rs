//! `grid_items` placement and the per-stack derivations the tiles draw from.

use omnibus_shared::{EbookMetadata, SeriesStack, StackMemberState};

use super::*;

fn volume(uuid: &str, index: Option<&str>) -> EbookMetadata {
    EbookMetadata {
        unique_identifier: Some(uuid.into()),
        title: Some(uuid.into()),
        series: Some("Saga".into()),
        series_index: index.map(Into::into),
        ..Default::default()
    }
}

fn plain(uuid: &str) -> EbookMetadata {
    EbookMetadata {
        unique_identifier: Some(uuid.into()),
        title: Some(uuid.into()),
        ..Default::default()
    }
}

fn saga(lead: &str, members: &[&str]) -> SeriesStack {
    SeriesStack {
        lead_uuid: lead.into(),
        name: "Saga".into(),
        series_id: Some(7),
        members: members
            .iter()
            .enumerate()
            .map(|(i, u)| volume(u, Some(&(i + 1).to_string())))
            .collect(),
        states: Vec::new(),
    }
}

fn state(uuid: &str, percent: Option<u8>, started: bool, finished: bool) -> StackMemberState {
    StackMemberState {
        uuid: uuid.into(),
        percent,
        started,
        finished,
    }
}

fn kinds(items: &[GridItem]) -> Vec<String> {
    items
        .iter()
        .map(|item| match item {
            GridItem::Book(b) => format!("book:{}", b.unique_identifier.as_deref().unwrap_or("")),
            GridItem::Stack(s) => format!("stack:{}", s.lead_uuid),
            GridItem::Cap(s) => format!("cap:{}", s.lead_uuid),
            GridItem::Vol(v) => {
                format!("vol:{}", v.book.unique_identifier.as_deref().unwrap_or(""))
            }
        })
        .collect()
}

#[test]
fn grid_items_puts_a_folded_stack_in_its_lead_slot_and_leaves_other_books_alone() {
    let books = vec![plain("a"), volume("s2", Some("2")), plain("b")];
    let stacks = vec![saga("s2", &["s1", "s2"])];
    assert_eq!(
        kinds(&grid_items(&books, &stacks, None)),
        vec!["book:a", "stack:s2", "book:b"]
    );
}

#[test]
fn grid_items_deals_an_open_stack_out_as_a_head_card_then_its_volumes_in_series_order() {
    let books = vec![plain("a"), volume("s2", Some("2")), plain("b")];
    let stacks = vec![saga("s2", &["s1", "s2", "s3"])];
    let items = grid_items(&books, &stacks, Some("s2"));
    assert_eq!(
        kinds(&items),
        vec!["book:a", "cap:s2", "vol:s1", "vol:s2", "vol:s3", "book:b"]
    );
    let lasts: Vec<bool> = items
        .iter()
        .filter_map(|item| match item {
            GridItem::Vol(v) => Some(v.last),
            _ => None,
        })
        .collect();
    assert_eq!(lasts, vec![false, false, true]);
}

#[test]
fn grid_items_shows_a_book_for_a_one_member_stack_and_ignores_a_stale_open_key() {
    let books = vec![volume("s1", Some("1"))];
    let one = vec![saga("s1", &["s1"])];
    assert_eq!(
        kinds(&grid_items(&books, &one, Some("s1"))),
        vec!["book:s1"]
    );
    let two = vec![saga("s1", &["s1", "s2"])];
    assert_eq!(
        kinds(&grid_items(&books, &two, Some("gone"))),
        vec!["stack:s1"]
    );
}

#[test]
fn volume_caption_numbers_by_series_index_and_marks_a_finished_volume_read() {
    let mut stack = saga("s1", &["s1", "s2"]);
    stack.states = vec![
        state("s1", None, true, true),
        state("s2", Some(40), true, false),
    ];
    assert_eq!(
        volume_caption(&stack, &stack.members[0], 0),
        "Vol. 1 · read"
    );
    assert_eq!(volume_caption(&stack, &stack.members[1], 1), "Vol. 2");
}

#[test]
fn volume_caption_falls_back_to_the_run_position_without_a_series_index() {
    let stack = saga("x", &["x", "y"]);
    assert_eq!(volume_caption(&stack, &volume("y", None), 1), "Vol. 2");
}

#[test]
fn stack_leaves_fans_the_in_progress_volume_first_and_caps_at_three() {
    let mut stack = saga("s1", &["s1", "s2", "s3", "s4"]);
    stack.states = vec![
        state("s1", None, true, true),
        state("s3", Some(20), true, false),
    ];
    let leaves: Vec<_> = stack_leaves(&stack)
        .into_iter()
        .filter_map(|b| b.unique_identifier)
        .collect();
    assert_eq!(leaves, vec!["s3", "s1", "s2"]);
}

#[test]
fn stack_segments_is_none_until_a_volume_is_started_then_fills_finished_ones_whole() {
    let mut stack = saga("s1", &["s1", "s2", "s3"]);
    assert_eq!(stack_segments(&stack), None);
    stack.states = vec![
        state("s1", None, true, true),
        state("s2", Some(40), true, false),
        state("s3", None, false, false),
    ];
    assert_eq!(stack_segments(&stack), Some(vec![100, 40, 0]));
}

#[test]
fn band_style_tints_with_the_front_accent_and_falls_back_to_the_page_accent() {
    let mut stack = saga("s1", &["s1", "s2"]);
    assert_eq!(band_style(&stack), " --sa: var(--accent);");
    stack.members[0].accent = Some("oklch(0.7 0.1 40)".into());
    assert_eq!(band_style(&stack), " --sa: oklch(0.7 0.1 40);");
}

#[test]
fn grid_items_numbers_each_volume_by_its_place_in_the_deck_and_names_its_stack() {
    let books = vec![volume("s2", Some("2"))];
    let stacks = vec![saga("s2", &["s1", "s2", "s3"])];
    let decks: Vec<(String, usize)> = grid_items(&books, &stacks, Some("s2"))
        .into_iter()
        .filter_map(|item| match item {
            GridItem::Vol(v) => Some((v.lead_uuid, v.deck)),
            _ => None,
        })
        .collect();
    assert_eq!(
        decks,
        vec![
            ("s2".to_string(), 0),
            ("s2".to_string(), 1),
            ("s2".to_string(), 2),
        ]
    );
}

#[test]
fn grid_item_key_names_a_book_by_its_row_and_a_stack_or_head_card_by_its_lead() {
    let stack = saga("s2", &["s1", "s2"]);
    let books = vec![plain("a"), volume("s2", Some("2"))];
    let keys: Vec<String> = grid_items(&books, &[stack.clone()], Some("s2"))
        .iter()
        .map(GridItem::key)
        .collect();
    assert_eq!(keys, vec!["a", "cap-s2", "s1", "s2"]);
    assert_eq!(GridItem::Stack(stack).key(), "stack-s2");
}
