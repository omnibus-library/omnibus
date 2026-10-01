//! Tests for journal markdown rendering: basic formatting and strikethrough,
//! HTML sanitization (script tags, event-handler attributes, non-checkbox
//! inputs), spoiler-marker wrapping, task-list checkboxes, and image
//! handling (captioned figures, offsite-source stripping).

use super::*;

#[test]
fn render_emits_strong_and_em_for_bold_and_italic_markdown() {
    let html = render("**bold** and *italic*");
    assert!(html.contains("<strong>bold</strong>"), "got: {html}");
    assert!(html.contains("<em>italic</em>"), "got: {html}");
}

#[test]
fn render_emits_del_for_strikethrough() {
    let html = render("~~gone~~");
    assert!(html.contains("<del>gone</del>"), "got: {html}");
}

#[test]
fn render_strips_script_tags() {
    let html = render("hi <script>alert('x')</script> there");
    assert!(!html.contains("<script"), "script must be stripped: {html}");
    assert!(!html.contains("alert("), "script body removed: {html}");
}

#[test]
fn render_strips_event_handler_attributes() {
    let html = render("<a href=\"#\" onclick=\"steal()\">link</a>");
    assert!(!html.contains("onclick"), "handlers stripped: {html}");
}

#[test]
fn render_wraps_spoiler_markers_in_a_named_collapsed_inline_control() {
    // An inline span, not a `<button>`: a button is an atomic box that drops
    // whole to the next line, where a span wraps as prose. It still reads as
    // a control — a named button, collapsed — and keeps its text away from
    // assistive tech until the client reveals it.
    let html = render("the killer is ||the butler||");
    assert!(!html.contains("<button"), "no atomic button box: {html}");
    assert!(html.contains("<span class=\"spoiler\""), "got: {html}");
    assert!(html.contains("role=\"button\""), "got: {html}");
    assert!(html.contains("tabindex=\"0\""), "got: {html}");
    assert!(html.contains("aria-expanded=\"false\""), "got: {html}");
    assert!(
        html.contains(&format!("aria-label=\"{SPOILER_LABEL}\"")),
        "got: {html}"
    );
    assert!(
        html.contains("<span class=\"spoiler-text\" aria-hidden=\"true\">the butler</span></span>"),
        "got: {html}"
    );
}

#[test]
fn render_processes_markdown_inside_spoiler_text() {
    let html = render("||the **butler** did it||");
    assert!(html.contains("class=\"spoiler\""), "got: {html}");
    assert!(html.contains("<strong>butler</strong>"), "got: {html}");
}

#[test]
fn render_leaves_unterminated_spoiler_marker_literal() {
    let html = render("a lone ||marker here");
    assert!(!html.contains("class=\"spoiler\""), "got: {html}");
    assert!(
        !html.contains("role=\"button\""),
        "no control emitted: {html}"
    );
    assert!(html.contains("||marker here"), "got: {html}");
}

#[test]
fn render_emits_ordered_lists_and_keeps_nested_lists_nested() {
    let html = render("1. first\n2. second\n\n- parent\n  - child");
    assert!(html.contains("<ol>"), "ordered list survives: {html}");
    assert!(html.contains("<li>first</li>"), "got: {html}");
    assert!(
        html.contains("<li>parent\n<ul>\n<li>child</li>"),
        "nested list stays inside its parent item: {html}"
    );
}

#[test]
fn render_promotes_single_newlines_to_hard_breaks() {
    // The live editor shows one visual line per source line; a CommonMark
    // soft break would collapse that newline to a space on publish.
    let html = render("line one\nline two");
    assert!(html.contains("<br"), "single newline becomes <br>: {html}");
}

#[test]
fn render_keeps_lazy_blockquote_continuation_lines_on_their_own_rows() {
    let html = render("> quoted one\nquoted two\nquoted three");
    assert!(html.contains("<blockquote>"), "got: {html}");
    let quote_has_breaks = html
        .split("<blockquote>")
        .nth(1)
        .is_some_and(|q| q.matches("<br").count() >= 2);
    assert!(quote_has_breaks, "each quoted line keeps its row: {html}");
}

#[test]
fn render_emits_task_list_checkboxes() {
    let html = render("- [x] done\n- [ ] todo");
    // A checked + an unchecked disabled checkbox survive sanitization.
    assert!(html.contains("type=\"checkbox\""), "got: {html}");
    assert!(html.contains("checked"), "checked box kept: {html}");
    assert!(html.contains("disabled"), "boxes stay read-only: {html}");
}

#[test]
fn render_strips_non_checkbox_input_element_entirely() {
    // ammonia would keep the allowlisted `input` tag while stripping its
    // disallowed attributes, leaving a bare `<input>` (a text field by
    // default). The whole element — not just its attributes — must go.
    let html = render("<input type=\"text\" value=\"x\">");
    assert!(!html.contains("<input"), "input element removed: {html}");
    assert!(!html.contains("type=\"text\""), "type dropped: {html}");
    assert!(!html.contains("value="), "value dropped: {html}");
}

#[test]
fn render_strips_button_and_bare_inputs_entirely() {
    // Non-checkbox inputs of any flavour, including an attribute-less one and
    // an *interactive* (non-disabled) checkbox, must not survive — each
    // degrades to a bare/enabled `<input>` under ammonia. Only the disabled
    // task-list checkbox is allowed through.
    for body in [
        "<input type=\"button\">",
        "<input>",
        "<input type=\"checkbox\">",
    ] {
        let html = render(body);
        assert!(!html.contains("<input"), "no input from {body:?}: {html}");
    }
}

#[test]
fn drop_non_checkbox_inputs_matches_real_attribute_tokens() {
    // A genuine disabled task-list checkbox survives.
    assert!(
        drop_non_checkbox_inputs("<input disabled=\"\" type=\"checkbox\">").contains("<input"),
        "real task-list checkbox kept"
    );
    // Lookalike attribute names must not satisfy the `disabled` check, so an
    // interactive checkbox cannot slip through on a substring match.
    for tag in [
        "<input aria-disabled=\"true\" type=\"checkbox\">",
        "<input data-disabled=\"\" type=\"checkbox\">",
        "<input notdisabled=\"\" type=\"checkbox\">",
    ] {
        assert!(
            !drop_non_checkbox_inputs(tag).contains("<input"),
            "lookalike disabled attr rejected: {tag}"
        );
    }
}

#[test]
fn render_wraps_lone_image_as_captioned_figure() {
    let html = render("![A sunset over the bay](/api/journals/images/abc.png)");
    assert!(
        html.contains("<figure class=\"journal-figure\">"),
        "got: {html}"
    );
    assert!(
        html.contains("src=\"/api/journals/images/abc.png\""),
        "got: {html}"
    );
    assert!(
        html.contains("<figcaption>A sunset over the bay</figcaption>"),
        "got: {html}"
    );
}

#[test]
fn render_omits_figcaption_for_lone_image_without_alt() {
    let html = render("![](/api/journals/images/abc.png)");
    assert!(html.contains("<figure"), "got: {html}");
    assert!(!html.contains("<figcaption>"), "got: {html}");
}

#[test]
fn render_leaves_inline_image_amid_text_unwrapped() {
    let html = render("before ![tiny](/api/journals/images/abc.png) after");
    assert!(html.contains("<img"), "got: {html}");
    assert!(
        !html.contains("<figure"),
        "inline images stay plain: {html}"
    );
}

#[test]
fn render_strips_images_with_offsite_or_off_prefix_src() {
    for md in [
        "![x](https://evil.example/track.png)",
        "![x](/covers/1.png)",
        "![x](//evil.example/t.png)",
        "<img src=\"https://evil.example/t.png\">",
    ] {
        let html = render(md);
        assert!(
            !html.contains("<img"),
            "img from {md:?} must be dropped: {html}"
        );
    }
}

#[test]
fn render_strips_journal_figure_class_from_hand_authored_figure() {
    // ammonia's defaults keep bare `<figure>`/`<figcaption>` (harmless
    // semantic markup), but the styled class only comes from our own
    // `wrap_figures` pass — a hand-authored one is stripped.
    let html = render("<figure class=\"journal-figure\"><figcaption>fake</figcaption></figure>");
    assert!(!html.contains("journal-figure"), "got: {html}");
}

#[test]
fn render_disallows_arbitrary_span_classes_and_attrs() {
    // Only the spoiler wrapper's exact shape is allowlisted on `<span>`: its
    // two classes, `role="button"`, `tabindex="0"`, `aria-expanded` in
    // {true,false}, its own label and `aria-hidden="true"`. Anything else is
    // stripped, so a hand-authored span can't impersonate site chrome.
    let html = render(
        "<span class=\"evil\" role=\"link\" tabindex=\"-1\" aria-expanded=\"maybe\" aria-label=\"Click me\" aria-hidden=\"false\" onclick=\"x()\">x</span>",
    );
    // ammonia leaves an emptied `class=""` behind, which carries nothing.
    for gone in [
        "evil",
        "role=",
        "tabindex=",
        "aria-expanded=",
        "aria-label=",
        "aria-hidden=",
        "onclick",
    ] {
        assert!(!html.contains(gone), "{gone} must be stripped: {html}");
    }
}

#[test]
fn render_drops_hand_authored_buttons() {
    // The spoiler no longer needs `<button>`, so it is off the allowlist
    // altogether: a hand-authored one can't fire a form submit or pose as a
    // control.
    let html = render("<button class=\"spoiler\" type=\"submit\" onclick=\"x()\">boom</button>");
    assert!(!html.contains("<button"), "button dropped: {html}");
    assert!(!html.contains("type=\"submit\""), "got: {html}");
    assert!(!html.contains("onclick"), "handler dropped: {html}");
    assert!(html.contains("boom"), "its text survives as text: {html}");
}
