//! SSR render checks for the suggestions strip's settled states.

use super::*;

fn strip(suggestions: Option<SuggestionsResponse>) -> String {
    dioxus::ssr::render_element(rsx! {
        BdSuggestionsStrip {
            book_title: "Dune".to_string(),
            suggestions,
            ctx: BdPageCtx { server_url: String::new(), is_admin: false },
        }
    })
}

#[test]
fn the_strip_announces_an_unavailable_lookup_through_a_status_region() {
    let html = strip(Some(SuggestionsResponse::Unavailable));

    let status = html.find("role=\"status\"").expect(&html);
    let note = html
        .find("data-testid=\"suggestions-unavailable\"")
        .expect(&html);
    assert!(
        status < note,
        "the note must sit inside the status region: {html}"
    );
}

#[test]
fn the_strip_announces_a_pending_lookup_through_a_status_region() {
    let html = strip(Some(SuggestionsResponse::Pending));

    let status = html.find("role=\"status\"").expect(&html);
    let note = html
        .find("data-testid=\"suggestions-pending\"")
        .expect(&html);
    assert!(status < note, "{html}");
}
