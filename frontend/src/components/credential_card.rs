//! Shared settings-card status primitives: the connected/configured dot line
//! of the credential cards (Hardcover, Google Books, SMTP, Calibre), and the
//! save/clear/test result line every settings card reports through. Plain functions rather
//! than `#[component]`s, so callers can invoke them mid-render without
//! perturbing their own hook order.

use dioxus::prelude::*;

/// The dot + label line reporting whether a credential is configured, e.g.
/// "Connected \u{00b7} settings \u{00b7} hc_l\u{2026}ve" or "Not configured".
/// `testid` becomes the wrapping `data-testid`; `detail` is the full text
/// shown when `configured`. `configured` is `None` while the status read is
/// out ("Checking"), unless `read_failed`, when the status isn't known.
pub fn credential_status_line(
    testid: &str,
    configured: Option<bool>,
    read_failed: bool,
    detail: &str,
    unconfigured: &str,
) -> Element {
    rsx! {
        div { class: "api-key-status mono", "data-testid": "{testid}",
            match configured {
                Some(true) => rsx! {
                    span { class: "api-key-dot connected" }
                    "{detail}"
                },
                Some(false) => rsx! {
                    span { class: "api-key-dot" }
                    "{unconfigured}"
                },
                None if read_failed => rsx! {
                    span { class: "api-key-dot" }
                    "Status unavailable"
                },
                None => rsx! {
                    span { class: "api-key-dot pending" }
                    span { class: "ld-sheen", "Checking\u{2026}" }
                },
            }
        }
    }
}

/// The save/clear/test result line: a `role="status"` `<p>` in the DOM before
/// its first message, so that message is announced too (a live region mounted
/// with its text often isn't).
pub fn live_status(testid: &str, msg: Option<&str>, is_error: bool) -> Element {
    status_line("settings-status", testid, msg, is_error)
}

/// [`live_status`] for a card's footer row, where it sits beside the actions.
pub fn action_status(testid: &str, msg: Option<&str>, is_error: bool) -> Element {
    status_line(ACTION_STATUS, testid, msg, is_error)
}

/// A footer row's result line's base class.
pub const ACTION_STATUS: &str = "settings-status settings-action-status";

/// `base`, marked success or error once there is a message to style.
pub fn status_class(base: &str, has_msg: bool, is_error: bool) -> String {
    match (has_msg, is_error) {
        (true, true) => format!("{base} error"),
        (true, false) => format!("{base} success"),
        (false, _) => base.to_string(),
    }
}

fn status_line(base: &str, testid: &str, msg: Option<&str>, is_error: bool) -> Element {
    let class = status_class(base, msg.is_some(), is_error);
    rsx! {
        p { role: "status", class, "data-testid": "{testid}", {msg.unwrap_or_default()} }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
