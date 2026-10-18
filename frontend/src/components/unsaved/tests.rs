//! Tests for unsaved-edit tracking: the dirty-form registry, and a form's
//! snapshot guard against what it last loaded or saved.

use std::cell::Cell;

use dioxus::dioxus_core::NoOpMutations;

use super::*;

type Form = (UnsavedChanges, Signal<String>, Signal<Option<String>>);

thread_local! {
    static FORM: Cell<Option<Form>> = const { Cell::new(None) };
}

/// A shell holding one text field guarded by its saved snapshot.
#[component]
fn GuardedShell() -> Element {
    let changes = provide_unsaved_changes();
    let draft = use_signal(String::new);
    let saved = use_saved_snapshot("name", move || draft());
    FORM.with(|form| form.set(Some((changes, draft, saved))));
    rsx! {}
}

fn settle(dom: &mut VirtualDom) {
    dom.process_events();
    dom.render_immediate(&mut NoOpMutations);
    dom.process_events();
}

#[test]
fn dirty_forms_is_clean_until_a_form_reports_an_edit() {
    let mut forms = DirtyForms::default();
    assert!(!forms.any());
    forms.mark("display-name", true);
    assert!(forms.any());
}

#[test]
fn dirty_forms_stays_dirty_while_any_form_has_edits() {
    let mut forms = DirtyForms::default();
    forms.mark("display-name", true);
    forms.mark("smtp", true);
    forms.mark("display-name", false);
    assert!(forms.any());
    forms.mark("smtp", false);
    assert!(!forms.any());
}

#[test]
fn dirty_forms_forgets_a_form_that_goes_away() {
    let mut forms = DirtyForms::default();
    forms.mark("smtp", true);
    forms.forget("smtp");
    assert!(!forms.any());
}

#[test]
fn use_saved_snapshot_marks_the_form_dirty_once_its_value_leaves_the_saved_one() {
    let mut dom = VirtualDom::new(GuardedShell);
    dom.rebuild_in_place();
    let (changes, mut draft, mut saved) = FORM.with(Cell::get).expect("mounted");
    dom.in_runtime(|| saved.set(Some(String::new())));
    settle(&mut dom);
    assert!(!dom.in_runtime(|| changes.is_dirty()));

    dom.in_runtime(|| draft.set("Ada".to_string()));
    settle(&mut dom);

    assert!(dom.in_runtime(|| changes.is_dirty()));
}

#[test]
fn use_saved_snapshot_never_marks_a_form_that_has_not_loaded() {
    let mut dom = VirtualDom::new(GuardedShell);
    dom.rebuild_in_place();
    let (changes, mut draft, _) = FORM.with(Cell::get).expect("mounted");

    dom.in_runtime(|| draft.set("Ada".to_string()));
    settle(&mut dom);

    assert!(!dom.in_runtime(|| changes.is_dirty()));
}
