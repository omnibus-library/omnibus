//! Shared page-level error / not-found states. Nearly every top-level page in
//! `pages/` hand-duplicated the same `role="alert"` markup around its own
//! data-fetch effect; these are drop-in replacements that preserve the exact
//! role/text contract existing Playwright specs assert on. Loading lives in
//! [`crate::components::loading`].

use dioxus::prelude::*;
use dioxus_router::navigation::NavigationTarget;
use dioxus_router::Link;

use crate::Route;

/// Error state: the fetch failure `message` plus a link back to `back_to`.
#[component]
pub fn PageError(
    message: String,
    #[props(into)] back_to: NavigationTarget,
    #[props(default = "Back to library".to_string())] back_label: String,
) -> Element {
    rsx! {
        p { role: "alert", class: "subtitle", "{message}" }
        Link { to: back_to, class: "btn", "{back_label}" }
    }
}

/// Not-found state: "`{subject}` not found." plus a link back to `back_to`.
#[component]
pub fn PageNotFound(
    subject: String,
    back_to: Route,
    #[props(default = "Back to library".to_string())] back_label: String,
) -> Element {
    rsx! {
        p { class: "subtitle", "{subject} not found." }
        Link { to: back_to, class: "btn", "{back_label}" }
    }
}

// `PageError`/`PageNotFound` both render a `dioxus_router::Link`, which
// panics without a live `RouterContext` — only obtainable by mounting
// `dioxus_router::Router`, and there's no route in this crate's `Route` enum
// that resolves to a bare `PageError`/`PageNotFound` to mount it through.
// This is the same constraint that keeps `TopNav`'s full render untested
// (`components::top_nav`): Dioxus catches the panic per-component (it
// doesn't abort the whole render), so the assertions below on the
// surrounding, Link-free markup still hold — only the link's own text is
// unverifiable here.
#[cfg(all(test, feature = "server"))]
mod tests {
    use super::*;
    use crate::test_support::render;

    #[test]
    fn page_error_renders_the_message_as_an_alert() {
        // A bare `NavigationTarget` (rather than a `Route`) skips the
        // `Into` conversion's child-route lookup, which needs a live Dioxus
        // runtime the plain `render` helper doesn't provide.
        let html = render(rsx! {
            PageError {
                message: "Could not load this book.".to_string(),
                back_to: NavigationTarget::Internal("/".to_string()),
            }
        });
        assert!(html.contains("role=\"alert\""));
        assert!(html.contains("Could not load this book."));
    }

    // `back_to` accepting a `NavigationTarget` needs a live router to render
    // the `Link`'s href (see the module comment above), so this one test gets
    // its own one-route harness rather than the bare `render` the others use.
    #[test]
    fn page_error_renders_a_link_target_back_to_with_no_dangling_query_separator() {
        use dioxus_router::{Routable, Router};

        #[derive(Clone, Debug, PartialEq, Routable)]
        enum HostRoute {
            #[route("/")]
            Host {},
        }

        #[component]
        fn Host() -> Element {
            rsx! {
                PageError {
                    message: "This reader isn't sharing their stats".to_string(),
                    back_to: crate::routes::link_target(Route::Stats { user: None }),
                    back_label: "Back to your stats".to_string(),
                }
            }
        }

        let html = crate::test_support::render_in_vdom(|| rsx! { Router::<HostRoute> {} });
        assert!(html.contains("href=\"/stats\""));
        assert!(html.contains("Back to your stats"));
    }

    #[test]
    fn page_not_found_renders_the_subject() {
        let html = render(rsx! {
            PageNotFound {
                subject: "This book".to_string(),
                back_to: Route::Landing {},
            }
        });
        assert!(html.contains("This book not found."));
    }
}
