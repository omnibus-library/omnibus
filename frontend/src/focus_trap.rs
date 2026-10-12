//! Keeps Tab inside the dialog a key press came from, for overlays that mark
//! themselves `aria-modal` and so promise focus will not wander off behind them.

use dioxus::prelude::*;

/// Wrap Tab from a dialog's last tabbable element to its first, and Shift+Tab
/// the other way; any other key is left alone. Call from the dialog's `onkeydown`.
#[cfg(feature = "web")]
pub fn trap_tab(evt: &Event<KeyboardData>) {
    use dioxus::web::WebEventExt;
    use wasm_bindgen::JsCast;

    if evt.key() != Key::Tab {
        return;
    }
    let Some(raw) = evt.try_as_web_event() else {
        return;
    };
    let Some(active) = raw
        .target()
        .and_then(|target| target.dyn_into::<web_sys::Element>().ok())
    else {
        return;
    };
    let Ok(Some(dialog)) = active.closest(r#"[role="dialog"]"#) else {
        return;
    };
    let Some((first, last)) = tabbable_ends(&dialog) else {
        return;
    };
    let is = |element: &web_sys::HtmlElement| active.is_same_node(Some(element));
    let (leaving, wrap_to) = if raw.shift_key() {
        (active.is_same_node(Some(&dialog)) || is(&first), last)
    } else {
        (is(&last), first)
    };
    if leaving {
        raw.prevent_default();
        let _ = wrap_to.focus();
    }
}

/// The first and last element inside `dialog` that Tab can reach.
#[cfg(feature = "web")]
fn tabbable_ends(
    dialog: &web_sys::Element,
) -> Option<(web_sys::HtmlElement, web_sys::HtmlElement)> {
    use wasm_bindgen::JsCast;

    const TABBABLE: &str = r#"button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])"#;
    let nodes = dialog.query_selector_all(TABBABLE).ok()?;
    let at = |i: u32| nodes.item(i)?.dyn_into::<web_sys::HtmlElement>().ok();
    Some((at(0)?, at(nodes.length().checked_sub(1)?)?))
}

/// Non-web stub: SSR never handles a key press, and the native shells keep no
/// browser focus order to trap. Defined so an `onkeydown` handler can call
/// `trap_tab` unconditionally (rule 07: no cfg gates in rsx bodies).
#[cfg(not(feature = "web"))]
pub fn trap_tab(_evt: &Event<KeyboardData>) {}
