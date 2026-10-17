//! Tests for the precedence editor: the reorder and announcement helpers, the
//! loading first paint, and a loaded list's markup.

use omnibus_shared::MetadataSource::{
    EmbeddedTags, FolderStructure, OmnibusOverrides, OpfSidecar, ProviderMatch,
};

use super::*;
use crate::test_support::{render, render_in_vdom};

#[test]
fn move_source_swaps_the_item_up_and_reports_where_it_landed() {
    let mut order = vec![FolderStructure, EmbeddedTags, OpfSidecar];
    assert_eq!(move_source(&mut order, 1, Direction::Up), Some(0));
    assert_eq!(order, vec![EmbeddedTags, FolderStructure, OpfSidecar]);
}

#[test]
fn move_source_refuses_to_move_past_either_end() {
    let mut order = vec![FolderStructure, EmbeddedTags];
    assert_eq!(move_source(&mut order, 0, Direction::Up), None);
    assert_eq!(move_source(&mut order, 1, Direction::Down), None);
    assert_eq!(order, vec![FolderStructure, EmbeddedTags]);
}

#[test]
fn focus_after_move_keeps_the_direction_until_the_item_reaches_an_end() {
    assert_eq!(focus_after_move(2, 5, Direction::Up), Direction::Up);
    // At the top the Up button is disabled, so focus takes the other one.
    assert_eq!(focus_after_move(0, 5, Direction::Up), Direction::Down);
    assert_eq!(focus_after_move(4, 5, Direction::Down), Direction::Up);
}

#[test]
fn position_announcement_names_the_source_and_its_new_place() {
    assert_eq!(
        position_announcement(OpfSidecar, 1, 5),
        "OPF sidecar moved to position 2 of 5."
    );
}

#[test]
fn precedence_field_waits_for_the_saved_order_instead_of_showing_defaults() {
    let html = render_in_vdom(MetadataPrecedenceField);
    assert!(html.contains("metadata-precedence-loading"), "{html}");
    assert!(!html.contains("Folder structure"), "{html}");
    let at = html
        .find(r#"data-testid="metadata-precedence-save""#)
        .expect("save");
    let tag = &html[html[..at].rfind('<').unwrap()..at + html[at..].find('>').unwrap()];
    assert!(tag.contains("disabled"), "{html}");
}

#[component]
fn LoadedList() -> Element {
    let order = use_signal(|| {
        Some(vec![
            FolderStructure,
            EmbeddedTags,
            OpfSidecar,
            OmnibusOverrides,
            ProviderMatch,
        ])
    });
    let announcement = use_signal(String::new);
    rsx! { PrecedenceList { library: "ebook", label: "Ebook library", order, announcement } }
}

#[test]
fn precedence_list_is_named_by_its_label_and_labels_every_source() {
    let html = render(rsx! { LoadedList {} });
    assert!(
        html.contains(r#"id="ebook-metadata-precedence-label""#),
        "{html}"
    );
    assert!(
        html.contains(r#"aria-labelledby="ebook-metadata-precedence-label""#),
        "{html}"
    );
    for source in DEFAULT_METADATA_PRECEDENCE {
        assert!(html.contains(source_label(source)), "{source:?}: {html}");
    }
    assert!(
        html.contains(r#"aria-label="Move Folder structure up""#),
        "{html}"
    );
}
