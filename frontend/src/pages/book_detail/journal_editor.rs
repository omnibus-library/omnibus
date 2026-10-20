//! Live markdown editor glue shared by the journal and review composers. Ships
//! the co-located `journal_editor.js` over Dioxus's eval channel and exposes
//! `enhance` / `command` / `insert` actions, the formatting toolbar, the
//! textarea/live-editor pair and the insert-from-highlights popover.
//! Web-only — non-web targets keep the plain SSR textarea (rule 07) and every
//! eval helper is a no-op.

use dioxus::prelude::*;
use omnibus_shared::Highlight;

use crate::components::image_upload::use_file_upload;
use crate::components::{MarkSize, Ring};
use crate::data;

/// The live-editor JS module (defines `window.OmnibusJournalEditor`, then
/// dispatches one action read from the Dioxus eval channel). Included as a
/// string and evaluated on demand; the module guards against re-definition so
/// repeated evals only run the trailing dispatcher.
#[cfg(feature = "web")]
const JOURNAL_EDITOR_JS: &str = include_str!("journal_editor.js");

/// Send one action to the live editor over the eval channel. Web-only — the
/// eval (and `serde_json`) are unavailable on SSR/native, so this is a no-op
/// there. The contenteditable surface itself is also web-gated (see the write
/// surface), so non-web targets fall back to a plain textarea and never reach
/// the JS.
#[cfg(feature = "web")]
fn editor_dispatch(action: &str, editor_id: &str, mirror_id: &str, op: &str, a: &str, b: &str) {
    let eval = dioxus::document::eval(JOURNAL_EDITOR_JS);
    let _ = eval.send(serde_json::json!({
        "action": action, "editorId": editor_id, "mirrorId": mirror_id,
        "op": op, "a": a, "b": b, "text": a,
    }));
}

#[cfg(not(feature = "web"))]
fn editor_dispatch(
    _action: &str,
    _editor_id: &str,
    _mirror_id: &str,
    _op: &str,
    _a: &str,
    _b: &str,
) {
}

/// Progressively enhance a plain `<textarea>` (rendered by SSR and the first
/// hydration paint) into the live contenteditable editor. The JS flips a
/// `data-omnibus-enhanced` marker on the wrapping element, which CSS uses to
/// swap visibility, and mirrors the editor's markdown back into the textarea.
/// Call it unconditionally; the non-web stub is a no-op.
#[cfg(feature = "web")]
pub(crate) fn editor_enhance(source_id: &str, editor_id: &str) {
    editor_dispatch("enhance", editor_id, source_id, "", "", "");
}

/// Non-web stub: SSR never runs the eval channel and native shells have no
/// contenteditable to progressively enhance, so this is a no-op. Defined so
/// the rsx `onmounted` can call `editor_enhance` unconditionally (rule 07:
/// hydration parity — keep cfg gates out of rsx bodies).
#[cfg(not(feature = "web"))]
pub(crate) fn editor_enhance(_source_id: &str, _editor_id: &str) {}

/// Run a toolbar formatting command (`wrap` / `prefix` / `link`) on the live
/// editor's current selection.
pub(crate) fn editor_command(editor_id: &str, op: &str, a: &str, b: &str) {
    editor_dispatch("command", editor_id, "", op, a, b);
}

/// Insert `text` at the live editor's caret (used by insert-from-highlights).
/// `text` rides the same channel slot the JS reads for an `insert` action.
pub(crate) fn editor_insert(editor_id: &str, text: &str) {
    editor_dispatch("insert", editor_id, "", "", text, "");
}

/// One formatting button: visible `label`, accessible `title`, and the
/// `(op, a, b)` triple passed to [`editor_command`].
struct ToolbarButton {
    label: &'static str,
    title: &'static str,
    op: &'static str,
    a: &'static str,
    b: &'static str,
}

/// Formatting buttons shown in [`BdJournalToolbar`], in the order the
/// design's `InlineJournalEditor` toolbar uses. Module-level (rather than a
/// local `const` in the component) so the button data doesn't pad the
/// component's own body.
const TOOLBAR_BUTTONS: &[ToolbarButton] = &[
    ToolbarButton {
        label: "B",
        title: "Bold",
        op: "wrap",
        a: "**",
        b: "**",
    },
    ToolbarButton {
        label: "I",
        title: "Italic",
        op: "wrap",
        a: "*",
        b: "*",
    },
    ToolbarButton {
        label: "S",
        title: "Strikethrough",
        op: "wrap",
        a: "~~",
        b: "~~",
    },
    ToolbarButton {
        label: "H1",
        title: "Heading 1",
        op: "prefix",
        a: "# ",
        b: "",
    },
    ToolbarButton {
        label: "H2",
        title: "Heading 2",
        op: "prefix",
        a: "## ",
        b: "",
    },
    ToolbarButton {
        label: "\u{201C}",
        title: "Quote",
        op: "prefix",
        a: "> ",
        b: "",
    },
    ToolbarButton {
        label: "\u{2022}",
        title: "Bullet list",
        op: "prefix",
        a: "- ",
        b: "",
    },
    ToolbarButton {
        label: "1.",
        title: "Numbered list",
        op: "prefix",
        a: "1. ",
        b: "",
    },
    ToolbarButton {
        label: "[ ]",
        title: "Checklist",
        op: "prefix",
        a: "- [ ] ",
        b: "",
    },
    ToolbarButton {
        label: "{ }",
        title: "Inline code",
        op: "wrap",
        a: "`",
        b: "`",
    },
    ToolbarButton {
        label: "\u{1F517}",
        title: "Link",
        op: "link",
        a: "text",
        b: "https://",
    },
    ToolbarButton {
        label: "Spoiler",
        title: "Spoiler \u{2014} blurred until clicked",
        op: "wrap",
        a: "||",
        b: "||",
    },
];

/// The composer formatting toolbar. Each button wraps/prefixes the live
/// editor's selection with the matching markdown so the persisted body stays
/// plain markdown. `target_id` is the id of the contenteditable the buttons act
/// on. Buttons `prevent_default` on mousedown so clicking one doesn't move
/// focus out of the editor and collapse the selection. `disabled` holds every
/// tool; `uploading`, when the host passes one, reports an image upload in
/// flight so the host can hold its save until the image is in.
#[component]
pub(crate) fn BdJournalToolbar(
    target_id: String,
    server_url: String,
    error: Signal<Option<String>>,
    #[props(default)] disabled: bool,
    #[props(default)] uploading: Option<Signal<bool>>,
) -> Element {
    rsx! {
        div { class: "bd-journal-toolbar", "data-testid": "journal-toolbar", role: "toolbar",
            for btn in TOOLBAR_BUTTONS.iter() {
                button {
                    key: "{btn.title}",
                    r#type: "button",
                    class: "btn ghost sm bd-journal-tool",
                    title: "{btn.title}",
                    "aria-label": "{btn.title}",
                    disabled,
                    onmousedown: move |e| e.prevent_default(),
                    onclick: {
                        let id = target_id.clone();
                        move |_| editor_command(&id, btn.op, btn.a, btn.b)
                    },
                    "{btn.label}"
                }
            }
            BdJournalImageButton { target_id, server_url, error, disabled, uploading }
        }
    }
}

/// Placeholder caption inserted with an embedded image — the author edits it
/// in place (the alt text doubles as the rendered figcaption).
const IMAGE_CAPTION_PLACEHOLDER: &str = "Add a caption";

/// The toolbar's embedded-image control: a file-picker `label` styled like
/// the other tool buttons. Choosing a file uploads it to
/// `/api/journals/images` and inserts the returned URL at the caret as
/// markdown image syntax, whose alt text is the editable caption.
#[component]
fn BdJournalImageButton(
    target_id: String,
    server_url: String,
    error: Signal<Option<String>>,
    disabled: bool,
    uploading: Option<Signal<bool>>,
) -> Element {
    let own_uploading = use_signal(|| false);
    let uploading = uploading.unwrap_or(own_uploading);
    let input_id = format!("{target_id}-image-input");

    let onchange = use_file_upload(
        uploading,
        error,
        |_filename| None,
        move |filename, mime, bytes| {
            let server_url = server_url.clone();
            async move { data::upload_journal_image(&server_url, filename, mime, bytes).await }
        },
        {
            let target_id = target_id.clone();
            move |image_url| {
                editor_insert(
                    &target_id,
                    &format!("\n\n![{IMAGE_CAPTION_PLACEHOLDER}]({image_url})\n"),
                );
            }
        },
    );

    rsx! {
        label {
            class: "btn ghost sm bd-journal-tool bd-journal-image-tool",
            r#for: "{input_id}",
            title: "Insert image",
            role: "button",
            tabindex: "0",
            "aria-label": "Insert image",
            "aria-busy": if uploading() { "true" } else { "false" },
            "aria-disabled": disabled.then_some("true"),
            // Labels aren't keyboard-activatable by default — forward
            // Enter/Space to the hidden input's file picker.
            onkeydown: {
                let input_id = input_id.clone();
                move |e: KeyboardEvent| {
                    let key = e.key();
                    if key == Key::Enter || key == Key::Character(" ".to_string()) {
                        e.prevent_default();
                        if !disabled {
                            open_file_picker(&input_id);
                        }
                    }
                }
            },
            // A stable span holds the swap, so the label's own node never
            // changes shape (rule 07).
            span { class: "bd-journal-image-glyph",
                if uploading() {
                    Ring { size: MarkSize::Xs }
                } else {
                    "\u{1F5BC}"
                }
            }
        }
        input {
            id: "{input_id}",
            r#type: "file",
            class: "bd-journal-image-input",
            accept: "image/jpeg,image/png,image/webp,image/gif",
            "data-testid": "journal-image-input",
            disabled: disabled || uploading(),
            onchange,
        }
    }
}

/// Open the hidden file input's picker — the keyboard path for the
/// Insert-image label (labels aren't keyboard-activatable natively). Web-only:
/// the eval channel is unavailable on SSR/native, where the toolbar is inert.
#[cfg(feature = "web")]
fn open_file_picker(input_id: &str) {
    let _ = dioxus::document::eval(&format!("document.getElementById({input_id:?})?.click();"));
}

#[cfg(not(feature = "web"))]
fn open_file_picker(_input_id: &str) {}

/// Build the markdown blockquote inserted when a saved highlight is chosen:
/// every line of the passage is `> `-prefixed, followed by an attribution line.
pub(crate) fn highlight_blockquote(text: &str) -> String {
    let quoted = text
        .lines()
        .map(|l| format!("> {l}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!("\n{quoted}\n>\n> \u{2014} saved from highlights\n")
}

/// The write surface: a plain `<textarea>` (the SSR / first-paint source of
/// truth, and the mirror the live editor writes its markdown back into) beside
/// the contenteditable that [`editor_enhance`] swaps in after mount.
#[component]
pub(crate) fn BdMarkdownSurface(
    source_id: String,
    editor_id: String,
    body: Signal<String>,
    /// The live editor's accessible name.
    label: String,
    #[props(default)] placeholder: Option<String>,
    #[props(default)] source_testid: Option<String>,
    #[props(default)] editor_testid: Option<String>,
    /// Read-only, e.g. while the text it holds is being saved.
    #[props(default)]
    disabled: bool,
) -> Element {
    let mut body = body;
    let mount_ids = (source_id.clone(), editor_id.clone());
    rsx! {
        div { class: "bd-journal-editor-wrap",
            textarea {
                id: "{source_id}",
                class: "me-textarea bd-journal-textarea",
                "data-testid": source_testid,
                rows: "5",
                disabled,
                placeholder: placeholder.clone(),
                value: "{body}",
                oninput: move |e| body.set(e.value()),
                onmounted: move |_| editor_enhance(&mount_ids.0, &mount_ids.1),
            }
            div {
                id: "{editor_id}",
                class: "me-textarea bd-journal-editor",
                "data-testid": editor_testid,
                contenteditable: if disabled { "false" } else { "true" },
                role: "textbox",
                "aria-multiline": "true",
                "aria-label": "{label}",
                "aria-disabled": disabled.then_some("true"),
                "data-placeholder": placeholder,
            }
        }
    }
}

/// The insert-from-highlights popover's state, owned by the composer that
/// hosts it so hiding the toolbar (Preview) keeps the loaded-once list.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct HighlightsInsertState {
    highlights: Signal<Vec<Highlight>>,
    open: Signal<bool>,
    loaded: Signal<bool>,
}

/// Declare a closed, unloaded [`HighlightsInsertState`]. A hook: call it
/// unconditionally.
pub(crate) fn use_highlights_insert_state() -> HighlightsInsertState {
    HighlightsInsertState {
        highlights: use_signal(Vec::<Highlight>::new),
        open: use_signal(|| false),
        loaded: use_signal(|| false),
    }
}

/// "From highlights" toggle + popover: inserts a saved highlight of `uuid` as
/// a blockquote at `target_id`'s caret. The list loads the first time the
/// popover opens. Testids read `{testid_prefix}-insert-highlight`,
/// `-highlights-pop` and `-highlight-item`.
#[component]
pub(crate) fn BdHighlightsInsert(
    uuid: String,
    server_url: String,
    target_id: String,
    testid_prefix: String,
    state: HighlightsInsertState,
    #[props(default)] disabled: bool,
) -> Element {
    let HighlightsInsertState {
        mut highlights,
        open: mut highlights_open,
        loaded: mut highlights_loaded,
    } = state;

    rsx! {
        div { class: "bd-journal-hl-wrap",
            button {
                r#type: "button",
                class: if highlights_open() { "btn ghost sm bd-tab-active" } else { "btn ghost sm" },
                "data-testid": "{testid_prefix}-insert-highlight",
                disabled,
                onclick: move |_| {
                    let opening = !highlights_open();
                    highlights_open.set(opening);
                    if opening && !highlights_loaded() {
                        highlights_loaded.set(true);
                        let url = server_url.clone();
                        let uuid = uuid.clone();
                        spawn(async move {
                            if let Ok(list) = data::list_highlights(&url, &uuid).await {
                                highlights
                                    .set(list.into_iter().filter(|h| h.text.is_some()).collect());
                            }
                        });
                    }
                },
                "From highlights"
            }
            if highlights_open() {
                div {
                    class: "card bd-journal-hl-pop",
                    "data-testid": "{testid_prefix}-highlights-pop",
                    div { class: "label bd-journal-hl-head", "From your highlights" }
                    if highlights().is_empty() {
                        p { class: "mono bd-journal-hl-empty",
                            "No saved highlights for this book yet."
                        }
                    } else {
                        for h in highlights().iter() {
                            button {
                                key: "{h.id}",
                                r#type: "button",
                                class: "bd-journal-hl-item",
                                "data-testid": "{testid_prefix}-highlight-item",
                                onmousedown: move |e| e.prevent_default(),
                                onclick: {
                                    let text = h.text.clone().unwrap_or_default();
                                    let target_id = target_id.clone();
                                    move |_| {
                                        editor_insert(&target_id, &highlight_blockquote(&text));
                                        highlights_open.set(false);
                                    }
                                },
                                "{h.text.clone().unwrap_or_default()}"
                            }
                        }
                    }
                }
            }
        }
    }
}
