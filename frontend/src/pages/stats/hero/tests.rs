use super::*;
use omnibus_shared::DayActivity;

fn summary(as_of: &str, streak: i64, days: &[(&str, i64)]) -> StatsSummary {
    StatsSummary {
        as_of_day: as_of.to_string(),
        current_streak_days: streak,
        heatmap: days
            .iter()
            .map(|(day, secs)| DayActivity {
                day: (*day).to_string(),
                seconds: *secs,
            })
            .collect(),
        ..StatsSummary::default()
    }
}

#[test]
fn build_spark_draws_one_slot_per_day_and_scales_to_its_own_busiest() {
    let s = summary(
        "2026-08-12",
        2,
        &[
            ("2026-08-12", 1_800),
            ("2026-08-11", 3_600),
            ("2026-08-01", 900),
        ],
    );
    let anchor = day_number("2026-08-12").expect("a real day");
    let bars = build_spark(&s, anchor);

    assert_eq!(bars.len() as i64, SPARK_DAYS);
    let last = bars.last().expect("a bar per day");
    assert_eq!(last.day, "2026-08-12");
    assert_eq!(last.height_pct, 50, "half the busiest day drawn");
    // The quiet days keep their slots — the gaps are what make a run visible.
    assert!(bars.iter().filter(|b| !b.active).count() > 30);
}

#[test]
fn build_spark_marks_only_the_live_run_and_only_where_something_happened() {
    let s = summary(
        "2026-08-12",
        2,
        &[
            ("2026-08-12", 600),
            ("2026-08-11", 600),
            ("2026-08-05", 600),
        ],
    );
    let anchor = day_number("2026-08-12").expect("a real day");
    let bars = build_spark(&s, anchor);

    let lit: Vec<&str> = bars
        .iter()
        .filter(|b| b.in_streak)
        .map(|b| b.day.as_str())
        .collect();
    assert_eq!(lit, ["2026-08-11", "2026-08-12"]);
    // The earlier active day is drawn, but not as part of the run.
    let earlier = bars.iter().find(|b| b.day == "2026-08-05").expect("drawn");
    assert!(earlier.active && !earlier.in_streak);
}

#[test]
fn build_spark_stays_flat_when_nothing_was_recorded() {
    let s = summary("2026-08-12", 0, &[]);
    let anchor = day_number("2026-08-12").expect("a real day");
    let bars = build_spark(&s, anchor);
    assert!(bars.iter().all(|b| b.height_pct == 0 && !b.active));
}

#[test]
fn streak_line_compares_the_run_against_the_record_and_says_nothing_without_one() {
    assert_eq!(
        streak_line(3, 61, true).as_deref(),
        Some("Your longest ever is 61 days.")
    );
    assert_eq!(
        streak_line(0, 1, true).as_deref(),
        Some("Your longest ever is 1 day.")
    );
    assert_eq!(
        streak_line(61, 61, true).as_deref(),
        Some("That is the longest run you have recorded.")
    );
    // Nothing recorded yet: the sentence would be furniture.
    assert_eq!(streak_line(0, 0, true), None);
}

#[test]
fn streak_line_reads_third_person_on_another_readers_page() {
    assert_eq!(
        streak_line(3, 61, false).as_deref(),
        Some("The longest ever is 61 days.")
    );
    assert_eq!(
        streak_line(61, 61, false).as_deref(),
        Some("That is the longest run on record.")
    );
}

// SSR render coverage for `who`'s first/third-person split. `StatsHero`
// renders the goal cards' `dioxus_router::Link`s, which panic without a live
// router (see `components::page_state`'s module comment), so each state gets
// a one-route host mounted through `dioxus_router::Router`.
#[cfg(feature = "server")]
mod render_tests {
    use dioxus_router::{Routable, Router};

    use crate::test_support::render_in_vdom;

    use super::*;

    fn summary_with_streak(current: i64, longest: i64) -> StatsSummary {
        StatsSummary {
            as_of_day: "2026-07-02".to_string(),
            current_streak_days: current,
            longest_streak_days: longest,
            ..StatsSummary::default()
        }
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum AnotherReaderRoute {
        #[route("/")]
        AnotherReaderHost {},
    }

    #[component]
    fn AnotherReaderHost() -> Element {
        rsx! {
            StatsHero {
                summary: Some(summary_with_streak(5, 20)),
                who: Some("alice's stats".to_string()),
            }
        }
    }

    #[test]
    fn stats_hero_reads_third_person_and_offers_no_goals_link_for_another_reader() {
        let html = render_in_vdom(|| rsx! { Router::<AnotherReaderRoute> {} });
        assert!(html.contains("stats-hero-who"), "{html}");
        // SSR HTML-escapes the apostrophe.
        assert!(html.contains("alice&#39;s stats"), "{html}");
        assert!(html.contains("On a run"), "{html}");
        assert!(html.contains("The longest ever is 20 days."), "{html}");
        assert!(!html.contains("stats-goals-link"), "{html}");
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum OwnPageRoute {
        #[route("/")]
        OwnPageHost {},
    }

    #[component]
    fn OwnPageHost() -> Element {
        rsx! {
            StatsHero { summary: Some(summary_with_streak(5, 20)) }
        }
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum GoalSetRoute {
        #[route("/")]
        GoalSetHost {},
    }

    #[component]
    fn GoalSetHost() -> Element {
        let mut summary = summary_with_streak(5, 20);
        summary.daily_goals.minutes = Some(omnibus_shared::DailyGoal {
            kind: omnibus_shared::GOAL_KIND_MINUTES.to_string(),
            target: 30,
            current: 10,
            day: "2026-07-02".to_string(),
        });
        rsx! { StatsHero { summary: Some(summary) } }
    }

    #[test]
    fn stats_hero_stays_first_person_on_the_callers_own_page() {
        let html = render_in_vdom(|| rsx! { Router::<OwnPageRoute> {} });
        assert!(!html.contains("stats-hero-who"), "{html}");
        assert!(html.contains("You are on a run"), "{html}");
        assert!(html.contains("Your longest ever is 20 days."), "{html}");
    }

    /// One control for every goal, and it goes to where goals are edited.
    #[test]
    fn stats_hero_links_to_the_goals_section_to_set_goals_when_none_is_set() {
        let html = render_in_vdom(|| rsx! { Router::<OwnPageRoute> {} });
        assert_eq!(
            html.matches("data-testid=\"stats-goals-link\"").count(),
            1,
            "{html}"
        );
        assert!(html.contains(r#"href="/settings?section=goals""#), "{html}");
        assert!(html.contains(">Set goals<"), "{html}");
        for gone in [
            "stats-goal-set-link",
            "stats-daily-set-link",
            "stats-goals-edit",
        ] {
            assert!(!html.contains(gone), "{gone} is back: {html}");
        }
    }

    #[test]
    fn stats_hero_links_to_the_goals_section_to_edit_goals_once_any_is_set() {
        let html = render_in_vdom(|| rsx! { Router::<GoalSetRoute> {} });
        assert_eq!(
            html.matches("data-testid=\"stats-goals-link\"").count(),
            1,
            "{html}"
        );
        assert!(html.contains(">Edit goals<"), "{html}");
        assert!(!html.contains(">Set goals<"), "{html}");
    }
}
