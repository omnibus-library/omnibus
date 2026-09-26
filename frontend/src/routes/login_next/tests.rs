//! Tests for the `?next=` a sign-in carries: how it is written, how it parses
//! back through the router, and which values the login page refuses.

use std::str::FromStr;

use super::*;

/// The `next` the router hands the login page for `href`.
fn parsed_next(href: &str) -> Option<String> {
    match Route::from_str(href) {
        Ok(Route::Login { next }) => next,
        other => panic!("{href} should parse as the login route, got {other:?}"),
    }
}

/// Where a sign-in lands after arriving through `login_href(next)`.
fn round_trip(next: &str) -> Option<Route> {
    safe_next(parsed_next(&login_href(next)).as_deref())
}

#[test]
fn login_href_percent_encodes_the_path_into_next() {
    assert_eq!(login_href("/stats"), "/login?next=%2Fstats");
    assert_eq!(
        login_href("/settings?section=library"),
        "/login?next=%2Fsettings%3Fsection%3Dlibrary"
    );
}

#[test]
fn login_href_is_bare_for_the_landing_page() {
    assert_eq!(login_href("/"), "/login");
    assert_eq!(login_href(""), "/login");
}

#[test]
fn login_href_round_trips_a_page_through_the_router() {
    assert_eq!(round_trip("/stats"), Some(Route::Stats {}));
    assert_eq!(
        round_trip("/books/book-a"),
        Some(Route::BookDetail {
            uuid: "book-a".into()
        })
    );
    assert_eq!(
        round_trip("/settings?section=library"),
        Some(Route::Settings {
            section: Some("library".into())
        })
    );
}

#[test]
fn login_href_keeps_every_query_argument_when_next_carries_two() {
    // Without the extra escape the router splits `page=4` off into a sibling
    // of `next` and the reader returns to page one.
    assert_eq!(
        round_trip("/pdf/book-a?file_id=917&page=4"),
        Some(Route::PdfRead {
            uuid: "book-a".into(),
            file_id: Some(917),
            page: Some(4),
        })
    );
}

#[test]
fn login_href_round_trips_an_already_encoded_path_segment() {
    // A server redirect carries the request path as sent, still encoded.
    assert_eq!(
        round_trip("/search/night%20watch"),
        Some(Route::Search {
            query: "night watch".into()
        })
    );
    assert_eq!(
        round_trip("/search/salt%26iron"),
        Some(Route::Search {
            query: "salt&iron".into()
        })
    );
}

#[test]
fn login_target_from_returns_the_reader_to_the_page_they_were_on() {
    assert_eq!(
        login_target_from(&Route::Stats {}),
        NavigationTarget::Internal("/login?next=%2Fstats".into())
    );
    // The router's dangling `?` for an absent query argument stays out of it.
    assert_eq!(
        login_target_from(&Route::Settings { section: None }),
        NavigationTarget::Internal("/login?next=%2Fsettings".into())
    );
}

#[test]
fn login_target_from_is_bare_for_the_landing_page_and_an_unknown_path() {
    assert_eq!(
        login_target_from(&Route::Landing {}),
        NavigationTarget::Internal("/login".into())
    );
    assert_eq!(
        login_target_from(&Route::NotFound {
            segments: vec!["nowhere".into()]
        }),
        NavigationTarget::Internal("/login".into())
    );
}

#[test]
fn login_target_is_bare_login() {
    assert_eq!(login_target(), NavigationTarget::Internal("/login".into()));
}

#[test]
fn safe_next_accepts_an_in_app_page() {
    assert_eq!(safe_next(Some("/stats")), Some(Route::Stats {}));
    assert_eq!(safe_next(Some("/")), Some(Route::Landing {}));
}

#[test]
fn safe_next_refuses_a_missing_or_empty_next() {
    assert_eq!(safe_next(None), None);
    assert_eq!(safe_next(Some("")), None);
}

#[test]
fn safe_next_refuses_an_off_site_target() {
    for hostile in [
        "//evil.com",
        "//evil.com/stats",
        "/\\evil.com",
        "\\\\evil.com",
        "https://evil.com",
        "http://evil.com/stats",
        "javascript:alert(1)",
        "evil.com",
        "stats",
        "/books/x?next=https://evil.com",
        "/\t/evil.com",
        "/\n/evil.com",
    ] {
        assert_eq!(
            safe_next(Some(hostile)),
            None,
            "{hostile:?} must be refused"
        );
    }
}

#[test]
fn safe_next_refuses_the_sign_in_screens_and_an_unknown_path() {
    for loop_back in [
        "/login",
        "/login?next=/x",
        "/login?next=%2Fstats",
        "/register",
        "/connect",
        "/api/auth/me",
        "/assets/atrium.css",
        "/nowhere",
    ] {
        assert_eq!(
            safe_next(Some(loop_back)),
            None,
            "{loop_back:?} must be refused"
        );
    }
}
