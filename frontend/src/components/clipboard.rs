//! Copy-to-clipboard for values a reader carries elsewhere, such as a Kobo
//! endpoint URL or a one-time token secret. [`copy_text`] reports whether the
//! copy landed, falling back to a hidden textarea and `execCommand("copy")`
//! where `navigator.clipboard` is missing (a plain-http LAN install is not a
//! secure context), and [`CopyButton`] says so on screen, so a copy never fails
//! silently.

use dioxus::prelude::*;

/// How the last copy went.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CopyOutcome {
    Copied,
    Failed,
}

/// The async Clipboard API where the page may use it, else a selected
/// textarea; focus goes back to whatever held it.
#[cfg(feature = "web")]
const COPY_JS: &str = r#"
const omnibusCopy = async (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_e) {}
  }
  const prev = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (_e) {}
  area.remove();
  if (prev && prev.focus) prev.focus();
  return ok;
};
"#;

/// Copy `text` to the clipboard, returning whether it landed. Post-mount web
/// interop; on any other target there is no clipboard and the answer is `false`.
#[cfg_attr(not(feature = "web"), allow(unused_variables))]
pub async fn copy_text(text: &str) -> bool {
    #[cfg(feature = "web")]
    {
        let Ok(literal) = serde_json::to_string(text) else {
            return false;
        };
        let mut eval = dioxus::document::eval(&format!(
            "{COPY_JS}\ndioxus.send(await omnibusCopy({literal}));"
        ));
        eval.recv::<bool>().await.unwrap_or(false)
    }
    #[cfg(not(feature = "web"))]
    false
}

/// The feedback line beside a copy button, empty until a copy is tried.
pub fn copy_feedback(outcome: Option<CopyOutcome>) -> &'static str {
    match outcome {
        None => "",
        Some(CopyOutcome::Copied) => "Copied",
        Some(CopyOutcome::Failed) => "Couldn\u{2019}t copy. Select and copy it.",
    }
}

/// A button that copies `text`, followed by a live region reporting the
/// outcome. The region is in the DOM from the first paint, so the first
/// outcome is announced too; it is `{testid}-feedback`.
#[component]
pub fn CopyButton(
    #[props(into)] text: String,
    #[props(into)] label: String,
    #[props(into)] testid: String,
    #[props(into, default = "btn ghost sm".to_string())] class: String,
    #[props(into, default)] aria_label: Option<String>,
) -> Element {
    let mut outcome = use_signal(|| None::<CopyOutcome>);
    let failed = outcome() == Some(CopyOutcome::Failed);
    rsx! {
        button {
            r#type: "button",
            class: "{class}",
            "data-testid": "{testid}",
            "aria-label": aria_label,
            onclick: move |_| {
                let text = text.clone();
                spawn(async move {
                    let copied = copy_text(&text).await;
                    outcome.set(Some(if copied { CopyOutcome::Copied } else { CopyOutcome::Failed }));
                });
            },
            "{label}"
        }
        span {
            role: "status",
            class: if failed { "copy-feedback error" } else { "copy-feedback" },
            "data-testid": "{testid}-feedback",
            "{copy_feedback(outcome())}"
        }
    }
}

/// A labelled, read-only text field holding a value the reader carries elsewhere (an endpoint
/// URL, a token), with a [`CopyButton`] beside it.
#[component]
pub fn ReadonlyCopyField(
    #[props(into)] id: String,
    #[props(into)] label: String,
    #[props(into)] value: String,
    #[props(into)] input_testid: String,
    #[props(into)] copy_label: String,
    #[props(into)] copy_testid: String,
    #[props(into)] copy_aria_label: String,
) -> Element {
    rsx! {
        div { class: "settings-field",
            label { r#for: "{id}", "{label}" }
            div { class: "kobo-endpoint-row",
                input {
                    r#type: "text",
                    id: "{id}",
                    class: "kobo-endpoint-url",
                    "data-testid": "{input_testid}",
                    translate: "no",
                    spellcheck: "false",
                    readonly: true,
                    value: "{value}",
                }
                CopyButton {
                    text: value.clone(),
                    label: copy_label,
                    testid: copy_testid,
                    aria_label: copy_aria_label,
                }
            }
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
