use super::*;

#[test]
fn parse_draft_reads_an_empty_field_as_a_deliberate_clear() {
    // The single form has no per-row Clear button; an empty field is how a
    // reader drops a goal, so it must not read as a validation error.
    assert_eq!(parse_draft("", "book", MAX_GOAL_TARGET), Ok(None));
    assert_eq!(parse_draft("   ", "page", MAX_DAILY_PAGES), Ok(None));
}

#[test]
fn parse_draft_accepts_in_range_values_and_rejects_the_rest() {
    assert_eq!(parse_draft(" 24 ", "book", MAX_GOAL_TARGET), Ok(Some(24)));
    assert!(parse_draft("twelve", "book", MAX_GOAL_TARGET).is_err());
    assert!(parse_draft("0", "book", MAX_GOAL_TARGET).is_err());
    assert!(parse_draft(&(MAX_GOAL_TARGET + 1).to_string(), "book", MAX_GOAL_TARGET).is_err());
}

#[test]
fn parse_draft_bounds_each_kind_against_its_own_maximum() {
    // 1,500 is a legal day of pages and an impossible day of minutes, so the
    // same draft has to be accepted by one field and refused by the other.
    assert_eq!(
        parse_draft("1500", "page", MAX_DAILY_PAGES),
        Ok(Some(1_500))
    );
    let err = parse_draft("1500", "minute", MAX_DAILY_MINUTES).unwrap_err();
    assert!(err.contains(&MAX_DAILY_MINUTES.to_string()), "{err}");
}

#[test]
fn parse_draft_names_the_unit_it_is_asking_for() {
    assert_eq!(
        parse_draft("x", "minute", MAX_DAILY_MINUTES),
        Err("Enter a whole number of minutes.".to_string())
    );
}

#[test]
fn changed_updates_writes_only_the_kinds_that_actually_moved() {
    // The single Save must not restate a target the reader didn't touch:
    // another device may have changed it since this page loaded.
    let current = [Some(30), Some(30), Some(45)];
    let drafts = [Some(30), Some(50), Some(45)];
    assert_eq!(changed_updates(&drafts, &current), vec![(1, Some(50))]);
}

#[test]
fn changed_updates_is_empty_when_nothing_moved() {
    let current = [Some(30), None, Some(45)];
    assert_eq!(changed_updates(&current, &current), Vec::new());
}

#[test]
fn changed_updates_carries_a_clear_as_a_change() {
    // Blanking a field is a write, not a no-op — the row has to be dropped.
    let current = [Some(30), Some(30), Some(45)];
    let drafts = [Some(30), None, Some(45)];
    assert_eq!(changed_updates(&drafts, &current), vec![(1, None)]);
}

#[test]
fn changed_updates_reports_every_moved_kind_in_field_order() {
    let current = [None, None, None];
    let drafts = [Some(30), Some(30), Some(45)];
    assert_eq!(
        changed_updates(&drafts, &current),
        vec![(0, Some(30)), (1, Some(30)), (2, Some(45))]
    );
}

#[test]
fn save_summary_names_the_kinds_that_failed_rather_than_shrugging() {
    // Three goals are three writes. A reader whose annual target saved but
    // whose pages target didn't needs to know which one to retry.
    assert_eq!(save_summary(&[]), ("Goals saved.".to_string(), false));
    let (one, is_error) = save_summary(&["Pages a day"]);
    assert_eq!(
        one,
        "Saved, except Pages a day \u{2014} try that one again."
    );
    assert!(is_error);
    let (two, _) = save_summary(&["Pages a day", "Minutes a day"]);
    assert_eq!(
        two,
        "Saved, except Pages a day and Minutes a day \u{2014} try those again."
    );
}

/// The retry the failure message asks for has to be possible: a kind whose
/// write failed keeps the reader's draft, so the next Save still sees it as a
/// change. Resetting every draft from the landed targets is what broke this —
/// the failed field reverted, `changed_updates` then found nothing to do, and
/// the retry closed the editor having written nothing.
#[test]
fn a_failed_kinds_draft_still_differs_from_its_target_so_a_retry_writes() {
    // Books landed at 24; pages was typed as 30 and its write failed, so its
    // target is still unset.
    let targets = [Some(24), None, None];
    let drafts_after_failure = [Some(24), Some(30), None];
    assert_eq!(
        changed_updates(&drafts_after_failure, &targets),
        vec![(1, Some(30))],
        "the retry must still have the failed kind to write"
    );
}

#[test]
fn goals_differ_from_saved_is_false_when_every_draft_matches_its_target() {
    let drafts = ["24".to_string(), " 30 ".to_string(), String::new()];
    assert!(!goals_differ_from_saved(
        &drafts,
        &[Some(24), Some(30), None]
    ));
}

#[test]
fn goals_differ_from_saved_is_true_when_a_draft_changes_a_target() {
    let drafts = ["25".to_string(), "30".to_string(), String::new()];
    assert!(goals_differ_from_saved(
        &drafts,
        &[Some(24), Some(30), None]
    ));
}

#[test]
fn goals_differ_from_saved_is_true_when_a_draft_clears_a_target() {
    let drafts = ["24".to_string(), String::new(), String::new()];
    assert!(goals_differ_from_saved(
        &drafts,
        &[Some(24), Some(30), None]
    ));
}

/// An unreadable draft enables Save all, so pressing it shows why it can't be
/// saved instead of the button silently refusing.
#[test]
fn goals_differ_from_saved_is_true_when_a_draft_cannot_be_read() {
    let drafts = ["24".to_string(), "lots".to_string(), String::new()];
    assert!(goals_differ_from_saved(
        &drafts,
        &[Some(24), Some(30), None]
    ));
}

#[test]
fn validate_drafts_returns_every_target_when_all_drafts_parse() {
    let drafts = ["24".to_string(), String::new(), "45".to_string()];
    assert_eq!(validate_drafts(&drafts), Ok([Some(24), None, Some(45)]));
}

#[test]
fn validate_drafts_names_each_refused_field() {
    let drafts = ["0".to_string(), "30".to_string(), "1500".to_string()];
    let errors = validate_drafts(&drafts).unwrap_err();
    assert_eq!(
        errors[0].as_deref(),
        Some("Pick a target between 1 and 10000.")
    );
    assert_eq!(errors[1], None);
    assert_eq!(
        errors[2].as_deref(),
        Some("Pick a target between 1 and 1440.")
    );
}

#[cfg(feature = "server")]
mod render_tests {
    use super::*;
    use crate::test_support::render;

    #[test]
    fn goals_card_renders_three_inputs_and_one_save_all_control() {
        let html = render(rsx! { ReadingGoalsCard {} });

        assert!(html.contains("<h3>Reading goals</h3>"), "{html}");
        for testid in ["goal-books-input", "goal-pages-input", "goal-minutes-input"] {
            assert!(html.contains(testid), "missing {testid}: {html}");
        }
        assert_eq!(
            html.matches("data-testid=\"goals-save\"").count(),
            1,
            "{html}"
        );
        assert!(html.contains("Save all"), "{html}");
        for gone in ["goals-edit", "goals-cancel", "goal-books-value"] {
            assert!(!html.contains(gone), "{gone} is back: {html}");
        }
    }

    #[test]
    fn goals_card_holds_inputs_disabled_and_unknown_until_the_goals_load() {
        let html = render(rsx! { ReadingGoalsCard {} });

        assert_eq!(html.matches("ld-unknown").count(), 3, "{html}");
        assert_eq!(
            html.matches("disabled").count(),
            4,
            "three inputs and Save all: {html}"
        );
        // Neither a zero nor "no target" before the saved values have arrived.
        assert!(!html.contains("value=\"0\""), "{html}");
        assert!(!html.contains("No target"), "{html}");
        assert!(html.contains("ld-sheen"), "{html}");
    }

    #[test]
    fn goals_card_puts_save_all_and_its_status_in_the_card_footer() {
        let html = render(rsx! { ReadingGoalsCard {} });
        let footer = html
            .find("class=\"settings-actions\"")
            .expect("the card has a footer row");
        let status = html.find("data-testid=\"goals-status\"").expect("status");
        let save = html.find("data-testid=\"goals-save\"").expect("save");
        assert!(footer < status && status < save, "{html}");
        assert!(
            html.contains("settings-status settings-action-status"),
            "{html}"
        );
        assert!(html.contains("class=\"btn primary\""), "{html}");
    }
}
