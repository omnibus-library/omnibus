//! `normalize_pubdate` on every date shape a provider has handed the check-in
//! flow, and `year_of` on the values `books.pubdate` already holds.

use super::{normalize_pubdate, year_of};

#[test]
fn normalize_pubdate_keeps_an_iso_date_month_or_year_as_is() {
    assert_eq!(
        normalize_pubdate("2015-08-04").as_deref(),
        Some("2015-08-04")
    );
    assert_eq!(normalize_pubdate("2015-08").as_deref(), Some("2015-08"));
    assert_eq!(normalize_pubdate(" 2015 ").as_deref(), Some("2015"));
}

#[test]
fn normalize_pubdate_strips_a_time_suffix_from_an_iso_date() {
    assert_eq!(
        normalize_pubdate("2015-08-04T00:00:00Z").as_deref(),
        Some("2015-08-04")
    );
}

#[test]
fn normalize_pubdate_reduces_a_locale_formatted_date_to_its_year() {
    // The shape Google Books hands the check-in flow for a US edition.
    assert_eq!(normalize_pubdate("8/4/2015").as_deref(), Some("2015"));
    assert_eq!(normalize_pubdate("August 4, 2015").as_deref(), Some("2015"));
    assert_eq!(normalize_pubdate("c. 1813").as_deref(), Some("1813"));
    assert_eq!(normalize_pubdate("04-08-2015").as_deref(), Some("2015"));
}

#[test]
fn normalize_pubdate_drops_a_value_with_no_year_in_it() {
    assert_eq!(normalize_pubdate("unknown"), None);
    assert_eq!(normalize_pubdate("12345"), None);
    assert_eq!(normalize_pubdate(""), None);
}

#[test]
fn year_of_reads_the_leading_year_of_an_iso_date() {
    assert_eq!(year_of("2022-06-14").as_deref(), Some("2022"));
    assert_eq!(year_of("1965").as_deref(), Some("1965"));
}

#[test]
fn year_of_finds_the_year_inside_a_locale_formatted_date() {
    assert_eq!(year_of("8/4/2015").as_deref(), Some("2015"));
    assert_eq!(year_of("4 August 2015").as_deref(), Some("2015"));
}

#[test]
fn year_of_is_none_rather_than_a_truncated_fragment() {
    // `SUBSTR(pubdate, 1, 4)` used to answer "8/4/" here.
    assert_eq!(year_of("8/4/"), None);
    assert_eq!(year_of("n.d."), None);
}
