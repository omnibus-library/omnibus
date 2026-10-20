//! The undo planner in isolation: which rows go back where, and which
//! post-merge changes refuse the undo.

use super::*;

#[test]
fn plan_restore_sends_each_row_back_to_the_book_it_came_from() {
    let source_pre = vec![rating(1, 5, 2_000)];
    let target_pre = vec![rating(1, 8, 1_000)];
    // The source's row was the newer one, so the merge left it on the target.
    let merged = vec![rating(1, 5, 2_000)];
    let plan = plan_restore(
        &source_pre,
        &target_pre,
        &merged,
        &merged,
        &Ctx::new(&[1], &[]).plan(),
    )
    .unwrap();
    assert_eq!(plan.to_source, vec![&source_pre[0]]);
    assert_eq!(plan.to_target, vec![&target_pre[0]]);
    assert!(plan.clear_target.is_empty());
}

#[test]
fn plan_restore_clears_the_target_row_when_the_target_had_none() {
    let source_pre = vec![rating(1, 5, 2_000)];
    let merged = vec![rating(1, 5, 2_000)];
    let plan = plan_restore(
        &source_pre,
        &[],
        &merged,
        &merged,
        &Ctx::new(&[1], &[]).plan(),
    )
    .unwrap();
    assert_eq!(plan.to_source, vec![&source_pre[0]]);
    assert!(plan.to_target.is_empty());
    assert_eq!(plan.clear_target, vec![1]);
}

#[test]
fn plan_restore_ignores_readers_the_merge_never_moved_a_row_for() {
    // User 2 rated only the target, so the merge left them alone — and undo
    // must too, even though their row has changed since.
    let target_pre = vec![rating(2, 4, 1_000)];
    let merged = vec![rating(2, 4, 1_000)];
    let current = vec![rating(2, 9, 5_000)];
    let plan = plan_restore(
        &[],
        &target_pre,
        &merged,
        &current,
        &Ctx::new(&[2], &[]).plan(),
    )
    .unwrap();
    assert!(plan.to_source.is_empty());
    assert!(plan.to_target.is_empty());
    assert!(plan.clear_target.is_empty());
}

#[test]
fn plan_restore_refuses_when_the_survivor_was_recurated_after_the_merge() {
    let source_pre = vec![rating(1, 5, 2_000)];
    let merged = vec![rating(1, 5, 2_000)];
    let current = vec![rating(1, 9, 5_000)];
    assert_eq!(
        plan_restore(
            &source_pre,
            &[],
            &merged,
            &current,
            &Ctx::new(&[1], &[]).plan()
        )
        .unwrap_err(),
        Unresolvable::Recurated(1)
    );
}

#[test]
fn plan_restore_refuses_when_only_the_survivors_review_text_or_notes_changed() {
    // Stars untouched, so a rating-only comparison would wave this through and
    // the undo would overwrite words the reader wrote after the merge.
    let source_pre = vec![review(1, 5, 2_000)];
    let merged = vec![review(1, 5, 2_000)];
    let edits = [
        ReviewRow {
            body_md: Some("rewritten after the merge".into()),
            ..review(1, 5, 2_000)
        },
        ReviewRow {
            notes_md: Some("a note added after the merge".into()),
            ..review(1, 5, 2_000)
        },
    ];
    for edited in edits {
        assert_eq!(
            plan_restore(
                &source_pre,
                &[],
                &merged,
                std::slice::from_ref(&edited),
                &Ctx::new(&[1], &[]).plan()
            )
            .unwrap_err(),
            Unresolvable::Recurated(1),
            "{edited:?}"
        );
    }
}

#[test]
fn plan_restore_refuses_when_the_survivors_row_was_deleted_after_the_merge() {
    let source_pre = vec![rating(1, 5, 2_000)];
    let merged = vec![rating(1, 5, 2_000)];
    assert_eq!(
        plan_restore(&source_pre, &[], &merged, &[], &Ctx::new(&[1], &[]).plan()).unwrap_err(),
        Unresolvable::Recurated(1)
    );
}

#[test]
fn plan_restore_allows_a_timestamp_only_touch_of_the_same_value() {
    // Both writers bump `updated_at` on a re-affirmation, and every reading
    // surface auto-writes `reading` on open — so comparing whole rows would
    // let merely opening the merged book block its undo.
    let source_pre = vec![rating(1, 5, 2_000)];
    let merged = vec![rating(1, 5, 2_000)];
    let current = vec![rating(1, 5, 9_000)];
    let plan = plan_restore(
        &source_pre,
        &[],
        &merged,
        &current,
        &Ctx::new(&[1], &[]).plan(),
    )
    .unwrap();
    assert_eq!(plan.clear_target, vec![1]);
}

#[test]
fn plan_restore_skips_a_reader_whose_account_is_gone() {
    // Both tables cascade on `users(id)`, so a deleted account took its rows
    // off both books. There is nothing to restore and nothing to conflict
    // about — and re-inserting would violate the foreign key.
    let source_pre = vec![rating(1, 5, 2_000)];
    let merged = vec![rating(1, 5, 2_000)];
    let ctx = Ctx::new(&[], &[]);
    let plan = plan_restore(&source_pre, &[], &merged, &[], &ctx.plan()).unwrap();
    assert!(plan.to_source.is_empty());
    assert!(plan.clear_target.is_empty());
}

#[test]
fn plan_restore_refuses_a_reader_a_later_open_merge_also_moved() {
    let source_pre = vec![rating(1, 5, 2_000)];
    let merged = vec![rating(1, 5, 2_000)];
    let ctx = Ctx::new(&[1], &[1]);
    assert_eq!(
        plan_restore(&source_pre, &[], &merged, &merged, &ctx.plan()).unwrap_err(),
        Unresolvable::ClaimedByLaterMerge(1)
    );
}

#[test]
fn read_status_says_the_same_ignores_updated_at_but_not_finished_at() {
    let row = |status: &str, updated_at, finished_at| ReadStatusRow {
        user_id: 1,
        status: status.into(),
        updated_at,
        finished_at,
    };
    assert!(row("reading", 1, None).same_value(&row("reading", 9, None)));
    assert!(!row("reading", 1, None).same_value(&row("finished", 1, Some(5))));
    // When the reader finished is part of the statement, not bookkeeping.
    assert!(!row("finished", 1, Some(5)).same_value(&row("finished", 1, Some(9))));
}

#[test]
fn review_says_the_same_ignores_its_dates_but_not_its_text_notes_or_spoiler() {
    let base = review(1, 5, 2_000);
    let redated = ReviewRow {
        rated_at: Some(1),
        created_at: Some(1),
        updated_at: 9_000,
        ..base.clone()
    };
    assert!(base.same_value(&redated));
    for changed in [
        ReviewRow {
            body_md: None,
            ..base.clone()
        },
        ReviewRow {
            notes_md: Some("other".into()),
            ..base.clone()
        },
        ReviewRow {
            spoiler: !base.spoiler,
            ..base.clone()
        },
    ] {
        assert!(!base.same_value(&changed), "{changed:?}");
    }
}
