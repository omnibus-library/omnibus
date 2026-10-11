//! Unit tests for the pure persistence decisions: where an edit is saved and
//! whether a resolved library path replaces the prefs in memory.

use super::*;

fn plan(write_to: Option<&str>, unsaved: bool) -> SavePlan {
    SavePlan {
        write_to: write_to.map(str::to_string),
        unsaved,
    }
}

mod save_plan {
    use super::*;

    #[test]
    fn writes_under_the_library_path_when_it_is_known() {
        let got = save_plan(Some("/library/a"), false, Some("/library/b".into()));

        assert_eq!(got, plan(Some("/library/a"), false));
    }

    #[test]
    fn defers_the_write_while_the_first_page_is_still_out() {
        let got = save_plan(None, false, Some("/library/b".into()));

        assert_eq!(got, plan(None, true));
    }

    #[test]
    fn writes_under_the_pointer_when_the_first_page_failed() {
        let got = save_plan(None, true, Some("/library/b".into()));

        assert_eq!(got, plan(Some("/library/b"), true));
    }

    #[test]
    fn writes_nowhere_when_the_first_page_failed_and_no_pointer_exists() {
        let got = save_plan(None, true, None);

        assert_eq!(got, plan(None, true));
    }
}

mod reconcile_action {
    use super::*;

    #[test]
    fn adopts_the_stored_prefs_for_a_library_not_yet_reconciled() {
        let got = reconcile_action(None, "/library/a", false);

        assert_eq!(got, Reconcile::Adopt);
    }

    #[test]
    fn keeps_the_prefs_when_the_same_path_is_set_again() {
        let got = reconcile_action(Some("/library/a"), "/library/a", false);

        assert_eq!(got, Reconcile::Keep);
    }

    #[test]
    fn adopts_the_stored_prefs_when_the_path_changes_with_nothing_unsaved() {
        let got = reconcile_action(Some("/library/a"), "/library/b", false);

        assert_eq!(got, Reconcile::Adopt);
    }

    #[test]
    fn saves_unsaved_edits_under_the_first_resolved_path() {
        let got = reconcile_action(None, "/library/a", true);

        assert_eq!(got, Reconcile::SaveEdits);
    }

    #[test]
    fn saves_unsaved_edits_even_when_the_path_was_reconciled_before() {
        let got = reconcile_action(Some("/library/a"), "/library/a", true);

        assert_eq!(got, Reconcile::SaveEdits);
    }
}
