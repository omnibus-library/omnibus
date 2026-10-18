use super::*;

#[test]
fn with_format_adds_a_hidden_format_in_sorted_order() {
    let hidden = vec!["pdf".to_string()];
    assert_eq!(with_format(hidden, "cbz", true), ["cbz", "pdf"]);
}

#[test]
fn with_format_removes_an_unhidden_format() {
    let hidden = vec!["cbz".to_string(), "pdf".to_string()];
    assert_eq!(with_format(hidden, "cbz", false), ["pdf"]);
}

#[test]
fn with_format_never_lists_a_format_twice() {
    let hidden = vec!["cbz".to_string()];
    assert_eq!(with_format(hidden, "cbz", true), ["cbz"]);
}

#[test]
fn format_options_keeps_a_saved_format_the_list_does_not_know() {
    let hidden = vec!["djvu".to_string()];
    let options = format_options(&hidden);
    assert_eq!(options.first().map(String::as_str), Some("epub"));
    assert_eq!(options.last().map(String::as_str), Some("djvu"));
}
