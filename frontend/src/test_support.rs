//! Shared SSR render helpers for frontend tests. [`render`] wraps
//! `dioxus::ssr::render_element` for components that render without a live
//! runtime at the call site; [`render_in_vdom`] drives a throwaway `VirtualDom`
//! for cases that must construct a `Signal` first. Both exist only under the
//! `server` feature, where `dioxus::ssr` is available.

use dioxus::prelude::*;

/// SSR-render an rsx `Element` to an HTML string. The workhorse for
/// render-smoke tests: pass `rsx! { SomeComponent { ..props } }` and assert on
/// substrings of the returned markup.
///
/// Testing `#[cfg(feature = "mobile")]`-only markup needs both features at
/// once (`cargo test -p omnibus-frontend --features mobile,server` — a combo
/// neither CI matrix leg runs alone): gate the test module
/// `#[cfg(all(test, feature = "mobile", feature = "server"))]`, dropping the
/// `mobile` half when the file's module root already sits behind it.
pub fn render(element: Element) -> String {
    dioxus::ssr::render_element(element)
}

/// A signed-in reader holding exactly the given permissions, for seeding
/// [`crate::CurrentUser`] in a render test.
pub fn test_user(is_admin: bool, can_upload: bool) -> omnibus_shared::UserSummary {
    omnibus_shared::UserSummary {
        id: 7,
        username: "reader".to_string(),
        is_admin,
        can_upload,
        can_edit: false,
        can_download: false,
        kindle_email: None,
        display_name: None,
        has_avatar: false,
        hidden_formats: Vec::new(),
        book_detail_scroll_stops: false,
        stack_series: false,
    }
}

/// Provide [`crate::CurrentUser`] holding `user` to the calling component's
/// subtree: `None` is unresolved, `Some(None)` signed out. A hook — call it
/// at the top of a test's root component.
#[cfg(not(feature = "mobile"))]
pub fn provide_current_user(user: Option<Option<omnibus_shared::UserSummary>>) {
    use_context_provider(|| crate::CurrentUser(Signal::new(user)));
}

/// SSR-render a zero-prop component inside a real `VirtualDom`, for the
/// components whose body constructs a `Signal` (`Signal::new`) or otherwise
/// needs a live runtime at mount. Returns the rendered HTML after one rebuild.
pub fn render_in_vdom(app: fn() -> Element) -> String {
    let mut dom = VirtualDom::new(app);
    dom.rebuild_in_place();
    dioxus::ssr::render(&dom)
}
