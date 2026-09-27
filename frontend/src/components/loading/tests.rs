//! Render coverage for the loading vocabulary: each `Loading` kind and the
//! mark it picks, the primitives, busy labels, skeletons, and the pre-paint
//! `BootScript`.

use super::*;
use crate::test_support::render;

fn count(html: &str, needle: &str) -> usize {
    html.matches(needle).count()
}

#[test]
fn loading_defaults_to_a_section_with_the_line_and_a_polite_status() {
    let html = render(rsx! { Loading {} });
    assert!(html.contains("class=\"ld ld-section "), "html: {html}");
    assert!(html.contains("role=\"status\""));
    assert!(html.contains("aria-live=\"polite\""));
    assert!(html.contains("ld-line"));
    assert!(html.contains("Loading\u{2026}"));
}

#[test]
fn loading_page_draws_the_riffle_and_carries_label_and_testid() {
    let html = render(rsx! {
        Loading { kind: LoadingKind::Page, label: "Loading authors", testid: "authors-loading" }
    });
    assert!(html.contains("ld-page"), "html: {html}");
    assert!(html.contains("ld-riffle lg"));
    assert!(html.contains("data-testid=\"authors-loading\""));
    assert!(html.contains("Loading authors"));
}

#[test]
fn loading_stage_draws_a_large_riffle_and_fills_the_slot() {
    let html = render(rsx! {
        Loading { kind: LoadingKind::Stage, class: "rd-overlay",
            button { class: "btn", "Retry" }
        }
    });
    assert!(html.contains("ld-stage rd-overlay"), "html: {html}");
    assert!(html.contains("ld-riffle lg"));
    assert!(html.contains("Retry"));
}

#[test]
fn loading_sets_an_optional_title_between_the_mark_and_the_caption() {
    let html = render(rsx! {
        Loading { kind: LoadingKind::Stage, title: "Preparing your audiobook", label: "A moment" }
    });
    let title = html
        .find("ld-stage-title")
        .unwrap_or_else(|| panic!("no title: {html}"));
    let label = html
        .find("ld-label")
        .unwrap_or_else(|| panic!("no label: {html}"));
    let mark = html
        .find("ld-riffle")
        .unwrap_or_else(|| panic!("no mark: {html}"));
    assert!(mark < title && title < label, "html: {html}");
    let bare = render(rsx! { Loading { kind: LoadingKind::Stage } });
    assert!(!bare.contains("ld-stage-title"), "html: {bare}");
}

#[test]
fn loading_honours_an_explicit_mark_over_the_kind_default() {
    let html = render(rsx! { Loading { kind: LoadingKind::Stage, mark: LoadingMark::Line } });
    assert!(html.contains("ld-line xl"), "html: {html}");
    assert!(!html.contains("ld-riffle"));
}

#[test]
fn loading_row_draws_the_ring() {
    let html = render(rsx! { Loading { kind: LoadingKind::Row, label: "Loading more" } });
    assert!(html.contains("ld-row"), "html: {html}");
    assert!(html.contains("ld-ring sm"));
}

#[test]
fn loading_sheet_draws_a_long_line() {
    let html = render(rsx! { Loading { kind: LoadingKind::Sheet } });
    assert_eq!(count(&html, "<i "), 20, "html: {html}");
}

#[test]
fn line_renders_one_tick_per_count_each_with_index_and_amplitude() {
    let html = render(rsx! { Line { ticks: 5 } });
    assert_eq!(count(&html, "<i "), 5, "html: {html}");
    assert!(html.contains("--n:5"));
    assert!(html.contains("--i:4;--a:0.78"));
}

#[test]
fn tick_style_cycles_the_amplitude_table_past_its_end() {
    let wrapped = tick_style(AMPLITUDES.len());
    assert_eq!(
        wrapped,
        format!("--i:{};--a:{}", AMPLITUDES.len(), AMPLITUDES[0])
    );
}

#[test]
fn riffle_renders_three_two_faced_leaves_over_two_pages() {
    let html = render(rsx! { Riffle { size: MarkSize::Xl } });
    assert!(html.contains("ld-riffle xl"), "html: {html}");
    assert_eq!(count(&html, "ld-rf-page"), 2);
    assert_eq!(count(&html, "ld-rf-leaf"), 3);
    assert_eq!(count(&html, "ld-rf-face front"), 3);
    assert_eq!(count(&html, "ld-rf-face back"), 3);
}

#[test]
fn ring_maps_the_base_size_to_its_own_modifier() {
    assert!(render(rsx! { Ring { size: MarkSize::Md } }).contains("ld-ring md"));
    assert!(render(rsx! { Ring {} }).contains("ld-ring sm"));
}

#[test]
fn boot_script_paints_the_saved_theme_and_watches_images_load() {
    let html = render(rsx! { BootScript {} });
    assert!(html.starts_with("<script"), "html: {html}");
    assert!(html.contains("localStorage.getItem('omn.theme')"));
    assert!(
        html.contains("s&&s.closest('.atrium')"),
        "script escaped: {html}"
    );
    assert!(
        html.contains("setAttribute('data-loaded','')"),
        "no image watch: {html}"
    );
    for theme in crate::components::atrium::Theme::ALL {
        assert!(html.contains(theme.as_attr()), "{theme:?} missing: {html}");
    }
}

#[test]
fn busy_label_shows_the_idle_label_and_sizes_for_the_busy_one() {
    let html =
        render(rsx! { BusyLabel { busy: false, label: "Save", busy_label: "Saving\u{2026}" } });
    assert!(
        html.contains("data-sizer=\"Saving\u{2026}\""),
        "html: {html}"
    );
    assert!(html.contains(">Save<"));
    assert!(!html.contains("ld-ring"));
}

#[test]
fn busy_label_swaps_to_the_busy_label_with_a_ring_while_busy() {
    let html =
        render(rsx! { BusyLabel { busy: true, label: "Save", busy_label: "Saving\u{2026}" } });
    assert!(html.contains("ld-ring xs"), "html: {html}");
    assert!(html.contains(">Saving\u{2026}<"));
    assert!(!html.contains(">Save<"));
}

#[test]
fn cover_skeletons_render_one_cell_per_count_with_staggered_glints() {
    let html = render(rsx! { CoverSkeletons { count: 3, testid: "grid-skeleton" } });
    assert_eq!(count(&html, "ld-covers-cell"), 3, "html: {html}");
    assert_eq!(count(&html, "ld-skel cover"), 3);
    assert!(html.contains("--i:2"));
    assert!(html.contains("data-testid=\"grid-skeleton\""));
}

#[test]
fn row_skeletons_drop_the_avatar_column_when_asked() {
    let with = render(rsx! { RowSkeletons { count: 2 } });
    let without = render(rsx! { RowSkeletons { count: 2, avatar: false } });
    assert_eq!(count(&with, "ld-skel circle"), 2, "html: {with}");
    assert_eq!(count(&without, "ld-skel circle"), 0);
    assert!(without.contains("--row-cols:1fr auto"));
}

#[test]
fn stale_marks_its_children_busy_only_while_stale() {
    let stale = render(rsx! { Stale { stale: true, p { "chart" } } });
    let fresh = render(rsx! { Stale { stale: false, p { "chart" } } });
    assert!(stale.contains("ld-stale is-stale"), "html: {stale}");
    assert!(stale.contains("aria-busy=\"true\""));
    assert!(!fresh.contains("is-stale"));
    assert!(fresh.contains("chart"));
}
