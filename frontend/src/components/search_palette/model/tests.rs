use omnibus_shared::{PaletteBookHit, PaletteGenreHit, PaletteResults};

use super::*;
use crate::pages::matching_settings;

fn one_book_and_one_genre() -> PaletteResults {
    PaletteResults {
        books: vec![PaletteBookHit {
            uuid: "book-uuid".to_string(),
            title: "Dracula".to_string(),
            ..PaletteBookHit::default()
        }],
        genres: vec![PaletteGenreHit {
            name: "Gothic".to_string(),
            book_count: 1,
        }],
        ..PaletteResults::default()
    }
}

#[test]
fn build_flat_items_appends_settings_after_every_server_group() {
    let settings = matching_settings("theme", false);

    let items = build_flat_items(&Some(one_book_and_one_genre()), &settings);

    assert_eq!(
        items,
        vec![
            FlatItem::Book {
                uuid: "book-uuid".to_string(),
                title: "Dracula".to_string(),
            },
            FlatItem::Genre {
                name: "Gothic".to_string(),
            },
            FlatItem::Setting(settings[0]),
        ]
    );
}

#[test]
fn build_flat_items_lists_settings_while_the_server_results_are_still_out() {
    let settings = matching_settings("kobo", false);

    let items = build_flat_items(&None, &settings);

    assert_eq!(items, vec![FlatItem::Setting(settings[0])]);
}

#[test]
fn is_selected_finds_a_settings_row_counted_past_the_server_rows() {
    let settings = matching_settings("theme", false);
    let items = build_flat_items(&Some(one_book_and_one_genre()), &settings);

    assert!(is_selected(&items, 2, &FlatItem::Setting(settings[0])));
    assert!(!is_selected(&items, 0, &FlatItem::Setting(settings[0])));
}

#[test]
fn keep_selection_follows_the_highlighted_setting_when_results_land_ahead_of_it() {
    let settings = matching_settings("kobo", false);
    let before = build_flat_items(&None, &settings);
    let after = build_flat_items(&Some(one_book_and_one_genre()), &settings);

    assert_eq!(keep_selection(&before, 0, &after), 2);
}

#[test]
fn keep_selection_starts_at_the_top_when_the_highlighted_row_is_gone() {
    let before = build_flat_items(&Some(one_book_and_one_genre()), &[]);
    let after = build_flat_items(&Some(PaletteResults::default()), &[]);

    assert_eq!(keep_selection(&before, 1, &after), 0);
}
