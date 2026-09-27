//! The `?next=` a sign-in carries. [`login_href`] writes it — for the server's
//! page gate and the client's 401 redirect alike, so both encode it one way —
//! and [`safe_next`] reads it back on the login page, accepting only an in-app
//! page so the form can never be turned into an open redirect.

use std::str::FromStr;

use dioxus_router::navigation::NavigationTarget;

use super::{trim_query_separators, Route};

/// The `/login` href that returns the reader to `next` (a path and query) once they sign in — bare `/login` for the landing page.
pub fn login_href(next: &str) -> String {
    if next.is_empty() || next == "/" {
        return "/login".into();
    }
    // The router percent-decodes a whole query before splitting it on `&`, so
    // an `&` inside `next` must survive one extra decode to stay inside it.
    let encoded = urlencoding::encode(next).replace("%26", "%2526");
    format!("/login?next={encoded}")
}

/// Bare `/login`, for a sign-out the reader chose.
pub fn login_target() -> NavigationTarget {
    NavigationTarget::Internal(login_href("/"))
}

/// The `/login` target for a reader whose session lapsed on `from`: it returns them there once they sign in.
pub fn login_target_from(from: &Route) -> NavigationTarget {
    let href = trim_query_separators(&from.to_string());
    let next = match safe_next(Some(&href)) {
        Some(_) => href.as_str(),
        None => "/",
    };
    NavigationTarget::Internal(login_href(next))
}

/// The page a sign-in carrying `next` lands on: `None` unless `next` is an in-app path naming a page other than the sign-in screens.
pub fn safe_next(next: Option<&str>) -> Option<Route> {
    let next = next?;
    let is_local_path = next.starts_with('/')
        && !next.starts_with("//")
        && !next.contains('\\')
        && !next.contains("://")
        && !next.chars().any(char::is_control);
    if !is_local_path {
        return None;
    }
    match Route::from_str(next).ok()? {
        Route::Login { .. }
        | Route::Register {}
        | Route::ServerConnect {}
        | Route::NotFound { .. } => None,
        route => Some(route),
    }
}

#[cfg(test)]
mod tests;
