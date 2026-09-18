//  StatsDistributions.swift
//  The windowed lists beside the tiles: who and what carried the hours, the
//  covers finished, and the length chart the Finished drill-in draws.
//
//  All of them are scoped by `StatsRange`, which is why they live inside the
//  "In this window" band rather than under the standing rule. The rating
//  histogram and the length chart used to sit inline here too; they now open
//  from their tiles (`StatsDrillIn.swift`), as they do on web.

import Charts
import SwiftUI

/// Books finished in the window by length, as horizontal bars.
///
/// The Unknown bucket is rendered whenever it has books in it — an audiobook
/// has no page count, and hiding that would report the distribution over
/// fewer books than were finished. The caller gates on whether any bucket has
/// books: nothing finished is an absent chart, not a row of flat bars.
struct LengthBucketsChart: View {
    let buckets: [LengthBucket]

    @Environment(\.palette) private var palette

    var body: some View {
        Chart(buckets) { bucket in
            BarMark(
                x: .value("Books", bucket.books),
                y: .value("Length", bucket.label)
            )
            .foregroundStyle(palette.accentColor)
            .cornerRadius(3)
        }
        // Horizontal: the labels are page ranges, which don't fit under a
        // column but read fine beside a bar.
        .chartXAxis {
            AxisMarks { _ in
                AxisGridLine().foregroundStyle(palette.line2.color)
                AxisValueLabel().font(.monoUI(9))
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { _ in
                AxisValueLabel().font(.monoUI(9))
            }
        }
        .frame(height: 132)
    }
}

/// A ranked strip — top authors, top tags — where every row leads somewhere.
/// A ranking you can't act on is a picture of a ranking.
struct RankedList: View {
    let entries: [RankedEntity]
    let destination: (RankedEntity) -> Destination

    @Environment(\.palette) private var palette

    private var maximum: Int64 {
        max(1, entries.map(\.seconds).max() ?? 1)
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(entries.prefix(6).enumerated()), id: \.element.id) { index, entry in
                NavigationLink(value: destination(entry)) {
                    row(entry, isFirst: index == 0)
                }
                .buttonStyle(PressableStyle())
            }
        }
    }

    private func row(_ entry: RankedEntity, isFirst: Bool) -> some View {
        VStack(spacing: 0) {
            if !isFirst { Hairline() }

            HStack(spacing: Spacing.md) {
                Text(entry.name)
                    .font(.ui(13.5))
                    .foregroundStyle(palette.ink1Color)
                    .lineLimit(1)
                    .frame(width: 128, alignment: .leading)

                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(palette.line2.color)
                            .frame(height: 7)
                        Capsule()
                            .fill(
                                LinearGradient(
                                    colors: [
                                        palette.accentColor.opacity(0.65),
                                        palette.accentColor,
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(
                                width: max(
                                    7,
                                    geometry.size.width * CGFloat(entry.seconds)
                                        / CGFloat(maximum)),
                                height: 7
                            )
                    }
                    .frame(maxHeight: .infinity, alignment: .center)
                }
                .frame(height: 14)

                Text(Format.humanDuration(entry.seconds))
                    .font(.monoUI(10.5))
                    .foregroundStyle(palette.ink3Color)
                    .frame(width: 52, alignment: .trailing)
            }
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
    }
}

/// The covers finished in the window.
///
/// Titled "Recently finished" rather than with a count: the tile above already
/// states how many, and a second figure that scrolls off after six covers
/// would look like it contradicted it.
struct FinishedRail: View {
    let books: [FinishedBook]

    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            StatsSectionLabel("Recently finished")
                .screenPadding()

            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(books) { finished in
                        NavigationLink(value: Destination.book(uuid: finished.bookUUID)) {
                            VStack(alignment: .leading, spacing: 7) {
                                BookCover(
                                    identity: CoverIdentity(
                                        uuid: finished.bookUUID,
                                        title: finished.title,
                                        author: finished.author,
                                        hasCover: finished.coverURL != nil
                                    )
                                )
                                .coverShadow()

                                Text(finished.title)
                                    .font(.ui(12, weight: .medium))
                                    .foregroundStyle(palette.ink0Color)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)

                                if let rating = finished.rating {
                                    StarRating(stars: rating, size: 9)
                                }
                            }
                            .frame(width: 88)
                        }
                        .buttonStyle(BookPressStyle())
                    }
                }
                .screenPadding()
                .scrollTargetLayout()
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.viewAligned)
        }
    }
}
