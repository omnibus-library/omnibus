use super::*;

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
