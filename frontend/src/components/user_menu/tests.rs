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
