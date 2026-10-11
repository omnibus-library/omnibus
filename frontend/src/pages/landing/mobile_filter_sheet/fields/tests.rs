//! Unit tests for what a field section shows beside the values its source
//! offers.

use crate::components::filter_bar::values::FilterOption;

use super::*;

fn offered(values: &[&str]) -> Rc<OptionList> {
    Rc::new(OptionList::new(
        values
            .iter()
            .map(|v| FilterOption {
                value: (*v).to_string(),
                label: (*v).to_string(),
                count: Some(1),
            })
            .collect(),
    ))
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| (*v).to_string()).collect()
}

#[test]
fn stranded_label_calls_a_shelf_the_list_lacks_unavailable() {
    assert_eq!(stranded_label(FilterField::Shelf, "9"), "unavailable shelf");
}

#[test]
fn stranded_label_uppercases_a_format_and_leaves_other_names_as_they_are() {
    assert_eq!(stranded_label(FilterField::Format, "pdf"), "PDF");
    assert_eq!(stranded_label(FilterField::Tag, "Sci-Fi"), "Sci-Fi");
}

#[test]
fn list_with_picks_keeps_the_same_list_when_every_pick_is_offered() {
    let list = offered(&["a", "b"]);

    let shown = list_with_picks(FilterField::Tag, list.clone(), &strings(&["a"]));

    assert!(Rc::ptr_eq(&list, &shown));
}

#[test]
fn list_with_picks_adds_a_pick_the_source_stopped_offering_first() {
    let list = offered(&["a"]);

    let shown = list_with_picks(FilterField::Shelf, list, &strings(&["9"]));

    let found = shown.matching("", 10);
    assert_eq!(found.shown[0].value, "9");
    assert_eq!(found.shown[0].label, "unavailable shelf");
    assert_eq!(found.total, 2);
}
