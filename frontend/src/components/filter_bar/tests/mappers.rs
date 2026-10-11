use super::*;

#[test]
fn tag_options_map_each_tag_to_a_counted_option() {
    let options = tag_options(vec![tag("Sci-Fi", 4), tag("Cozy", 2)]);

    assert_eq!(
        options,
        vec![
            option("Sci-Fi", "Sci-Fi", Some(4)),
            option("Cozy", "Cozy", Some(2))
        ]
    );
}

#[test]
fn genre_options_map_each_genre_to_a_counted_option() {
    let options = genre_options(vec![GenreWeight {
        name: "Fantasy".to_string(),
        count: 7,
    }]);

    assert_eq!(options, vec![option("Fantasy", "Fantasy", Some(7))]);
}

#[test]
fn series_options_map_each_series_to_a_counted_option() {
    let options = series_options(vec![SeriesSummary {
        id: 3,
        name: "Pioneers".to_string(),
        book_count: 5,
        ..Default::default()
    }]);

    assert_eq!(options, vec![option("Pioneers", "Pioneers", Some(5))]);
}

#[test]
fn author_options_merge_authors_sharing_a_name_ignoring_case() {
    let options = author_options(vec![
        author("Ann Leckie", 2),
        author("Ada Lovelace", 1),
        author("ann leckie", 3),
    ]);

    assert_eq!(
        options,
        vec![
            option("Ann Leckie", "Ann Leckie", Some(5)),
            option("Ada Lovelace", "Ada Lovelace", Some(1)),
        ]
    );
}

#[test]
fn shelf_options_offer_manual_and_wishlist_shelves_valued_by_id() {
    let options = shelf_options(vec![
        shelf(4, "Favourites", ShelfKind::Manual, 3),
        shelf(5, "Unread sci-fi", ShelfKind::Smart, 9),
        shelf(6, "Wishlist", ShelfKind::Wishlist, 1),
    ]);

    assert_eq!(
        options,
        vec![
            option("4", "Favourites", Some(3)),
            option("6", "Wishlist", Some(1)),
        ]
    );
}

#[test]
fn format_options_value_the_known_formats_lowercase_and_label_them_uppercase() {
    let options = format_options();

    assert_eq!(options.first(), Some(&option("epub", "EPUB", None)));
    assert_eq!(options.len(), omnibus_shared::KNOWN_LIBRARY_FORMATS.len());
}

#[test]
fn options_trim_the_value_they_filter_on() {
    let options = tag_options(vec![tag("  Sci-Fi ", 1)]);

    assert_eq!(options, vec![option("Sci-Fi", "Sci-Fi", Some(1))]);
}

#[test]
fn options_drop_blank_and_over_long_values_the_filter_would_reject() {
    let longest = "x".repeat(omnibus_shared::SHELF_RULE_VALUE_MAX_LEN);
    let too_long = "x".repeat(omnibus_shared::SHELF_RULE_VALUE_MAX_LEN + 1);

    let options = tag_options(vec![
        tag("", 1),
        tag("   ", 1),
        tag(&too_long, 1),
        tag(&longest, 1),
    ]);

    assert_eq!(options, vec![option(&longest, &longest, Some(1))]);
}

#[test]
fn matching_keeps_options_whose_label_contains_the_query_ignoring_case() {
    let options = tag_options(vec![
        tag("Sci-Fi", 1),
        tag("Cozy", 1),
        tag("Space Opera", 1),
    ]);

    let found = matching(&options, "SCI", 10);

    assert_eq!(found.shown, vec![&options[0]]);
    assert_eq!(found.total, 1);
}

#[test]
fn matching_caps_the_shown_options_but_reports_the_total() {
    let options = tag_options(vec![tag("a1", 1), tag("a2", 1), tag("a3", 1)]);

    let found = matching(&options, "a", 2);

    assert_eq!(found.shown, vec![&options[0], &options[1]]);
    assert_eq!(found.total, 3);
}
