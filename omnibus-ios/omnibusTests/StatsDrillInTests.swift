//  StatsDrillInTests.swift
//  The tile drill-in's derivations — the delta chip, the trend bars, and the
//  Pages copy. Every one mirrors a function in the web drill-in
//  (`frontend/src/pages/stats/drill_in.rs`), so these pin the two surfaces to
//  the same answer: a reader switching from the site to the phone must read
//  the same "▲ 18% vs last month".

import Foundation
import Testing

@testable import omnibus

private func summary(range: StatsRange = .month, _ mutate: (inout StatsSummary) -> Void = { _ in })
    -> StatsSummary
{
    var s = StatsSummary()
    s.range = range
    mutate(&s)
    return s
}

@Suite("Drill-in delta")
struct DrillDeltaTests {
    @Test("a figure with no baseline is New, and nothing over nothing is no delta at all")
    func newAgainstEmptyBaseline() {
        #expect(StatsDrill.percentDelta(current: 3, previous: 0) == DrillDelta(direction: .up, label: "New"))
        #expect(StatsDrill.percentDelta(current: 0, previous: 0) == nil)
    }

    @Test("a change under half a percent is flat, larger ones round to a whole percent")
    func percentRounding() {
        #expect(
            StatsDrill.percentDelta(current: 1001, previous: 1000)
                == DrillDelta(direction: .flat, label: "No change"))
        #expect(StatsDrill.percentDelta(current: 118, previous: 100) == DrillDelta(direction: .up, label: "18%"))
        #expect(StatsDrill.percentDelta(current: 75, previous: 100) == DrillDelta(direction: .down, label: "25%"))
    }

    @Test("a star delta needs both windows rated, and reads in stars")
    func starsDelta() {
        #expect(StatsDrill.starsDelta(current: 4.2, previous: nil) == nil)
        #expect(StatsDrill.starsDelta(current: nil, previous: 4.2) == nil)
        #expect(
            StatsDrill.starsDelta(current: 4.21, previous: 4.2)
                == DrillDelta(direction: .flat, label: "No change"))
        #expect(
            StatsDrill.starsDelta(current: 4.5, previous: 4.2)
                == DrillDelta(direction: .up, label: "0.3\u{2605}"))
    }

    @Test("Lifetime has no previous window, so no metric reports a delta there")
    func lifetimeHasNoDelta() {
        let s = summary(range: .allTime) {
            $0.booksFinished = 4
            $0.avgStars = 4
            $0.listeningSeconds = 600
            $0.pagesRead = 20
        }
        for metric in DrillMetric.allCases {
            #expect(StatsDrill.delta(for: metric, in: s) == nil, "\(metric)")
        }
        #expect(StatsDrill.vsLabel(.allTime) == nil)
        #expect(StatsDrill.vsLabel(.month) == "vs last month")
    }

    @Test("each metric compares its own figure against the previous window's")
    func perMetricSources() {
        let s = summary {
            $0.booksFinished = 3
            $0.previous.booksFinished = 2
            $0.listeningSeconds = 900
            $0.previous.listeningSeconds = 1800
            $0.pagesRead = nil
            $0.previous.pagesRead = 40
            $0.avgStars = 3.5
            $0.previous.avgStars = 4.5
        }
        #expect(StatsDrill.delta(for: .finished, in: s) == DrillDelta(direction: .up, label: "50%"))
        #expect(StatsDrill.delta(for: .listening, in: s) == DrillDelta(direction: .down, label: "50%"))
        // An unmeasured window counts as zero pages against a measured baseline.
        #expect(StatsDrill.delta(for: .pages, in: s) == DrillDelta(direction: .down, label: "100%"))
        #expect(StatsDrill.delta(for: .avgRating, in: s) == DrillDelta(direction: .down, label: "1.0\u{2605}"))
    }
}

@Suite("Drill-in trend")
struct DrillTrendTests {
    @Test("bars are normalized to the tallest point, and an all-zero series stays flat")
    func normalizes() {
        let bars = StatsDrill.bars([("a", 1), ("b", 4), ("c", 0)])
        #expect(bars.map(\.fraction) == [0.25, 1, 0])
        #expect(bars.map(\.label) == ["a", "b", "c"])
        #expect(StatsDrill.bars([("a", 0), ("b", 0)]).map(\.fraction) == [0, 0])
    }

    @Test("each metric draws its own series with its own axis")
    func perMetricSeries() {
        let s = summary {
            $0.booksPerMonth = [MonthCount(month: "2026-06", books: 1), MonthCount(month: "2026-07", books: 2)]
            $0.ratingMonthly = [TrendPoint(label: "2026-03", value: 4)]
            $0.listeningDaily = [DayActivity(day: "2026-08-03", seconds: 120)]
            $0.pagesDetail.daily = [TrendPoint(label: "2026-08-09", value: 12)]
        }
        #expect(StatsDrill.trendBars(for: .finished, in: s).map(\.label) == ["J", "J"])
        #expect(StatsDrill.trendBars(for: .finished, in: s).map(\.fraction) == [0.5, 1])
        #expect(StatsDrill.trendBars(for: .avgRating, in: s).map(\.label) == ["M"])
        #expect(StatsDrill.trendBars(for: .listening, in: s).map(\.label) == ["03"])
        #expect(StatsDrill.trendBars(for: .pages, in: s).map(\.label) == ["09"])
    }

    @Test("malformed months and days label themselves as unknown rather than crashing")
    func malformedLabels() {
        #expect(StatsDrill.shortMonth("2026-13") == "?")
        #expect(StatsDrill.shortMonth("garbage") == "?")
        #expect(StatsDrill.shortMonth("2026-01") == "J")
        #expect(StatsDrill.shortDay("2026-02-31") == "31")
        #expect(StatsDrill.shortDay("2026-02-32") == "?")
        #expect(StatsDrill.shortDay("9") == "?", "a bare number is not a day")
    }

    @Test("the histogram is empty for an unrated window and titles each bucket with its count")
    func histogram() {
        let empty = (1...10).map { RatingBucket(halfStars: Int64($0), books: 0) }
        #expect(StatsDrill.histogramBars(empty).isEmpty)

        var rated = empty
        rated[7].books = 2  // four stars
        rated[9].books = 1  // five stars
        let bars = StatsDrill.histogramBars(rated)
        #expect(bars.count == 10)
        #expect(bars[7].title == "4 \u{2605} \u{00B7} 2 books")
        #expect(bars[9].title == "5 \u{2605} \u{00B7} 1 book")
        #expect(bars[7].fraction == 1)
        #expect(bars[9].fraction == 0.5)
    }

    @Test("a dozen columns all carry a label; a month of days labels every third")
    func labelStep() {
        #expect(StatsDrill.labelStep(for: 12) == 1)
        #expect(StatsDrill.labelStep(for: 13) == 2)
        #expect(StatsDrill.labelStep(for: 31) == 3)
        #expect(StatsDrill.labelStep(for: 0) == 1)
    }
}

@Suite("Drill-in copy")
struct DrillCopyTests {
    @Test("the Pages note names the population, the unmeasured, and the cutover in that order")
    func pagesNoteLines() {
        let s = summary {
            $0.pagesRead = 40
            $0.pagesDetail.measuredBooks = 2
            $0.pagesDetail.unmeasuredBooks = 1
            $0.pagesDetail.sinceDay = "2026-05-01"
            $0.pagesDetail.windowPredatesLedger = true
        }
        #expect(
            StatsDrill.pagesNoteLines(s) == [
                "Across 2 books this period.",
                "1 more book has no known length yet, so nothing it contributed is counted.",
                "Page tracking began 2026-05-01; reading before then can\u{2019}t be counted, so this period is only partly covered.",
            ])
    }

    @Test("an audio-only window says so instead of reading as no data")
    func audioOnlyWindow() {
        let s = summary {
            $0.pagesRead = nil
            $0.pagesDetail.audioBooks = 1
        }
        #expect(StatsDrill.pagesNoteLines(s) == ["Only audiobooks this period \u{2014} listening turns no pages."])
    }

    @Test("with nothing measured, the unmeasured line does not say \"more\"")
    func unmeasuredWithoutMeasured() {
        let s = summary {
            $0.pagesRead = nil
            $0.pagesDetail.unmeasuredBooks = 3
            $0.pagesDetail.sinceDay = "2026-05-01"
        }
        #expect(
            StatsDrill.pagesNoteLines(s) == [
                "No page progress recorded in this period yet.",
                "3 books have no known length yet, so nothing they contributed is counted.",
                "Page tracking began 2026-05-01.",
            ])
    }

    @Test("the finished list labels a truncation and stays silent when it is whole")
    func truncationNote() {
        #expect(StatsDrill.finishedTruncationNote(shown: 100, total: 140) == "Showing the latest 100 of 140 finished books.")
        #expect(StatsDrill.finishedTruncationNote(shown: 3, total: 3) == nil)
    }
}
