//! Unit tests for a field section's picks and how a tick updates the prefs.

use omnibus_shared::FilterClause;

use super::*;

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| (*v).to_string()).collect()
}

fn filters_of(clauses: Vec<FilterClause>) -> ViewFilters {
    ViewFilters { clauses }
}

#[test]
fn sections_list_every_filter_field_in_picker_order() {
    let fields: Vec<FilterField> = sections(&ViewFilters::default())
        .iter()
        .map(|section| section.field)
        .collect();

    assert_eq!(fields, FILTER_FIELDS.to_vec());
}

#[test]
fn sections_read_the_include_and_exclude_picks_of_a_field_apart() {
    let filters = filters_of(vec![
        FilterClause::new(FilterField::Tag, FilterMode::Include, &["a", "b"]),
        FilterClause::new(FilterField::Tag, FilterMode::Exclude, &["x"]),
        FilterClause::new(FilterField::Series, FilterMode::Include, &["s"]),
    ]);

    let all = sections(&filters);

    let tag = all.iter().find(|s| s.field == FilterField::Tag).unwrap();
    assert_eq!(tag.picked(FilterMode::Include), strings(&["a", "b"]));
    assert_eq!(tag.picked(FilterMode::Exclude), strings(&["x"]));
    assert_eq!(tag.count(), 3);
    let genre = all.iter().find(|s| s.field == FilterField::Genre).unwrap();
    assert_eq!(genre.count(), 0);
}

#[test]
fn sections_offer_every_field_in_both_modes() {
    for section in sections(&ViewFilters::default()) {
        for mode in [FilterMode::Include, FilterMode::Exclude] {
            let mut filters = ViewFilters::default();
            toggle_value(&mut filters, section.field, mode, "v");

            let ticked = sections(&filters);

            let ours = ticked.iter().find(|s| s.field == section.field).unwrap();
            assert_eq!(ours.picked(mode), strings(&["v"]));
            assert_eq!(ours.count(), 1);
        }
    }
}

thread_local! {
    static TICKED_PICKS: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[test]
fn ticked_builds_from_the_prefs_as_they_are_now_not_an_earlier_snapshot() {
    // A panic inside a component is swallowed by the vdom, so the outcome
    // leaves it through a thread-local and is asserted out here.
    #[component]
    fn TickLive() -> Element {
        let mut prefs = Signal::new(ViewPrefs::default());
        prefs.with_mut(|p| {
            p.filters = filters_of(vec![FilterClause::new(
                FilterField::Tag,
                FilterMode::Include,
                &["first"],
            )]);
        });

        let next = ticked(prefs, FilterField::Tag, FilterMode::Include, "second");

        let picked = picked_values(&next.filters, FilterField::Tag, FilterMode::Include);
        TICKED_PICKS.with(|seen| *seen.borrow_mut() = picked);
        rsx! {}
    }
    VirtualDom::new(TickLive).rebuild_in_place();

    TICKED_PICKS.with(|seen| assert_eq!(*seen.borrow(), strings(&["first", "second"])));
}
