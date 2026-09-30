//! Metric-tile drill-in: a bottom sheet on mobile, a centered modal on
//! desktop, switched by a CSS media query so the rsx stays identical on
//! every target (rule 07). Shows the metric's vs-previous-period delta —
//! its tile's own comparison, never a second derivation of it — the
//! metric's trend chart, and — per metric — the half-star distribution
//! (Avg rating), the books completed in the window (Finished), or the reading
//! speed plus the coverage-and-cutover note (Pages read), all from the
//! already-fetched `StatsSummary` (no new RPC).

use dioxus::prelude::*;
use omnibus_shared::{
    Contributor, EbookMetadata, FinishedBook, PagesReadDetail, RatingBucket, StatsRange,
    StatsSummary, TrendPoint,
};

use super::donut::LengthRows;
use super::heatmap::month_abbr;
use super::tiles::{avg_stars_value, comparison, Comparison};
use crate::components::{ConfirmModal, CoverTile, CoverTileKind};
use crate::use_server_url;

/// Which headline tile a drill-in sheet/modal is showing detail for.
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Metric {
    Finished,
    AvgRating,
    Listening,
    Pages,
}

impl Metric {
    /// Title shown in the drill-in header.
    fn title(self) -> &'static str {
        match self {
            Metric::Finished => "Finished",
            Metric::AvgRating => "Avg rating",
            Metric::Listening => "Listening",
            Metric::Pages => "Pages read",
        }
    }
}

/// "vs last week/month/year" — empty for Lifetime, which has no previous
/// window to compare against.
fn vs_label(range: StatsRange) -> &'static str {
    match range {
        StatsRange::Week => "vs last week",
        StatsRange::Month => "vs last month",
        StatsRange::Year => "vs last year",
        StatsRange::AllTime => "",
    }
}

/// The direction glyph beside a comparison's label: the tile tints its delta,
/// the sheet draws an arrow.
fn glyph(css_class: &str) -> &'static str {
    match css_class {
        "up" => "\u{25B2}",
        "down" => "\u{25BC}",
        _ => "\u{25CF}",
    }
}

/// One rendered trend bar: a short axis label, the hover title, and a height
/// 0..=100 relative to the series' tallest point. An all-zero series stays all
/// zero.
struct TrendBar {
    label: String,
    /// Hover text. Defaults to the axis label; a caller with something more
    /// useful to say (the histogram's book count) overwrites it.
    title: String,
    height_pct: u32,
    /// The figure printed on the column, so its height reads without hovering.
    value: Option<String>,
    /// Nothing was measured here: drawn as an empty slot, never a stub that
    /// reads as a low value.
    empty: bool,
}

/// Normalize any of the summary's label/value series into bar heights.
fn build_trend_bars(points: &[(String, f64)]) -> Vec<TrendBar> {
    let max = points.iter().map(|(_, v)| *v).fold(0.0_f64, f64::max);
    points
        .iter()
        .map(|(label, value)| TrendBar {
            label: label.clone(),
            title: label.clone(),
            value: None,
            empty: false,
            height_pct: if max <= 0.0 {
                0
            } else {
                // `max` is the series maximum, so the ratio is 0..=1 and the
                // scaled value 0..=100.
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let pct = ((value.max(0.0) / max) * 100.0).round().clamp(0.0, 100.0) as u32;
                pct
            },
        })
        .collect()
}

/// A rating bucket's axis label, in **stars** — "0.5", "1", "1.5" … "5".
/// Ratings are stored as half-stars 1..=10; labelling the raw value would
/// present the chart as a ten-point scale.
fn star_label(bucket: &RatingBucket) -> String {
    let stars = bucket.stars();
    if bucket.half_stars % 2 == 0 {
        format!("{stars:.0}")
    } else {
        format!("{stars:.1}")
    }
}

/// The window's ratings as bars, one per half-star bucket, each carrying its
/// book count. An empty bucket keeps its column as an empty slot — the shape
/// needs every bucket — but draws no bar a reader could take for a small one.
// Display-only heights: bucket counts sit far below f64's 2^52 exact-integer
// range.
#[allow(clippy::cast_precision_loss)]
fn build_histogram_bars(buckets: &[RatingBucket]) -> Vec<TrendBar> {
    let points: Vec<(String, f64)> = buckets
        .iter()
        .map(|b| (star_label(b), b.books as f64))
        .collect();
    let mut bars = build_trend_bars(&points);
    for (bar, bucket) in bars.iter_mut().zip(buckets) {
        let plural = if bucket.books == 1 { "" } else { "s" };
        bar.title = format!(
            "{} \u{2605} \u{00B7} {} book{plural}",
            bar.label, bucket.books
        );
        bar.empty = bucket.books <= 0;
        bar.value = (!bar.empty).then(|| bucket.books.to_string());
    }
    bars
}

/// The Avg rating trend: each month's mean with its figure on the bar, on a
/// fixed five-star scale so a bar's height *is* the rating rather than its
/// share of the best month. A month nobody rated is an empty slot.
fn build_rating_trend_bars(points: &[TrendPoint]) -> Vec<TrendBar> {
    points
        .iter()
        .map(|p| {
            let month = month_year(&p.label).unwrap_or_else(|| p.label.clone());
            // A real mean is at least half a star; the server sends 0.0 for a
            // month with no ratings.
            let empty = p.value <= 0.0;
            let value = (!empty).then(|| avg_stars_value(Some(p.value)));
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let height_pct = ((p.value / 5.0) * 100.0).round().clamp(0.0, 100.0) as u32;
            TrendBar {
                label: short_month(&p.label),
                title: match &value {
                    Some(v) => format!("{month} \u{00B7} {v} \u{2605}"),
                    None => format!("{month} \u{00B7} no ratings"),
                },
                height_pct,
                value,
                empty,
            }
        })
        .collect()
}

/// The metric's trend as drawn bars — the rating trend on its own scale, every
/// other metric scaled to its tallest point.
fn trend_bars(metric: Metric, summary: &StatsSummary) -> Vec<TrendBar> {
    match metric {
        Metric::AvgRating => build_rating_trend_bars(&summary.rating_monthly),
        _ => build_trend_bars(&trend_points(metric, summary)),
    }
}

/// The heading a metric's trend carries, when it needs one to be read: the
/// rating trend sits beside a histogram and covers a different period.
fn trend_title(metric: Metric) -> Option<&'static str> {
    (metric == Metric::AvgRating).then_some("Average rating by month")
}

/// Which period the rating trend covers. It is the trailing twelve months
/// whatever the switcher says, while the delta and the histogram follow it —
/// so it names its span rather than letting a reader assume the window.
fn rating_trend_caption(points: &[TrendPoint]) -> String {
    const TAIL: &str = "last 12 months, whatever period is selected";
    let span = points
        .first()
        .zip(points.last())
        .and_then(|(a, b)| Some((month_year(&a.label)?, month_year(&b.label)?)));
    match span {
        Some((from, to)) => format!("{from} \u{2013} {to} \u{00B7} the {TAIL}"),
        None => format!("The {TAIL}"),
    }
}

/// Which period the rating histogram covers: the one the switcher selected.
fn histogram_caption(range: StatsRange) -> &'static str {
    match range {
        StatsRange::Week => "Rated this week",
        StatsRange::Month => "Rated this month",
        StatsRange::Year => "Rated this year",
        StatsRange::AllTime => "Rated at any time",
    }
}

/// The metric's trend series as `(short label, value)` pairs, drawn from the
/// fields already on `summary` — no metric needs a fresh fetch to drill in.
// Display-only trend values: counts and seconds sit far below f64's 2^52
// exact-integer range.
#[allow(clippy::cast_precision_loss)]
fn trend_points(metric: Metric, summary: &StatsSummary) -> Vec<(String, f64)> {
    match metric {
        Metric::Finished => summary
            .books_per_month
            .iter()
            .map(|m| (short_month(&m.month), m.books as f64))
            .collect(),
        Metric::AvgRating => summary
            .rating_monthly
            .iter()
            .map(|p| (short_month(&p.label), p.value))
            .collect(),
        Metric::Listening => summary
            .listening_daily
            .iter()
            .map(|d| (short_day(&d.day), d.seconds as f64 / 60.0))
            .collect(),
        Metric::Pages => summary
            .pages_detail
            .daily
            .iter()
            .map(|p| (short_day(&p.label), p.value))
            .collect(),
    }
}

/// `(year, month)` of a `YYYY-MM` month, `None` when malformed.
fn year_month(month: &str) -> Option<(i64, i64)> {
    let (y, m) = month.split_once('-')?;
    let m = m.parse::<i64>().ok().filter(|m| (1..=12).contains(m))?;
    Some((y.parse().ok()?, m))
}

/// Three-letter name of a `YYYY-MM` month, `?` when malformed. Never an
/// initial: June and July would share "J" side by side.
fn short_month(month: &str) -> String {
    year_month(month).map_or_else(|| "?".to_string(), |(_, m)| month_abbr(m).to_string())
}

/// "Oct 2025" for a `YYYY-MM` month, `None` when malformed.
fn month_year(month: &str) -> Option<String> {
    year_month(month).map(|(y, m)| format!("{} {y}", month_abbr(m)))
}

/// Day-of-month for a `YYYY-MM-DD` day, `?` when malformed.
fn short_day(day: &str) -> String {
    day.rsplit('-')
        .next()
        .filter(|_| day.contains('-'))
        .and_then(|d| d.parse::<usize>().ok())
        .filter(|d| (1..=31).contains(d))
        .map(|d| format!("{d:02}"))
        .unwrap_or_else(|| "?".to_string())
}

/// Build a minimal `EbookMetadata` from a `FinishedBook` row so the drill-in
/// list can hand it to the shared `CoverTile` — the DTO only carries the
/// handful of fields a cover + title row needs.
pub(super) fn finished_book_as_ebook(book: &FinishedBook) -> EbookMetadata {
    EbookMetadata {
        title: Some(book.title.clone()),
        filename: book.title.clone(),
        creators: book
            .author
            .clone()
            .map(|name| {
                vec![Contributor {
                    name,
                    role: None,
                    file_as: None,
                    id: None,
                }]
            })
            .unwrap_or_default(),
        unique_identifier: Some(book.book_uuid.clone()),
        cover_url: book.cover_url.clone(),
        ..Default::default()
    }
}

/// The drill-in sheet/modal: header + close, delta chip, trend chart, and
/// (Finished only) the finished-books list. `expanded` closes on backdrop
/// click, Escape, or the close button. Built on the shared `ConfirmModal`
/// shell (see
/// `components::confirm_modal`) — `busy: false` since no mutation is ever
/// in flight here, the grabber + title/close head go in the `head` slot,
/// and `backdrop_class`/`dialog_class` keep this sheet's own bottom-sheet
/// (mobile) / centered-modal (desktop) chrome rather than the default
/// author-photo backdrop.
#[component]
pub(super) fn DrillIn(
    metric: Metric,
    summary: StatsSummary,
    expanded: Signal<Option<Metric>>,
) -> Element {
    let server_url = use_server_url();
    // Both off the summary, so the caption names the window the delta was
    // measured on even if the switcher has already moved.
    let delta = comparison(metric, &summary);
    let vs = vs_label(summary.range);
    let bars = trend_bars(metric, &summary);

    rsx! {
        ConfirmModal {
            testid: "stats-drill-in".to_string(),
            aria_label: "{metric.title()} detail",
            backdrop_class: "st-drill-scrim".to_string(),
            dialog_class: "st-drill-sheet".to_string(),
            busy: false,
            // The sheet is opened from a tile outside it, so nothing inside
            // holds focus — without this Escape would never reach the shell's
            // key handler (#2465).
            focus_on_open: true,
            on_dismiss: move |_| expanded.set(None),
            head: rsx! {
                div { class: "st-drill-grabber" }
                div { class: "st-drill-head",
                    h4 { "{metric.title()}" }
                    button {
                        class: "st-drill-close",
                        "data-testid": "stats-drill-close",
                        r#type: "button",
                        "aria-label": "Close",
                        onclick: move |_| expanded.set(None),
                        "\u{2715}"
                    }
                }
            },
            div { class: "st-drill-body",
                {render_delta(delta, vs)}
                if let Some(title) = trend_title(metric).filter(|_| !bars.is_empty()) {
                    {render_section_head(title, &rating_trend_caption(&summary.rating_monthly), "stats-drill-trend-caption")}
                }
                {render_trend(metric, &bars)}
                if metric == Metric::AvgRating {
                    {render_histogram(&summary.rating_histogram, summary.range)}
                }
                if metric == Metric::Pages {
                    {render_pages_rate(summary.pages_per_hour)}
                    {render_pages_note(&summary.pages_detail, summary.pages_read)}
                }
                if metric == Metric::Finished {
                    // The length distribution is a fact *about* the books
                    // finished, not a peer of the count, so it lives here
                    // rather than as a card of its own beside the tile.
                    div { class: "label st-drill-section-label", "How long they were" }
                    LengthRows { summary: summary.clone() }
                    {render_finished_list(&summary.finished_books, summary.books_finished, &server_url)}
                }
            }
        }
    }
}

/// The delta chip, or a friendly "not enough data" line when there's nothing
/// to compare (no rated books, or the Lifetime range with no previous window).
fn render_delta(delta: Option<Comparison>, vs: &str) -> Element {
    match delta {
        Some(d) => rsx! {
            div {
                class: "st-drill-delta {d.css_class}",
                "data-testid": "stats-drill-delta",
                span { aria_hidden: "true", {glyph(d.css_class)} }
                " {d.label} "
                if !vs.is_empty() {
                    span { class: "mono st-drill-delta-vs", "{vs}" }
                }
            }
        },
        None => rsx! {
            p { class: "st-drill-delta-empty", "data-testid": "stats-drill-delta",
                "Not enough data yet to compare."
            }
        },
    }
}

/// The shared pure-CSS bar strip: one normalized column per point, with its
/// axis label beneath. Both the metric trend and the rating histogram render
/// through this — the histogram is the same widget with a different x-axis, so
/// a second bar renderer would only be a second thing to keep in sync.
fn render_bars(bars: &[TrendBar], testid: &str, aria_label: &str) -> Element {
    let valued = bars.iter().any(|b| b.value.is_some());
    rsx! {
        div {
            class: if valued { "st-drill-trend st-drill-trend-valued" } else { "st-drill-trend" },
            "data-testid": "{testid}",
            role: "img",
            aria_label: "{aria_label}",
            for (i, bar) in bars.iter().enumerate() {
                div { key: "{i}-{bar.label}", class: "st-drill-trend-col", title: "{bar.title}",
                    div { class: "st-drill-trend-track",
                        // One element either way, so an empty slot and a bar
                        // swap a class rather than a node (rule 07).
                        div {
                            class: if bar.empty { "st-drill-trend-slot" } else { "st-drill-trend-bar" },
                            "data-testid": if bar.empty { "stats-drill-bar-empty" } else { "stats-drill-bar" },
                            style: if bar.empty { String::new() } else { format!("height: {}%;", bar.height_pct) },
                            if let Some(value) = &bar.value {
                                span {
                                    class: "st-drill-trend-value mono",
                                    "data-testid": "stats-drill-bar-value",
                                    "{value}"
                                }
                            }
                        }
                    }
                    div {
                        class: "st-drill-trend-label mono",
                        "data-testid": "stats-drill-bar-label",
                        "{bar.label}"
                    }
                }
            }
        }
    }
}

/// The metric's trend chart — pure-CSS bar columns. An empty series renders
/// nothing rather than an empty frame; the Pages note below it is what explains
/// why a window has no bars.
fn render_trend(metric: Metric, bars: &[TrendBar]) -> Element {
    if bars.is_empty() {
        return rsx! { div {} };
    }
    let aria =
        trend_title(metric).map_or_else(|| format!("{} trend", metric.title()), String::from);
    render_bars(bars, "stats-drill-trend", &aria)
}

/// A chart's heading and, beneath it, the period it covers.
fn render_section_head(title: &str, caption: &str, testid: &str) -> Element {
    rsx! {
        div { class: "label st-drill-section-label", "{title}" }
        p { class: "st-drill-caption", "data-testid": "{testid}", "{caption}" }
    }
}

/// A reading rate for display: one decimal under ten pages an hour, whole
/// pages above it. Nobody reads at 32.4 pages an hour reproducibly, and the
/// decimal would dress an estimate as a measurement.
///
/// The branch tests the **rounded** figure, not the raw one: 9.96 at one
/// decimal is "10.0", which is not "under ten" however it got there.
fn rate_value(rate: f64) -> String {
    let one_decimal = (rate * 10.0).round() / 10.0;
    if one_decimal < 10.0 {
        format!("{one_decimal:.1}")
    } else {
        format!("{:.0}", rate.round())
    }
}

/// The Pages drill-in's reading-speed line — the rate the tile's total is
/// missing, and the number a reader actually compares against their own past.
///
/// Absent rather than zeroed when there's nothing to divide: "0 pages per
/// hour" is a claim about how this reader reads, and no finished book carrying
/// both a resolvable length and recorded time is not that claim. The empty
/// copy names **both** halves, since either one missing produces it.
fn render_pages_rate(rate: Option<f64>) -> Element {
    let Some(rate) = rate else {
        return rsx! {
            p { class: "st-drill-delta-empty", "data-testid": "stats-drill-pages-rate",
                "No book finished in this window has both a measurable length and recorded reading time yet."
            }
        };
    };
    rsx! {
        div { class: "label st-drill-section-label", "Reading speed" }
        p { class: "st-drill-rate", "data-testid": "stats-drill-pages-rate",
            span { class: "st-drill-rate-value", {rate_value(rate)} }
            " est. pages an hour"
        }
        p { class: "st-drill-rate-note",
            "Estimated from the books you finished in this window and every hour you spent reading them. Listening time isn\u{2019}t counted, so a book you partly heard reads faster here than you read it."
        }
    }
}

/// The Avg rating drill-in's distribution: how many books landed in each
/// half-star bucket. The mean above it can't tell a reader who rates
/// everything 4 from one who splits evenly between 2 and 5 — this can.
fn render_histogram(buckets: &[RatingBucket], range: StatsRange) -> Element {
    if buckets.iter().all(|b| b.books == 0) {
        return rsx! {
            p { class: "st-drill-delta-empty", "data-testid": "stats-drill-histogram-empty",
                "No ratings in this window yet."
            }
        };
    }
    rsx! {
        {render_section_head("Books at each rating", histogram_caption(range), "stats-drill-histogram-caption")}
        {render_bars(&build_histogram_bars(buckets), "stats-drill-histogram", "Star rating distribution")}
    }
}

/// The "what you finished" rail: cover (via `CoverTile`) + title + rating
/// per book completed in the window. The server caps the list at its newest
/// N completions while `total` is the uncapped count, so a truncated rail
/// labels itself instead of silently posing as exhaustive.
fn render_finished_list(books: &[FinishedBook], total: i64, server_url: &str) -> Element {
    if books.is_empty() {
        return rsx! {
            p { class: "st-drill-delta-empty", "No books finished in this window." }
        };
    }
    let shown = books.len() as i64;
    rsx! {
        ul { class: "st-drill-finished-list", "data-testid": "stats-drill-finished-list",
            for book in books {
                {render_finished_row(book, server_url)}
            }
        }
        if total > shown {
            p { class: "st-drill-delta-empty", "Showing the latest {shown} of {total} finished books." }
        }
    }
}

fn render_finished_row(book: &FinishedBook, server_url: &str) -> Element {
    let ebook = finished_book_as_ebook(book);
    let rating_label = match book.rating {
        Some(r) => format!("{r:.1} \u{2605}"),
        None => "\u{2014}".to_string(),
    };
    rsx! {
        li { key: "{book.book_uuid}", class: "st-drill-finished-row",
            div { class: "st-drill-finished-cover",
                CoverTile {
                    book: ebook,
                    server_url: server_url.to_string(),
                    sizes: "40px".to_string(),
                    kind: CoverTileKind::ReadOnly,
                }
            }
            div { class: "st-drill-finished-body",
                div { class: "st-drill-finished-title", "{book.title}" }
                if let Some(author) = &book.author {
                    div { class: "mono st-drill-finished-author", "{author}" }
                }
            }
            div { class: "st-drill-finished-rating mono", "{rating_label}" }
        }
    }
}

/// The Pages read drill-in's prose: what the window covered, what it could not
/// measure, and the date before which it cannot measure anything.
///
/// Every line here exists because the headline number is one figure standing in
/// for several different situations. Silence about the cutover in particular
/// would leave a Lifetime total that quietly excludes years of reading looking
/// like a Lifetime total.
fn render_pages_note(detail: &PagesReadDetail, pages_read: Option<i64>) -> Element {
    rsx! {
        div { class: "st-drill-pages-note", "data-testid": "stats-drill-pages-note",
            if detail.audio_only() {
                p { class: "st-drill-delta-empty",
                    "Only audiobooks this period \u{2014} listening turns no pages."
                }
            } else if pages_read.is_none() {
                p { class: "st-drill-delta-empty",
                    "No page progress recorded in this period yet."
                }
            } else {
                p { class: "st-drill-delta-empty", {measured_line(detail)} }
            }
            if detail.unmeasured_books > 0 {
                p { class: "st-drill-delta-empty", {unmeasured_line(detail.unmeasured_books, detail.measured_books > 0)} }
            }
            if let Some(since) = &detail.since_day {
                p {
                    class: "st-drill-delta-empty",
                    "data-testid": "stats-drill-pages-cutover",
                    {cutover_line(since, detail.predates_ledger())}
                }
            }
        }
    }
}

/// "Across N books this period." — the population behind the headline.
fn measured_line(detail: &PagesReadDetail) -> String {
    let n = detail.measured_books;
    let plural = if n == 1 { "" } else { "s" };
    format!("Across {n} book{plural} this period.")
}

/// The books whose length nothing on the ladder resolves. Named rather than
/// absorbed: they were read, and the total does not include them.
fn unmeasured_line(n: i64, any_measured: bool) -> String {
    let (plural, verb, pronoun) = if n == 1 {
        ("", "has", "it")
    } else {
        ("s", "have", "they")
    };
    // "more" only reads as English when a count came before it. When nothing
    // was measured, the line above says so and this one is the whole story.
    let more = if any_measured { "more " } else { "" };
    format!(
        "{n} {more}book{plural} {verb} no known length yet, so nothing {pronoun} contributed is counted."
    )
}

/// The cutover sentence. Page progress is differenced from stored positions,
/// and no such trail exists before the ledger began, so reading before that day
/// is unrecoverable rather than merely missing.
fn cutover_line(since: &str, overlaps: bool) -> String {
    if overlaps {
        format!("Page tracking began {since}; reading before then can\u{2019}t be counted, so this period is only partly covered.")
    } else {
        format!("Page tracking began {since}.")
    }
}

#[cfg(test)]
mod tests;
