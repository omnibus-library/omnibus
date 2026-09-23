//! Tests for the drill-in's delta/trend math and Finished-book mapping.

use omnibus_shared::TrendPoint;

use super::*;

#[test]
fn build_trend_bars_scales_to_the_tallest_point_and_stays_zero_when_empty_of_activity() {
    let points = vec![
        ("A".to_string(), 0.0),
        ("B".to_string(), 2.0),
        ("C".to_string(), 4.0),
    ];
    let bars = build_trend_bars(&points);
    assert_eq!(bars[0].height_pct, 0);
    assert_eq!(bars[1].height_pct, 50);
    assert_eq!(bars[2].height_pct, 100);

    let zeroed = build_trend_bars(&[("A".to_string(), 0.0)]);
    assert_eq!(zeroed[0].height_pct, 0);
}

fn bucket(half_stars: i64, books: i64) -> RatingBucket {
    RatingBucket { half_stars, books }
}

#[test]
fn star_label_renders_buckets_in_stars_never_in_half_stars() {
    assert_eq!(star_label(&bucket(1, 0)), "0.5");
    assert_eq!(star_label(&bucket(2, 0)), "1");
    assert_eq!(star_label(&bucket(7, 0)), "3.5");
    assert_eq!(star_label(&bucket(10, 0)), "5");
}

#[test]
fn build_histogram_bars_normalizes_counts_and_titles_each_bar_with_its_total() {
    let bars = build_histogram_bars(&[bucket(1, 1), bucket(2, 0), bucket(10, 4)]);

    assert_eq!(bars[0].height_pct, 25);
    assert_eq!(bars[1].height_pct, 0, "an empty bucket keeps its column");
    assert_eq!(bars[2].height_pct, 100);
    assert_eq!(bars[0].title, "0.5 \u{2605} \u{00B7} 1 book");
    assert_eq!(bars[1].title, "1 \u{2605} \u{00B7} 0 books");
    assert_eq!(bars[2].title, "5 \u{2605} \u{00B7} 4 books");
}

/// Whether a rendered chunk carries an exact testid — `stats-drill-histogram`
/// is a prefix of `stats-drill-histogram-empty`, so a bare `contains` on the
/// shorter name matches the empty state too.
#[cfg(feature = "server")]
fn has_testid(html: &str, testid: &str) -> bool {
    html.contains(&format!(r#""{testid}""#))
}

#[cfg(feature = "server")]
#[test]
fn render_histogram_shows_the_empty_state_rather_than_ten_flat_bars() {
    // The window carries no ratings. Ten zero-height columns would draw a
    // chart of nothing and read as a real distribution that happens to be
    // flat, so the drill-in says so in words instead.
    let none_rated = (1..=10).map(|h| bucket(h, 0)).collect::<Vec<_>>();
    let html = crate::test_support::render(render_histogram(&none_rated));
    assert!(has_testid(&html, "stats-drill-histogram-empty"), "{html}");
    assert!(!has_testid(&html, "stats-drill-histogram"), "{html}");

    // One rating anywhere is enough to be worth drawing.
    let mut rated = none_rated;
    rated[6] = bucket(7, 1);
    let html = crate::test_support::render(render_histogram(&rated));
    assert!(has_testid(&html, "stats-drill-histogram"), "{html}");
    assert!(!has_testid(&html, "stats-drill-histogram-empty"), "{html}");
}

#[cfg(feature = "server")]
#[test]
fn render_histogram_reuses_the_trend_chart_renderer() {
    // The histogram is the trend strip with a different x-axis. A private copy
    // of the bar markup would drift from it silently, so this pins that both
    // come out of `render_bars`.
    let bars = build_trend_bars(&[("J".to_string(), 1.0)]);
    let trend = crate::test_support::render(render_trend(Metric::AvgRating, &bars));
    let histogram = crate::test_support::render(render_histogram(&[bucket(10, 1)]));

    for class in ["st-drill-trend", "st-drill-trend-col", "st-drill-trend-bar"] {
        assert!(trend.contains(class), "trend missing {class}: {trend}");
        assert!(
            histogram.contains(class),
            "histogram missing {class}: {histogram}"
        );
    }
}

/// A Month summary carrying the two disagreements #2454 reported: a count
/// that fell to zero, and a metric with nothing on either side.
#[cfg(feature = "server")]
fn compared_month() -> StatsSummary {
    StatsSummary {
        range: StatsRange::Month,
        books_finished: 0,
        pages_read: Some(120),
        listening_seconds: 0,
        avg_stars: Some(4.3),
        previous: omnibus_shared::PeriodComparison {
            books_finished: 2,
            pages_read: 100,
            listening_seconds: 0,
            avg_stars: None,
        },
        ..Default::default()
    }
}

#[cfg(feature = "server")]
#[test]
fn render_delta_states_the_tiles_own_comparison_for_every_metric() {
    let summary = compared_month();
    for metric in [
        Metric::Finished,
        Metric::Pages,
        Metric::Listening,
        Metric::AvgRating,
    ] {
        let tile = comparison(metric, &summary).expect("a bounded window compares");
        let html = crate::test_support::render(render_delta(
            comparison(metric, &summary),
            vs_label(summary.range),
        ));
        assert!(html.contains(&tile.label), "{}: {html}", tile.label);
        assert!(html.contains(tile.css_class), "{}: {html}", tile.css_class);
    }
}

#[cfg(feature = "server")]
#[test]
fn render_delta_no_longer_restates_a_count_as_a_percentage() {
    // The tile said "−2 books" while its sheet said "▼100%" (#2454).
    let summary = compared_month();
    let html = crate::test_support::render(render_delta(
        comparison(Metric::Finished, &summary),
        vs_label(summary.range),
    ));
    assert!(html.contains("\u{2212}2"), "{html}");
    assert!(!html.contains('%'), "{html}");

    // And "flat" on the tile was "Not enough data yet to compare" here.
    let html = crate::test_support::render(render_delta(
        comparison(Metric::Listening, &summary),
        vs_label(summary.range),
    ));
    assert!(html.contains("flat"), "{html}");
    assert!(!html.contains("Not enough data"), "{html}");
}

#[cfg(feature = "server")]
#[test]
fn render_delta_falls_back_only_when_there_is_nothing_to_compare() {
    let lifetime = StatsSummary {
        range: StatsRange::AllTime,
        ..compared_month()
    };
    let unrated = StatsSummary {
        avg_stars: None,
        ..compared_month()
    };
    for (metric, summary) in [(Metric::Finished, &lifetime), (Metric::AvgRating, &unrated)] {
        let html = crate::test_support::render(render_delta(
            comparison(metric, summary),
            vs_label(summary.range),
        ));
        assert!(html.contains("Not enough data yet to compare."), "{html}");
    }
}

#[test]
fn vs_label_is_empty_only_for_all_time() {
    assert_eq!(vs_label(StatsRange::Week), "vs last week");
    assert_eq!(vs_label(StatsRange::AllTime), "");
}

#[test]
fn short_month_and_short_day_fall_back_on_malformed_input() {
    assert_eq!(short_month("2026-07"), "J");
    assert_eq!(short_month("garbage"), "?");
    assert_eq!(short_day("2026-07-14"), "14");
    assert_eq!(short_day("garbage"), "?");
}

#[test]
fn rate_value_keeps_a_decimal_only_below_ten_pages_an_hour() {
    // Rounds half away from zero, like `avg_stars_value` — `{:.1}` alone would
    // give 4.2 here on round-half-to-even.
    assert_eq!(rate_value(4.25), "4.3");
    assert_eq!(rate_value(9.94), "9.9");
    // The branch is on the rounded figure: one decimal would read "10.0",
    // which isn't "under ten" however it got there.
    assert_eq!(rate_value(9.96), "10");
    assert_eq!(rate_value(32.4), "32");
    assert_eq!(rate_value(32.6), "33");
}

#[test]
fn finished_book_as_ebook_carries_title_author_and_cover() {
    let book = FinishedBook {
        book_uuid: "u1".to_string(),
        title: "Dune".to_string(),
        author: Some("Frank Herbert".to_string()),
        finished_at: 0,
        finished_at_iso: None,
        cover_url: Some("/api/covers/u1".to_string()),
        rating: Some(4.5),
    };
    let ebook = finished_book_as_ebook(&book);
    assert_eq!(ebook.title.as_deref(), Some("Dune"));
    assert_eq!(ebook.creators[0].name, "Frank Herbert");
    assert_eq!(ebook.unique_identifier.as_deref(), Some("u1"));
    assert_eq!(ebook.cover_url.as_deref(), Some("/api/covers/u1"));
}

#[test]
fn trend_points_for_pages_reads_the_per_day_ledger_series() {
    let mut summary = StatsSummary {
        pages_detail: PagesReadDetail {
            daily: vec![
                TrendPoint {
                    label: "2026-08-03".to_string(),
                    value: 41.0,
                },
                TrendPoint {
                    label: "2026-08-04".to_string(),
                    value: 12.0,
                },
            ],
            ..Default::default()
        },
        ..Default::default()
    };
    summary.pages_read = Some(53);

    let points = trend_points(Metric::Pages, &summary);

    assert_eq!(
        points,
        vec![("03".to_string(), 41.0), ("04".to_string(), 12.0)]
    );
}

#[test]
fn measured_line_singularizes_a_one_book_window() {
    let one = PagesReadDetail {
        measured_books: 1,
        ..Default::default()
    };
    assert_eq!(measured_line(&one), "Across 1 book this period.");
    let many = PagesReadDetail {
        measured_books: 4,
        ..Default::default()
    };
    assert_eq!(measured_line(&many), "Across 4 books this period.");
}

#[test]
fn unmeasured_line_names_the_books_the_total_leaves_out() {
    assert!(unmeasured_line(1, true).starts_with("1 more book has"));
    assert!(unmeasured_line(3, true).starts_with("3 more books have"));
    // Nothing was measured, so the line above it reported no page progress at
    // all — "more" would have no antecedent, and the singular needs "it".
    assert_eq!(
        unmeasured_line(1, false),
        "1 book has no known length yet, so nothing it contributed is counted."
    );
    assert!(unmeasured_line(3, false).starts_with("3 books have"));
    assert!(unmeasured_line(3, false).ends_with("nothing they contributed is counted."));
}

#[test]
fn cutover_line_warns_only_when_the_window_reaches_past_the_epoch() {
    // A Month window starting after the epoch is fully covered, so the date is
    // context; a Lifetime one is partly unmeasurable and has to say so.
    assert_eq!(
        cutover_line("2026-08-01", false),
        "Page tracking began 2026-08-01."
    );
    assert!(cutover_line("2026-08-01", true).contains("only partly covered"));
}

#[test]
fn predates_ledger_follows_the_servers_overlap_answer_not_the_range() {
    assert!(PagesReadDetail {
        since_day: Some("2026-08-01".to_string()),
        window_predates_ledger: true,
        ..Default::default()
    }
    .predates_ledger());
    // A window that opens after the epoch gets the date as context and no
    // caveat, whichever range produced it.
    assert!(!PagesReadDetail {
        since_day: Some("2026-08-01".to_string()),
        ..Default::default()
    }
    .predates_ledger());
    // No epoch recorded, nothing to warn about.
    assert!(!PagesReadDetail::default().predates_ledger());
}
