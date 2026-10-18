//! Reading-goals card in Settings → Goals: the annual books target and the
//! two standing daily targets, always editable, saved together by one Save all.
//!
//! One form rather than three, even though the write path is per-kind: a
//! reader setting up their year thinks about all three at once.
//! [`changed_updates`] is what keeps the per-kind contract intact — only the
//! kinds whose value actually moved are written, so a save never restates a
//! target the reader didn't touch.
//!
//! Goals are account configuration, so every write goes straight to the server
//! and surfaces its failure inline (rule 08 test 1). The inputs start disabled
//! and unread so SSR and the first WASM paint agree (rule 07) and no zero or
//! "no target" is claimed before the saved values arrive (rule 12).

use dioxus::prelude::*;
use omnibus_shared::{
    DailyGoalUpdate, DailyGoals, ReadingGoal, ReadingGoalUpdate, StatsRange, GOAL_KIND_MINUTES,
    GOAL_KIND_PAGES, MAX_DAILY_MINUTES, MAX_DAILY_PAGES, MAX_GOAL_TARGET,
};

use crate::components::unsaved::use_unsaved_guard;
use crate::components::BusyLabel;
use crate::{data, use_server_url};

/// One editable goal: which kind it is, what it's called, and what bounds it.
struct GoalField {
    /// `None` for the annual goal, which has its own route and no kind param.
    kind: Option<&'static str>,
    label: &'static str,
    unit: &'static str,
    hint: &'static str,
    max: i64,
    testid: &'static str,
}

/// The three goals, in the order a reader sets them: the year first, then the
/// two dailies that feed it.
const FIELDS: [GoalField; 3] = [
    GoalField {
        kind: None,
        label: "Books this year",
        unit: "book",
        hint: "Counts a book once, the day you finish it.",
        max: MAX_GOAL_TARGET,
        testid: "goal-books",
    },
    GoalField {
        kind: Some(GOAL_KIND_PAGES),
        label: "Pages a day",
        unit: "page",
        hint: "Estimated from how far you move through each book.",
        max: MAX_DAILY_PAGES,
        testid: "goal-pages",
    },
    GoalField {
        kind: Some(GOAL_KIND_MINUTES),
        label: "Minutes a day",
        unit: "minute",
        hint: "Reading and listening together, on your own clock.",
        max: MAX_DAILY_MINUTES,
        testid: "goal-minutes",
    },
];

/// Signals backing the card — grouped so the seeding effect and the save
/// handler don't each take seven signal params. Mirrors `ProfileSignals` in
/// `profile.rs`.
#[derive(Clone, Copy)]
struct GoalSignals {
    /// One draft per [`FIELDS`] entry, in the same order. Empty means "no
    /// target", which is how a goal is cleared.
    drafts: Signal<[String; 3]>,
    /// Why each field's last save was refused, in [`FIELDS`] order.
    errors: Signal<[Option<String>; 3]>,
    saving: Signal<bool>,
    msg: Signal<Option<String>>,
    msg_is_error: Signal<bool>,
    /// The server's current targets, in [`FIELDS`] order.
    targets: Signal<[Option<i64>; 3]>,
    /// `None` until the read returns, then whether it succeeded — "no target"
    /// is only a fact once the server has said so.
    loaded: Signal<Option<bool>>,
}

/// Pluralize a unit noun. The hints read as sentences, so "1 book" has to win
/// over a parenthesised "(s)".
fn plural(unit: &str, n: i64) -> String {
    if n == 1 {
        unit.to_string()
    } else {
        format!("{unit}s")
    }
}

/// Parse and bound one draft. An empty draft is a deliberate clear, not an
/// error — it is how the form expresses "no target" without a Clear button
/// per row.
///
/// Mirrors the write path's own bounds so a typo never costs a round trip.
fn parse_draft(draft: &str, unit: &str, max: i64) -> Result<Option<i64>, String> {
    let trimmed = draft.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let Ok(target) = trimmed.parse::<i64>() else {
        return Err(format!("Enter a whole number of {}.", plural(unit, 2)));
    };
    if !(1..=max).contains(&target) {
        return Err(format!("Pick a target between 1 and {max}."));
    }
    Ok(Some(target))
}

/// Every draft as a target, or why each refused field was refused.
fn validate_drafts(drafts: &[String; 3]) -> Result<[Option<i64>; 3], [Option<String>; 3]> {
    let results: [Result<Option<i64>, String>; 3] =
        std::array::from_fn(|i| parse_draft(&drafts[i], FIELDS[i].unit, FIELDS[i].max));
    if results.iter().all(Result::is_ok) {
        Ok(results.map(Result::unwrap_or_default))
    } else {
        Err(results.map(Result::err))
    }
}

/// Whether Save all has anything to do: a draft that moves its target, or one
/// that can't be read and so needs saying why.
fn goals_differ_from_saved(drafts: &[String; 3], targets: &[Option<i64>; 3]) -> bool {
    FIELDS
        .iter()
        .enumerate()
        .any(|(i, field)| parse_draft(&drafts[i], field.unit, field.max) != Ok(targets[i]))
}

/// The drafts a save should actually write: index and new value for every
/// field whose target moved.
///
/// This keeps the per-kind write contract behind a single Save: restating an
/// untouched target would overwrite a value another device may have changed.
fn changed_updates(
    drafts: &[Option<i64>; 3],
    current: &[Option<i64>; 3],
) -> Vec<(usize, Option<i64>)> {
    (0..FIELDS.len())
        .filter(|&i| drafts[i] != current[i])
        .map(|i| (i, drafts[i]))
        .collect()
}

/// The status line after a save: what landed, or which kinds didn't.
///
/// Partial failure is reported by name rather than collapsed into "something
/// went wrong": three goals are three writes, and a reader whose annual target
/// saved but whose pages target didn't needs to know which one to retry.
fn save_summary(failed: &[&'static str]) -> (String, bool) {
    match failed {
        [] => ("Goals saved.".to_string(), false),
        [one] => (
            format!("Saved, except {one} \u{2014} try that one again."),
            true,
        ),
        many => (
            format!(
                "Saved, except {} \u{2014} try those again.",
                many.join(" and ")
            ),
            true,
        ),
    }
}

/// Seed the drafts and targets from the server's current goals, once.
///
/// Reads them off the all-time summary — the one payload that already carries
/// both `goal` and `daily_goals`, and the same read the stats page makes, so
/// this costs a shared cache hit rather than a new endpoint.
fn use_goal_hydration(server_url: String, mut signals: GoalSignals) {
    // Reads no signal, so it runs once after mount; `loaded` is written only
    // when the request returns, and a failing endpoint is not retried.
    use_effect(move || {
        let url = server_url.clone();
        spawn(async move {
            let Ok(summary) = data::fetch_stats(&url, StatsRange::AllTime, None).await else {
                signals.msg.set(Some(
                    "Couldn\u{2019}t load your goals \u{2014} reload to try again.".to_string(),
                ));
                signals.msg_is_error.set(true);
                signals.loaded.set(Some(false));
                return;
            };
            let targets = [
                summary.goal.as_ref().map(|g: &ReadingGoal| g.target),
                summary.daily_goals.pages.as_ref().map(|g| g.target),
                summary.daily_goals.minutes.as_ref().map(|g| g.target),
            ];
            signals.targets.set(targets);
            signals
                .drafts
                .set(targets.map(|t| t.map(|n| n.to_string()).unwrap_or_default()));
            signals.loaded.set(Some(true));
        });
    });
}

/// Write every changed goal and fold the results back into the card.
///
/// The writes run in sequence rather than concurrently: they are three
/// requests against one user's settings, and a failure part-way through has to
/// leave the card describing what actually landed.
fn save_handler(
    server_url: String,
    mut signals: GoalSignals,
) -> impl FnMut(Event<FormData>) + 'static {
    move |evt: Event<FormData>| {
        evt.prevent_default();
        let parsed = match validate_drafts(&(signals.drafts)()) {
            Ok(parsed) => parsed,
            Err(errors) => {
                signals.errors.set(errors);
                signals.msg.set(Some(
                    "Nothing saved yet \u{2014} check the targets marked above.".to_string(),
                ));
                signals.msg_is_error.set(true);
                return;
            }
        };
        let pending = changed_updates(&parsed, &(signals.targets)());
        if pending.is_empty() {
            return;
        }
        let url = server_url.clone();
        signals.saving.set(true);
        signals.msg.set(None);
        spawn(async move {
            let mut landed = (signals.targets)();
            let mut errors: [Option<String>; 3] = Default::default();
            let mut failed: Vec<&'static str> = Vec::new();
            for (i, value) in pending {
                let ok = match FIELDS[i].kind {
                    None => write_annual(&url, value).await,
                    Some(kind) => write_daily(&url, kind, value).await,
                };
                if ok {
                    landed[i] = value;
                } else {
                    failed.push(FIELDS[i].label);
                    errors[i] = Some("This one didn\u{2019}t save \u{2014} try again.".to_string());
                }
            }
            let (msg, is_error) = save_summary(&failed);
            signals.targets.set(landed);
            // Reset only the drafts that landed: a failed kind keeps what the
            // reader typed, so it still differs from its target and the retry
            // the status line asks for has something to write.
            let mut drafts_after = (signals.drafts)();
            for (i, error) in errors.iter().enumerate() {
                if error.is_none() {
                    drafts_after[i] = landed[i].map(|n| n.to_string()).unwrap_or_default();
                }
            }
            signals.drafts.set(drafts_after);
            signals.errors.set(errors);
            signals.msg.set(Some(msg));
            signals.msg_is_error.set(is_error);
            signals.saving.set(false);
        });
    }
}

/// One annual write. `None` clears the target, keeping the year's progress.
async fn write_annual(server_url: &str, target: Option<i64>) -> bool {
    let update = match target {
        Some(n) => ReadingGoalUpdate::books(n),
        None => ReadingGoalUpdate::clear_books(),
    };
    data::save_reading_goal(server_url, &update).await.is_ok()
}

/// One daily write. `None` clears the target only — the day's progress is the
/// server's to report and survives, as `DailyGoalUpdate::clear` does.
async fn write_daily(server_url: &str, kind: &str, target: Option<i64>) -> bool {
    let update = match target {
        Some(n) => DailyGoalUpdate::set(kind, n),
        None => DailyGoalUpdate::clear(kind),
    };
    data::save_daily_goal(server_url, &update)
        .await
        .map(|_: DailyGoals| ())
        .is_ok()
}

/// One goal's label, input, hint and — once a save refuses it — its error.
/// Until the goals are read the input is disabled and claims no value.
fn goal_field(i: usize, signals: GoalSignals, known: bool, saving: bool) -> Element {
    let GoalSignals {
        mut drafts,
        mut errors,
        mut msg,
        ..
    } = signals;
    let field = &FIELDS[i];
    let error = errors.read()[i].clone();
    let invalid = error.is_some();
    let described_by = if invalid {
        format!("{0}-hint {0}-error", field.testid)
    } else {
        format!("{}-hint", field.testid)
    };
    rsx! {
        div { class: "settings-field",
            label { r#for: "{field.testid}", {field.label} }
            input {
                r#type: "number",
                id: "{field.testid}",
                class: if !known { "ld-unknown" },
                "data-testid": "{field.testid}-input",
                min: "1",
                max: "{field.max}",
                inputmode: "numeric",
                placeholder: if known { "No target" },
                value: "{drafts.read()[i]}",
                disabled: !known || saving,
                "aria-invalid": invalid,
                "aria-describedby": "{described_by}",
                oninput: move |e| {
                    drafts.write()[i] = e.value();
                    errors.write()[i] = None;
                    msg.set(None);
                },
            }
            p { class: "settings-hint", id: "{field.testid}-hint", {field.hint} }
            if let Some(error) = error {
                p {
                    class: "settings-field-error",
                    id: "{field.testid}-error",
                    "data-testid": "{field.testid}-error",
                    "{error}"
                }
            }
        }
    }
}

/// The footer's status: a sheen while the goals are read, then the last
/// save's outcome. Always mounted, so its first message is announced.
fn goals_status(loaded: Option<bool>, msg: Option<String>, is_error: bool) -> Element {
    let class = match (&msg, is_error) {
        (Some(_), true) => "settings-status settings-action-status error",
        (Some(_), false) => "settings-status settings-action-status success",
        (None, _) => "settings-status settings-action-status",
    };
    rsx! {
        p { role: "status", class, "data-testid": "goals-status",
            if loaded.is_none() {
                span { class: "ld-sheen", "Reading your goals" }
            } else {
                {msg.unwrap_or_default()}
            }
        }
    }
}

/// Reading goals for the signed-in user: three always-editable targets and one
/// Save all, which wakes once a value differs from what is saved.
#[component]
pub(crate) fn ReadingGoalsCard() -> Element {
    let server_url = use_server_url();
    let signals = GoalSignals {
        drafts: use_signal(|| [const { String::new() }; 3]),
        errors: use_signal(Default::default),
        saving: use_signal(|| false),
        msg: use_signal(|| None::<String>),
        msg_is_error: use_signal(|| false),
        targets: use_signal(|| [None; 3]),
        loaded: use_signal(|| None::<bool>),
    };
    use_goal_hydration(server_url.clone(), signals);
    let dirty = use_memo(move || {
        (signals.loaded)() == Some(true)
            && goals_differ_from_saved(&(signals.drafts)(), &(signals.targets)())
    });
    use_unsaved_guard("goals", dirty);

    let on_save = save_handler(server_url, signals);
    let loaded = (signals.loaded)();
    let known = loaded == Some(true);
    let saving = (signals.saving)();

    rsx! {
        section { class: "card", "data-testid": "account-goals-card",
            h3 { "Reading goals" }
            p { class: "subtitle",
                "Leave a field empty for no goal. Clearing one keeps the progress you have \
                 already made toward it."
            }
            // `novalidate`: the browser's own constraint check would silently
            // refuse the submit on an over-`max` value, so the field's error —
            // which names its bound — would never show.
            form {
                id: "goals-form",
                class: "settings-form",
                novalidate: true,
                onsubmit: on_save,
                {goal_field(0, signals, known, saving)}
                {goal_field(1, signals, known, saving)}
                {goal_field(2, signals, known, saving)}
                div { class: "settings-actions",
                    {goals_status(loaded, (signals.msg)(), (signals.msg_is_error)())}
                    button {
                        r#type: "submit",
                        class: "btn primary",
                        disabled: saving || !dirty(),
                        "aria-busy": "{saving}",
                        "data-testid": "goals-save",
                        BusyLabel { busy: saving, label: "Save all", busy_label: "Saving\u{2026}" }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
