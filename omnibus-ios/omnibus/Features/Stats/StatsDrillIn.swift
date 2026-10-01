//  StatsDrillIn.swift
//  Metric-tile drill-in: the sheet a windowed tile opens. The same detail the
//  web tiles expand to (`frontend/src/pages/stats/drill_in.rs`) — the
//  tile's own vs-previous-window delta, the metric's trend, and per metric
//  the half-star distribution (Avg rating), the reading speed and coverage
//  note (Pages read), or the length distribution and the books completed
//  (Finished) — all read off the `StatsSummary` already on screen. No second
//  fetch.

import SwiftUI

/// Which windowed tile a drill-in is showing detail for. Mirrors the web
/// `Metric`; the raw value is the sheet's identity for `.sheet(item:)`.
enum DrillMetric: String, Identifiable, CaseIterable, Sendable {
    case finished
    case pages
    case listening
    case avgRating

    var id: String { rawValue }

    /// The sheet's title — the tile's own name, so the two read as one thing.
    var title: String {
        switch self {
        case .finished: "Finished"
        case .pages: "Pages read"
        case .listening: "Listening"
        case .avgRating: "Avg rating"
        }
    }
}

/// A formatted vs-previous-window delta: which way it went and by how much.
/// One per metric, stated by both its tile and its drill-in.
struct DrillDelta: Equatable, Sendable {
    enum Direction: Sendable { case up, down, flat }

    let direction: Direction
    let label: String

    var glyph: String {
        switch direction {
        case .up: "\u{25B2}"
        case .down: "\u{25BC}"
        case .flat: "\u{25CF}"
        }
    }
}

/// One trend column: its axis label, its hover-equivalent title, and its
/// height as a fraction of the series' tallest point. An all-zero series is
/// all zero.
struct TrendBar: Identifiable, Equatable, Sendable {
    let index: Int
    let label: String
    let title: String
    let fraction: Double
    /// The figure printed on the column, so its height reads without a tap.
    var value: String? = nil
    /// Nothing was measured here: an empty slot, never a stub that reads as a
    /// low value.
    var isEmpty = false

    var id: Int { index }
}

/// The drill-in's derivations, kept off the view so they can be pinned by the
/// unit suite. Every function mirrors its namesake in the web drill-in; a
/// reader switching surfaces must read the same delta and the same bars.
enum StatsDrill {
    // MARK: - Delta

    /// "vs last week/month/year" — `nil` for Lifetime, which has no previous
    /// window to compare against.
    static func vsLabel(_ range: StatsRange) -> String? {
        switch range {
        case .week: "vs last week"
        case .month: "vs last month"
        case .year: "vs last year"
        case .allTime: nil
        }
    }

    /// A count delta in whole units — "+2", "−1", "flat". Mirrors the web
    /// `count_comparison`: over a handful of books a percentage is noise. The
    /// minus is a real minus sign, not a hyphen: at Space Mono's weight the
    /// hyphen reads as a dash in a number.
    static func countDelta(current: Int64, previous: Int64) -> DrillDelta {
        let change = current - previous
        if change == 0 { return DrillDelta(direction: .flat, label: "flat") }
        return change > 0
            ? DrillDelta(direction: .up, label: "+\(change)")
            : DrillDelta(direction: .down, label: "\u{2212}\(-change)")
    }

    /// A magnitude delta as a percentage — "+18%", "flat", or "new" when the
    /// previous window recorded none of it. Mirrors the web
    /// `percent_comparison`.
    static func percentDelta(current: Double, previous: Double) -> DrillDelta {
        if previous <= 0 {
            return current > 0
                ? DrillDelta(direction: .up, label: "new")
                : DrillDelta(direction: .flat, label: "flat")
        }
        let change = (current - previous) / previous * 100
        if change.magnitude < 0.5 {
            return DrillDelta(direction: .flat, label: "flat")
        }
        let pct = Int(min(change.magnitude.rounded(), Double(Int32.max)))
        return change > 0
            ? DrillDelta(direction: .up, label: "+\(pct)%")
            : DrillDelta(direction: .down, label: "\u{2212}\(pct)%")
    }

    /// A star delta in stars — "+0.3", "flat", or "new" for a first rated
    /// window. `nil` when this window rated nothing: a mean over nothing is not
    /// zero, it is absent. Mirrors the web `stars_comparison`.
    static func starsDelta(current: Double?, previous: Double?) -> DrillDelta? {
        guard let current else { return nil }
        guard let previous else { return DrillDelta(direction: .up, label: "new") }
        let change = current - previous
        if change.magnitude < 0.05 {
            return DrillDelta(direction: .flat, label: "flat")
        }
        let stars = String(format: "%.1f", change.magnitude)
        return change > 0
            ? DrillDelta(direction: .up, label: "+\(stars)")
            : DrillDelta(direction: .down, label: "\u{2212}\(stars)")
    }

    /// The metric's delta against the same slice of the previous window — the
    /// one value its tile and its drill-in both show, so they cannot disagree.
    /// `nil` on Lifetime outright — `previous` is zeroed there rather than
    /// measured, and a delta drawn against it would report every lifetime
    /// figure as brand new.
    static func delta(for metric: DrillMetric, in summary: StatsSummary) -> DrillDelta? {
        guard summary.range != .allTime else { return nil }
        let previous = summary.previous
        switch metric {
        case .finished:
            return countDelta(current: summary.booksFinished, previous: previous.booksFinished)
        case .avgRating:
            return starsDelta(current: summary.avgStars, previous: previous.avgStars)
        case .listening:
            return percentDelta(
                current: Double(summary.listeningSeconds),
                previous: Double(previous.listeningSeconds))
        case .pages:
            return percentDelta(
                current: Double(summary.pagesRead ?? 0), previous: Double(previous.pagesRead))
        }
    }

    // MARK: - Trend

    /// The metric's trend series as bars, drawn from the fields already on the
    /// summary — no metric needs a fresh fetch to drill in.
    static func trendBars(for metric: DrillMetric, in summary: StatsSummary) -> [TrendBar] {
        if metric == .avgRating { return ratingTrendBars(summary.ratingMonthly) }
        let points: [(label: String, value: Double)] =
            switch metric {
            case .finished:
                summary.booksPerMonth.map { (shortMonth($0.month), Double($0.books)) }
            case .avgRating:
                []
            case .listening:
                summary.listeningDaily.map { (shortDay($0.day), Double($0.seconds) / 60) }
            case .pages:
                summary.pagesDetail.daily.map { (shortDay($0.label), $0.value) }
            }
        return bars(points)
    }

    /// The Avg rating trend: each month's mean with its figure on the bar, on
    /// a fixed five-star scale so a bar's height *is* the rating rather than
    /// its share of the best month. A month nobody rated is an empty slot.
    /// Mirrors the web `build_rating_trend_bars`.
    static func ratingTrendBars(_ points: [TrendPoint]) -> [TrendBar] {
        points.enumerated().map { index, point in
            let month = monthYear(point.label) ?? point.label
            // A real mean is at least half a star; the server sends 0 for a
            // month with no ratings.
            let isEmpty = point.value <= 0
            let value = isEmpty ? nil : starsValue(point.value)
            return TrendBar(
                index: index,
                label: shortMonth(point.label),
                title: value.map { "\(month) \u{00B7} \($0) \u{2605}" } ?? "\(month) \u{00B7} no ratings",
                fraction: min(1, max(0, point.value / 5)),
                value: value,
                isEmpty: isEmpty
            )
        }
    }

    /// One-decimal star mean, rounded half away from zero like the web
    /// `avg_stars_value` — `%.1f` alone would show 4.25 as 4.2.
    static func starsValue(_ stars: Double) -> String {
        String(format: "%.1f", (stars * 10).rounded() / 10)
    }

    /// The heading a metric's trend carries, when it needs one to be read:
    /// the rating trend sits beside a histogram and covers a different period.
    static func trendTitle(_ metric: DrillMetric) -> String? {
        metric == .avgRating ? "Average rating by month" : nil
    }

    /// Which period the rating trend covers. It is the trailing twelve months
    /// whatever the switcher says, while the delta and the histogram follow
    /// it — so it names its span. Mirrors the web `rating_trend_caption`.
    static func ratingTrendCaption(_ points: [TrendPoint]) -> String {
        let tail = "last 12 months, whatever period is selected"
        guard let first = points.first.flatMap({ monthYear($0.label) }),
            let last = points.last.flatMap({ monthYear($0.label) })
        else { return "The \(tail)" }
        return "\(first) \u{2013} \(last) \u{00B7} the \(tail)"
    }

    /// Which period the rating histogram covers: the one the switcher
    /// selected. Mirrors the web `histogram_caption`.
    static func histogramCaption(_ range: StatsRange) -> String {
        switch range {
        case .week: "Rated this week"
        case .month: "Rated this month"
        case .year: "Rated this year"
        case .allTime: "Rated at any time"
        }
    }

    /// Normalize any label/value series into bar heights. The title defaults
    /// to the label; a caller with more to say (the histogram's book count)
    /// overwrites it.
    static func bars(_ points: [(label: String, value: Double)]) -> [TrendBar] {
        let maximum = points.map(\.value).max() ?? 0
        return points.enumerated().map { index, point in
            TrendBar(
                index: index,
                label: point.label,
                title: point.label,
                fraction: maximum > 0 ? min(1, max(0, point.value) / maximum) : 0
            )
        }
    }

    /// The window's ratings as bars, one per half-star bucket, each carrying
    /// its book count. An empty bucket keeps its column as an empty slot. Empty
    /// outright when the window carries no ratings at all, so the caller
    /// renders its empty state rather than ten flat bars.
    static func histogramBars(_ buckets: [RatingBucket]) -> [TrendBar] {
        guard buckets.contains(where: { $0.books > 0 }) else { return [] }
        let base = bars(buckets.map { ($0.starLabel, Double($0.books)) })
        return zip(base, buckets).map { bar, bucket in
            TrendBar(
                index: bar.index,
                label: bar.label,
                title: "\(bar.label) \u{2605} \u{00B7} \(StatsFormat.counted(bucket.books, "book"))",
                fraction: bar.fraction,
                value: bucket.books > 0 ? String(bucket.books) : nil,
                isEmpty: bucket.books <= 0
            )
        }
    }

    private static let monthAbbreviations = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]

    /// `(year, month)` of a `YYYY-MM` month, `nil` when malformed.
    private static func yearMonth(_ month: String) -> (year: Int, month: Int)? {
        let parts = month.split(separator: "-")
        guard parts.count == 2, let year = Int(parts[0]), let index = Int(parts[1]),
            (1...12).contains(index)
        else { return nil }
        return (year, index)
    }

    /// Three-letter name of a `YYYY-MM` month, `?` when malformed. Never an
    /// initial: June and July would share "J" side by side.
    static func shortMonth(_ month: String) -> String {
        guard let parsed = yearMonth(month) else { return "?" }
        return monthAbbreviations[parsed.month - 1]
    }

    /// "Oct 2025" for a `YYYY-MM` month, `nil` when malformed.
    static func monthYear(_ month: String) -> String? {
        guard let parsed = yearMonth(month) else { return nil }
        return "\(monthAbbreviations[parsed.month - 1]) \(parsed.year)"
    }

    /// Day-of-month of a `YYYY-MM-DD` day, zero-padded, `?` when malformed.
    static func shortDay(_ day: String) -> String {
        guard day.contains("-"), let last = day.split(separator: "-").last,
            let index = Int(last), (1...31).contains(index)
        else { return "?" }
        return String(format: "%02d", index)
    }

    /// Which columns carry an axis label. Every one of them up to a dozen;
    /// past that every n-th, so a month of days doesn't set thirty-one
    /// two-digit labels into a phone's width.
    static func labelStep(for count: Int) -> Int {
        max(1, Int((Double(count) / 12).rounded(.up)))
    }

    // MARK: - Pages copy

    /// The Pages drill-in's prose, in order: what the window covered, what it
    /// could not measure, and the day before which it cannot measure anything.
    ///
    /// Every line exists because the headline number is one figure standing
    /// in for several situations. Silence about the cutover in particular
    /// would leave a Lifetime total that quietly excludes years of reading
    /// looking like a Lifetime total.
    static func pagesNoteLines(_ summary: StatsSummary) -> [String] {
        let detail = summary.pagesDetail
        var lines: [String] = []
        if detail.audioOnly {
            lines.append("Only audiobooks this period \u{2014} listening turns no pages.")
        } else if summary.pagesRead == nil {
            lines.append("No page progress recorded in this period yet.")
        } else {
            lines.append(measuredLine(detail))
        }
        if detail.unmeasuredBooks > 0 {
            lines.append(unmeasuredLine(detail.unmeasuredBooks, anyMeasured: detail.measuredBooks > 0))
        }
        if let since = detail.sinceDay {
            lines.append(cutoverLine(since: since, overlaps: detail.predatesLedger))
        }
        return lines
    }

    /// "Across N books this period." — the population behind the headline.
    static func measuredLine(_ detail: PagesReadDetail) -> String {
        "Across \(StatsFormat.counted(detail.measuredBooks, "book")) this period."
    }

    /// The books whose length nothing on the ladder resolves. Named rather
    /// than absorbed: they were read, and the total does not include them.
    static func unmeasuredLine(_ n: Int64, anyMeasured: Bool) -> String {
        let (plural, verb, pronoun) = n == 1 ? ("", "has", "it") : ("s", "have", "they")
        // "more" only reads as English when a count came before it.
        let more = anyMeasured ? "more " : ""
        return "\(n) \(more)book\(plural) \(verb) no known length yet, so nothing \(pronoun) contributed is counted."
    }

    /// The cutover sentence. Page progress is differenced from stored
    /// positions and no such trail exists before the ledger began, so reading
    /// before that day is unrecoverable rather than merely missing.
    static func cutoverLine(since: String, overlaps: Bool) -> String {
        overlaps
            ? "Page tracking began \(since); reading before then can\u{2019}t be counted, so this period is only partly covered."
            : "Page tracking began \(since)."
    }

    /// The Pages drill-in's reading-speed line, or the empty copy when there
    /// is nothing to divide. Absent rather than zeroed: "0 pages per hour" is
    /// a claim about how this reader reads, and no finished book carrying both
    /// a resolvable length and recorded time is not that claim.
    static let noRateCopy =
        "No book finished in this window has both a measurable length and recorded reading time yet."

    static let rateNote =
        "Estimated from the books you finished in this window and every hour you spent reading them. Listening time isn\u{2019}t counted, so a book you partly heard reads faster here than you read it."

    // MARK: - Finished copy

    /// The truncation note under the finished list, or `nil` when the list is
    /// the whole story. The server caps the list at its newest completions
    /// while `total` is the uncapped count, so a cut list labels itself
    /// instead of posing as exhaustive.
    static func finishedTruncationNote(shown: Int, total: Int64) -> String? {
        guard total > Int64(shown) else { return nil }
        return "Showing the latest \(shown) of \(total) finished books."
    }
}

// MARK: - The sheet

/// The drill-in sheet: title and Done in the bar, then the delta, the trend,
/// and the metric's own sections beneath.
struct StatsDrillInSheet: View {
    let metric: DrillMetric
    let summary: StatsSummary
    /// Where a finished-book row goes. The sheet closes itself first; the
    /// caller pushes the book onto the tab's own stack, so the detail opens
    /// under the sheet rather than inside it.
    let openBook: (String) -> Void

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    deltaRow
                    trend
                    switch metric {
                    case .avgRating:
                        histogram
                    case .pages:
                        pagesRate
                        pagesNote
                    case .finished:
                        lengths
                        finishedList
                    case .listening:
                        EmptyView()
                    }
                }
                .screenPadding()
                .padding(.top, Spacing.md)
                .padding(.bottom, 32)
            }
            .scrollIndicators(.hidden)
            .background(ScreenBackground())
            .navigationTitle(metric.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .tint(palette.accentColor)
    }

    // MARK: Delta

    /// The delta chip, or a friendly "not enough data" line when there is no
    /// baseline — a fresh metric, or Lifetime with no previous window.
    @ViewBuilder
    private var deltaRow: some View {
        if let delta = StatsDrill.delta(for: metric, in: summary) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Text(delta.glyph)
                    .font(.system(size: 10))
                    .accessibilityHidden(true)
                Text(delta.label)
                    .font(.display(22, weight: .semibold))
                if let vs = StatsDrill.vsLabel(summary.range) {
                    Text(vs)
                        .font(.monoUI(10.5))
                        .foregroundStyle(palette.ink3Color)
                }
            }
            .foregroundStyle(deltaColor(delta.direction))
            .accessibilityElement(children: .combine)
        } else {
            quiet("Not enough data yet to compare.")
        }
    }

    private func deltaColor(_ direction: DrillDelta.Direction) -> Color {
        switch direction {
        case .up: palette.accentColor
        case .down: palette.ink1Color
        case .flat: palette.ink2Color
        }
    }

    // MARK: Trend

    /// The metric's trend. An empty series renders nothing rather than an
    /// empty frame; the Pages note below is what explains why a window has no
    /// bars.
    @ViewBuilder
    private var trend: some View {
        let bars = StatsDrill.trendBars(for: metric, in: summary)
        if !bars.isEmpty {
            if let title = StatsDrill.trendTitle(metric) {
                section(title) {
                    quiet(StatsDrill.ratingTrendCaption(summary.ratingMonthly))
                    TrendStrip(bars: bars, accessibilityLabel: title)
                }
            } else {
                TrendStrip(bars: bars, accessibilityLabel: "\(metric.title) trend")
            }
        }
    }

    // MARK: Avg rating

    /// How many books landed in each half-star bucket. The mean above can't
    /// tell a reader who rates everything 4 from one who splits evenly between
    /// 2 and 5 — this can.
    @ViewBuilder
    private var histogram: some View {
        let bars = StatsDrill.histogramBars(summary.ratingHistogram)
        if bars.isEmpty {
            quiet("No ratings in this window yet.")
        } else {
            section("Books at each rating") {
                quiet(StatsDrill.histogramCaption(summary.range))
                TrendStrip(bars: bars, accessibilityLabel: "Star rating distribution")
            }
        }
    }

    // MARK: Pages

    @ViewBuilder
    private var pagesRate: some View {
        if let rate = summary.pagesPerHour {
            section("Reading speed") {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(StatsView.rateValue(rate))
                        .font(.display(30, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                    Text("est. pages an hour")
                        .font(.ui(12.5))
                        .foregroundStyle(palette.ink2Color)
                }
                .accessibilityElement(children: .combine)
                Text(StatsDrill.rateNote)
                    .font(.ui(11))
                    .foregroundStyle(palette.ink3Color)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            quiet(StatsDrill.noRateCopy)
        }
    }

    private var pagesNote: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ForEach(StatsDrill.pagesNoteLines(summary), id: \.self) { line in
                quiet(line)
            }
        }
    }

    // MARK: Finished

    /// The length distribution is a fact *about* the books finished, not a
    /// peer of the count, so it lives here rather than as a card beside the
    /// tile.
    @ViewBuilder
    private var lengths: some View {
        if summary.lengthBuckets.contains(where: { $0.books > 0 }) {
            section("How long they were") {
                LengthBucketsChart(buckets: summary.lengthBuckets)
            }
        }
    }

    @ViewBuilder
    private var finishedList: some View {
        if summary.finishedBooks.isEmpty {
            quiet("No books finished in this window.")
        } else {
            section("What you finished") {
                VStack(spacing: 0) {
                    ForEach(Array(summary.finishedBooks.enumerated()), id: \.element.id) {
                        index, book in
                        Button {
                            dismiss()
                            openBook(book.bookUUID)
                        } label: {
                            FinishedRow(book: book, isFirst: index == 0)
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                if let note = StatsDrill.finishedTruncationNote(
                    shown: summary.finishedBooks.count, total: summary.booksFinished)
                {
                    quiet(note)
                }
            }
        }
    }

    // MARK: Chrome

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            StatsSectionLabel(title)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// A line of quiet prose — every empty state and disclosure here.
    private func quiet(_ text: String) -> some View {
        Text(text)
            .font(.ui(12.5))
            .foregroundStyle(palette.ink3Color)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// One finished book: cover, title and author, the rating at the trailing
/// edge.
private struct FinishedRow: View {
    let book: FinishedBook
    let isFirst: Bool

    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 0) {
            if !isFirst { Hairline() }
            HStack(spacing: Spacing.md) {
                BookCover(
                    identity: CoverIdentity(
                        uuid: book.bookUUID,
                        title: book.title,
                        author: book.author,
                        hasCover: book.coverURL != nil
                    ),
                    size: .sm,
                    cornerRadius: 3
                )
                .frame(width: 34)

                VStack(alignment: .leading, spacing: 3) {
                    Text(book.title)
                        .font(.ui(13.5, weight: .medium))
                        .foregroundStyle(palette.ink0Color)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if let author = book.author {
                        Text(author)
                            .font(.monoUI(10.5))
                            .foregroundStyle(palette.ink3Color)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: Spacing.sm)
                Text(book.rating.map { String(format: "%.1f \u{2605}", $0) } ?? "\u{2014}")
                    .font(.monoUI(11))
                    .foregroundStyle(palette.ink2Color)
                    .layoutPriority(1)
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .accessibilityElement(children: .combine)
    }
}

/// The shared bar strip: one normalized column per point with its axis label
/// beneath. Both the metric trend and the rating histogram render through
/// this — the histogram is the same widget with a different x-axis, so a
/// second bar renderer would only be a second thing to keep in sync.
struct TrendStrip: View {
    let bars: [TrendBar]
    let accessibilityLabel: String
    var height: CGFloat = 96

    @Environment(\.palette) private var palette

    var body: some View {
        let step = StatsDrill.labelStep(for: bars.count)
        // Headroom above a full bar for the figure printed on it.
        let barRoom = bars.contains { $0.value != nil } ? height - 12 : height
        HStack(alignment: .bottom, spacing: 3) {
            ForEach(bars) { bar in
                VStack(spacing: 5) {
                    ZStack(alignment: .bottom) {
                        if bar.isEmpty {
                            // Nothing measured: an outlined slot, so it can't
                            // be read as a low value.
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .strokeBorder(
                                    palette.ink3Color.opacity(0.5),
                                    style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                        } else {
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .fill(palette.bg2Color)
                            VStack(spacing: 2) {
                                if let value = bar.value {
                                    Text(value)
                                        .font(.monoUI(8))
                                        .foregroundStyle(palette.ink2Color)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.7)
                                }
                                RoundedRectangle(cornerRadius: 2, style: .continuous)
                                    .fill(palette.accentColor)
                                    // A zero column keeps a hairline of ground
                                    // so the axis stays readable as a row of
                                    // slots.
                                    .frame(height: max(2, barRoom * bar.fraction))
                            }
                        }
                    }
                    .frame(height: height)
                    // Unlabelled columns keep the slot so every bar sits on
                    // the same baseline.
                    Text(bar.index % step == 0 ? bar.label : "")
                        .font(.monoUI(8))
                        .foregroundStyle(palette.ink3Color)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(height: 10)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(bars.map(\.title).joined(separator: ", "))
    }
}
