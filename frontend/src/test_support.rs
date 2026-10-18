//! Shared helpers for frontend tests. [`render`] wraps
//! `dioxus::ssr::render_element` for components that render without a live
//! runtime at the call site; [`render_in_vdom`] drives a throwaway `VirtualDom`
//! for cases that must construct a `Signal` first. Both exist only under the
//! `server` feature, where `dioxus::ssr` is available; the handler helpers
//! ([`in_root_scope`] and the blank events) run on every target.

use dioxus::prelude::*;

/// SSR-render an rsx `Element` to an HTML string: the workhorse for
/// render-smoke tests (pass `rsx! { SomeComponent { ..props } }`, assert on
/// substrings). Testing `mobile`-only markup needs `--features mobile,server`
/// together (no single CI leg runs that): gate the test module
/// `#[cfg(all(test, feature = "mobile", feature = "server"))]`.
#[cfg(feature = "server")]
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
        share_stats: true,
    }
}

/// A private, empty shelf row for render tests. Its owner's username is
/// `user-{owner_user_id}`, which is what an attribution line reads.
pub fn test_shelf_summary(
    id: i64,
    owner_user_id: i64,
    kind: omnibus_shared::ShelfKind,
    name: &str,
) -> omnibus_shared::ShelfSummary {
    omnibus_shared::ShelfSummary {
        id,
        owner_user_id,
        owner_username: format!("user-{owner_user_id}"),
        owner_has_avatar: false,
        kind,
        name: name.to_string(),
        visibility: omnibus_shared::Visibility::Private,
        accent: None,
        book_count: 0,
        cover_uuids: Vec::new(),
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
#[cfg(feature = "server")]
pub fn render_in_vdom(app: fn() -> Element) -> String {
    let mut dom = VirtualDom::new(app);
    dom.rebuild_in_place();
    dioxus::ssr::render(&dom)
}

/// Run `f` inside a live root scope, so it can create signals and spawn. Unlike
/// a component body, a panic here fails the test instead of being caught.
pub fn in_root_scope(f: impl FnOnce()) {
    let mut dom = VirtualDom::new(|| rsx! {});
    dom.rebuild_in_place();
    dom.in_scope(ScopeId::ROOT, f);
}

/// A no-op `FormEvent`, for a submit handler that reads its signals, not the form.
#[cfg(test)]
pub fn blank_form_event() -> FormEvent {
    Event::new(
        std::rc::Rc::new(FormData::new(SerializedFormData::new(
            String::new(),
            vec![],
        ))),
        false,
    )
}

/// A no-op `MouseEvent`, for a click handler that ignores its argument.
#[cfg(test)]
pub fn blank_mouse_event() -> MouseEvent {
    Event::new(
        std::rc::Rc::new(MouseData::new(SerializedMouseData::default())),
        false,
    )
}

/// The opening tag of the element carrying `testid` in rendered `html`.
pub fn tag_with_testid<'a>(html: &'a str, testid: &str) -> &'a str {
    let at = html
        .find(&format!(r#"data-testid="{testid}""#))
        .unwrap_or_else(|| panic!("{testid} missing: {html}"));
    let start = html[..at].rfind('<').expect("testid outside a tag");
    let end = at + html[at..].find('>').expect("unterminated tag");
    &html[start..=end]
}

/// Let `dom` act on everything a test just did: queued events, the re-render
/// they cause, then the tasks and effects that render woke.
pub fn settle(dom: &mut VirtualDom) {
    dom.process_events();
    dom.render_immediate(&mut dioxus::dioxus_core::NoOpMutations);
    dom.process_events();
}
