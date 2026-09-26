//! Shared "credential card" status primitives: the connected/configured dot
//! line and the save/clear/test result message, reused by the Hardcover,
//! Google Books, SMTP, and account Kindle-email cards. Plain functions rather
//! than `#[component]`s, so callers can invoke them mid-render without
//! perturbing their own hook order.

use dioxus::prelude::*;

/// The dot + label line reporting whether a credential is configured, e.g.
/// "Connected \u{00b7} settings \u{00b7} hc_l\u{2026}ve" or "Not configured".
/// `testid` becomes the wrapping `data-testid`; `detail` is the full text
/// shown when `configured` — the caller composes the exact "Connected \u{00b7}
/// source \u{00b7} masked" / "Configured \u{00b7} source" wording, since it
/// varies by card. `configured` is `None` while the status read is out, which
/// reads "Checking" rather than claiming the credential is missing.
pub fn credential_status_line(
    testid: &str,
    configured: Option<bool>,
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
                None => rsx! {
                    span { class: "api-key-dot pending" }
                    span { class: "ld-sheen", "Checking\u{2026}" }
                },
            }
        }
    }
}

/// The save/clear/test result line: a `role="status"` `<p>` styled success or
/// error, absent until the first action produces a message.
pub fn credential_status_message(testid: &str, msg: Option<&str>, is_error: bool) -> Element {
    let Some(m) = msg else {
        return rsx! {};
    };
    rsx! {
        p {
            role: "status",
            "data-testid": "{testid}",
            class: if is_error { "settings-status error" } else { "settings-status success" },
            "{m}"
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests {
    use super::*;
    use crate::test_support::render;

    #[test]
    fn credential_status_line_checks_rather_than_claims_missing_before_the_read() {
        let html = render(credential_status_line(
            "k",
            None,
            "Connected",
            "Not connected",
        ));
        assert!(html.contains("api-key-dot pending"), "{html}");
        assert!(html.contains("ld-sheen"), "{html}");
        assert!(!html.contains("Not connected"), "{html}");
    }

    #[test]
    fn credential_status_line_reports_each_answered_state() {
        let on = render(credential_status_line(
            "k",
            Some(true),
            "Connected",
            "Not connected",
        ));
        assert!(
            on.contains("api-key-dot connected") && on.contains("Connected"),
            "{on}"
        );
        let off = render(credential_status_line(
            "k",
            Some(false),
            "Connected",
            "Not connected",
        ));
        assert!(
            off.contains("Not connected") && !off.contains("pending"),
            "{off}"
        );
    }
}
