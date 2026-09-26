//! Render-smoke coverage for [`UmSessionRows`]: a stubbed row must render as
//! a plain, non-interactive element with no `href` at all, so no row ever
//! emits `href="#"`.

use super::*;
use crate::test_support::render_in_vdom;

fn session_rows_harness() -> Element {
    rsx! {
        UmSessionRows { on_signout: EventHandler::new(|()| {}) }
    }
}

#[test]
fn um_session_rows_renders_switch_user_as_a_non_interactive_row() {
    let html = render_in_vdom(session_rows_harness);
    assert!(html.contains("Switch user"));
    assert!(html.contains("aria-disabled=\"true\""));
    assert!(
        !html.contains("href"),
        "the stubbed Switch-user row must not be an anchor at all (#1913), got: {html}"
    );
}

fn pending_trigger_harness() -> Element {
    use_context_provider(|| crate::AvatarCacheBust(Signal::new(0u32)));
    let open = use_signal(|| false);
    rsx! {
        UserMenuTrigger { user: None, open }
    }
}

#[test]
fn user_menu_trigger_shows_a_skeleton_monogram_until_the_user_resolves() {
    let html = render_in_vdom(pending_trigger_harness);
    assert!(html.contains("um-trigger is-pending"), "{html}");
    assert!(html.contains("ld-skel circle"), "{html}");
    assert!(html.contains("data-testid=\"user-menu-trigger\""), "{html}");
}

#[test]
fn um_now_reading_first_paint_holds_the_cards_shape_rather_than_a_loading_line() {
    let html = render_in_vdom(|| rsx! { UmNowReading {} });
    assert!(html.contains("user-menu-now-reading-pending"), "{html}");
    assert!(!html.contains("Nothing in progress"), "{html}");
}
