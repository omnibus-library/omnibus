//! Coverage for the edit-shelf modal: SSR render-smoke of the Kobo sync
//! opt-in toggle (prefilled from the shelf, never shown for system shelves),
//! plus `build_update_request`'s save-validation branches. Needs the
//! `server` feature (`dioxus::ssr`).

use omnibus_shared::{RuleField, RuleOp, ShelfRule, Visibility};

use super::*;
use crate::test_support::render;

/// A minimal shelf for prop-driven render tests.
fn shelf(kind: ShelfKind, sync_to_kobo: bool) -> Shelf {
    Shelf {
        id: 7,
        owner_user_id: 1,
        owner_username: "sloan".into(),
        owner_has_avatar: false,
        kind,
        name: "Cosy Reads".into(),
        description: None,
        visibility: Visibility::Private,
        accent: None,
        match_mode: (kind == ShelfKind::Smart).then_some(MatchMode::All),
        rules: Vec::new(),
        book_count: 0,
        sync_to_kobo,
    }
}

#[component]
fn Harness(kind: ShelfKind, sync_to_kobo: bool) -> Element {
    rsx! {
        EditShelfModal {
            shelf: shelf(kind, sync_to_kobo),
            on_close: move |_| {},
            on_saved: move |_| {},
        }
    }
}

/// The opening tag holding `data-testid="<testid>"` — attribute-order-proof
/// so assertions survive renderer reordering.
fn tag_with_testid<'a>(html: &'a str, testid: &str) -> &'a str {
    let needle = format!("data-testid=\"{testid}\"");
    let pos = html
        .find(&needle)
        .unwrap_or_else(|| panic!("no element with testid {testid} in: {html}"));
    let start = html[..pos].rfind('<').expect("testid outside a tag");
    let end = pos + html[pos..].find('>').expect("unterminated tag");
    &html[start..=end]
}

#[test]
fn edit_shelf_modal_renders_the_kobo_toggle_off_when_the_shelf_does_not_sync() {
    let html = render(rsx! { Harness { kind: ShelfKind::Manual, sync_to_kobo: false } });
    assert!(html.contains("Sync to Kobo"));
    assert!(tag_with_testid(&html, "edit-shelf-kobo-off").contains("aria-pressed=\"true\""));
    assert!(tag_with_testid(&html, "edit-shelf-kobo-on").contains("aria-pressed=\"false\""));
}

#[test]
fn edit_shelf_modal_prefills_the_kobo_toggle_on_from_the_shelf() {
    let html = render(rsx! { Harness { kind: ShelfKind::Smart, sync_to_kobo: true } });
    assert!(tag_with_testid(&html, "edit-shelf-kobo-on").contains("aria-pressed=\"true\""));
    assert!(tag_with_testid(&html, "edit-shelf-kobo-off").contains("aria-pressed=\"false\""));
}

#[test]
fn edit_shelf_modal_hides_the_kobo_toggle_for_system_shelves() {
    let html = render(rsx! { Harness { kind: ShelfKind::Wishlist, sync_to_kobo: false } });
    assert!(!html.contains("Sync to Kobo"));
    assert!(!html.contains("edit-shelf-kobo-on"));
}

#[component]
fn RuleHarness(rules: Vec<ShelfRule>) -> Element {
    let mut s = shelf(ShelfKind::Smart, false);
    s.rules = rules;
    rsx! { EditShelfModal { shelf: s, on_close: move |_| {}, on_saved: move |_| {} } }
}

/// The first `<option …>` tag carrying `value="<value>"` after the element
/// tagged `data-testid="<testid>"`.
fn option_tag<'a>(html: &'a str, testid: &str, value: &str) -> &'a str {
    let from = html
        .find(&format!("data-testid=\"{testid}\""))
        .unwrap_or_else(|| panic!("no element with testid {testid} in: {html}"));
    let needle = format!("value=\"{value}\"");
    html[from..]
        .split("<option")
        .skip(1)
        .map(|rest| &rest[..rest.find('>').expect("unterminated option")])
        .find(|tag| tag.contains(&needle))
        .unwrap_or_else(|| panic!("no option {value} after {testid}: {html}"))
}

/// The selects set their value before their options exist, so the saved rule
/// must be marked on the option itself or the first option paints first.
#[test]
fn edit_shelf_modal_selects_the_saved_rule_from_the_first_paint() {
    let rules = vec![
        ShelfRule {
            field: RuleField::Genre,
            op: RuleOp::IsNot,
            value: "Science Fiction".into(),
        },
        ShelfRule {
            field: RuleField::Status,
            op: RuleOp::Is,
            value: "reading".into(),
        },
    ];
    let html = render(rsx! { RuleHarness { rules } });

    assert!(option_tag(&html, "condition-field-0", "genre").contains("selected"));
    assert!(!option_tag(&html, "condition-field-0", "tag").contains("selected"));
    assert!(option_tag(&html, "condition-op-0", "is_not").contains("selected"));
    assert!(!option_tag(&html, "condition-op-0", "is").contains("selected"));
    assert!(option_tag(&html, "condition-field-1", "status").contains("selected"));
    assert!(option_tag(&html, "condition-row-1", "reading").contains("selected"));
    assert!(!option_tag(&html, "condition-row-1", "finished").contains("selected"));
}

/// A single complete Tag-is-Fantasy draft — the minimal input a smart shelf
/// needs to encode a non-empty rule set.
fn complete_draft() -> RuleDraft {
    RuleDraft {
        field: RuleField::Tag,
        op: RuleOp::Is,
        value: "Fantasy".into(),
        value2: String::new(),
        unit: "d".into(),
    }
}

#[test]
fn build_update_request_rejects_an_empty_name_before_any_other_check() {
    let err = build_update_request(
        "   ",
        Visibility::Private,
        true,
        false,
        true,
        MatchMode::All,
        &[complete_draft()],
    )
    .unwrap_err();
    assert_eq!(err, "Name is required.");
}

#[test]
fn build_update_request_rejects_a_smart_shelf_with_no_complete_rules() {
    // An incomplete draft (empty value) encodes to no wire rule at all.
    let incomplete = RuleDraft::default();
    let err = build_update_request(
        "Cosy Reads",
        Visibility::Private,
        true,
        false,
        true,
        MatchMode::All,
        &[incomplete],
    )
    .unwrap_err();
    assert_eq!(err, "Add at least one condition.");
}

#[test]
fn build_update_request_accepts_a_manual_shelf_with_no_rules() {
    // Manual shelves skip the rule-set check entirely (`is_smart == false`).
    let req = build_update_request(
        "Cosy Reads",
        Visibility::Public,
        true,
        true,
        false,
        MatchMode::All,
        &[],
    )
    .expect("manual shelves don't need any rules");
    assert_eq!(req.name, Some("Cosy Reads".to_string()));
    assert_eq!(req.visibility, Some(Visibility::Public));
    assert_eq!(req.sync_to_kobo, Some(true));
    assert_eq!(req.rules, None);
}

#[test]
fn build_update_request_accepts_a_smart_shelf_with_a_complete_rule() {
    let req = build_update_request(
        "Cosy Reads",
        Visibility::Private,
        true,
        false,
        true,
        MatchMode::Any,
        &[complete_draft()],
    )
    .expect("a complete draft encodes a rule");
    assert_eq!(req.match_mode, Some(MatchMode::Any));
    assert_eq!(
        req.rules,
        Some(vec![ShelfRule {
            field: RuleField::Tag,
            op: RuleOp::Is,
            value: "Fantasy".into(),
        }])
    );
}
