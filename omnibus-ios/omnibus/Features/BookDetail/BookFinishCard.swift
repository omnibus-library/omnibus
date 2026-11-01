//  BookFinishCard.swift
//  What the stage says once a book is finished: that you did, how long it took,
//  and the one thing to do next — leave a review, pick up the next book, or look
//  back at a series read to the end. Plus the burst that goes off around the
//  cover when it happens here.

import SwiftUI

/// What the page knows about another book in the series.
struct SeriesMemberState: Equatable {
    /// `nil` when the read never answered, which is not the same as unread.
    var status: ReadStatus?
    /// Whole-book percent of the reader's place, when there is one.
    var percent: Int64?

    var started: Bool { status == .reading || (percent ?? 0) > 0 }
}

/// The card's one way onward.
enum FinishTarget: Equatable {
    case review
    case next(Book, started: Bool, percent: Int64?)
    case seriesDone
}

enum FinishCopy {
    /// Where the card points, or `nil` when it has nowhere to point yet.
    ///
    /// An unknown review offers nothing rather than guessing, since offering
    /// "Leave a review" to someone who already has would be a wrong answer
    /// corrected in view; series states wait for the same reason.
    static func target(
        reviewKnown: Bool, rated: Bool, bookID: Int64, members: [Book],
        states: [String: SeriesMemberState], statesSettled: Bool
    ) -> FinishTarget? {
        guard reviewKnown else { return nil }
        guard rated else { return .review }
        guard members.count > 1, statesSettled else { return nil }

        let others = members.filter { $0.id != bookID }
        // A status that never answered could be a finished book, and pointing
        // back at one is worse than pointing nowhere.
        guard others.allSatisfy({ states[$0.uuid]?.status != nil }) else { return nil }
        let unfinished = { (book: Book) in states[book.uuid]?.status != .finished }
        guard others.contains(where: unfinished) else { return .seriesDone }

        // The next unread after this one, else the earliest one skipped.
        let at = members.firstIndex { $0.id == bookID } ?? -1
        let later = members.dropFirst(at + 1)
        guard let next = later.first(where: unfinished) ?? others.first(where: unfinished)
        else { return .seriesDone }
        let state = states[next.uuid]
        return .next(next, started: state?.started ?? false, percent: state?.percent)
    }

    /// Whether a status read is the book becoming finished with the page up. On
    /// the first read it's the page catching up to a finish made somewhere else.
    static func celebrates(settled: Bool, was: ReadStatus, now: ReadStatus) -> Bool {
        settled && was != .finished && now == .finished
    }

    /// `17 days · 13 sessions · 4 highlights`. Nothing without a finish date to
    /// count the days to, or with nothing to count.
    static func totals(
        record: DetailReadRecord?, finishedAt: Int64?, highlights: Int
    ) -> String? {
        guard let finishedAt else { return nil }
        var parts: [String] = []
        if let record {
            let days = max(1, (finishedAt - record.startedAt) / 86_400)
            parts.append(StatsFormat.counted(days, "day"))
            parts.append(StatsFormat.counted(Int64(record.sessions), "session"))
        }
        if highlights > 0 {
            parts.append(StatsFormat.counted(Int64(highlights), "highlight"))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// `Keep going: Title` for a book already begun, `Up next: Title` otherwise.
    static func nextTitle(_ title: String, started: Bool) -> String {
        "\(started ? "Keep going" : "Up next"): \(title)"
    }

    /// `34% · Book 3 of Sherlock Holmes`.
    static func nextMeta(index: String?, series: String?, percent: Int64?) -> String {
        var place = series.map { "In \($0)" } ?? ""
        if let index = index?.nilIfBlank {
            place = series.map { "Book \(index) of \($0)" } ?? "Book \(index)"
        }
        guard let percent, percent > 0 else { return place }
        return place.isEmpty ? "\(percent)%" : "\(percent)% · \(place)"
    }

    /// `You've read all five`.
    static func readAll(count: Int) -> String {
        if count == 2 { return "You\u{2019}ve read both" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .spellOut
        formatter.locale = Locale(identifier: "en_US")
        let word = formatter.string(from: NSNumber(value: count)) ?? String(count)
        return "You\u{2019}ve read all \(word)"
    }
}

extension Palette {
    private var isLightGround: Bool { bg0.l > 0.5 }

    /// The finish card's ground, a slant across the book's color.
    fileprivate var finishGround: LinearGradient {
        LinearGradient(
            colors: isLightGround
                ? [
                    OKLCH(0.62, accent.c, accent.h, 0.16).color,
                    OKLCH(0.62, accent.c, accent.h, 0.28).color,
                ]
                : [
                    OKLCH(0.62, accent.c, accent.h, 0.3).color,
                    OKLCH(0.3, accent.c, accent.h, 0.55).color,
                ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

struct FinishCard: View {
    let book: Book
    let model: BookDetailModel
    var onReview: () -> Void

    @Environment(\.palette) private var palette

    private var members: [Book] {
        model.seriesBooks.sorted {
            (Double($0.seriesIndex ?? "") ?? 0) < (Double($1.seriesIndex ?? "") ?? 0)
        }
    }

    private var target: FinishTarget? {
        FinishCopy.target(
            reviewKnown: model.reviews != nil,
            rated: (model.reviews?.mine?.stars ?? 0) > 0,
            bookID: book.id,
            members: members,
            states: model.seriesStates,
            statesSettled: model.seriesStatesSettled
        )
    }

    private var totals: String? {
        FinishCopy.totals(
            record: DetailStats.record(from: model.sessions),
            finishedAt: model.finishedAt,
            highlights: model.highlights.count
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                Text("You finished \(book.displayTitle)")
                    .font(.display(26, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if let totals {
                    Text(totals)
                        .font(.ui(14))
                        .foregroundStyle(palette.ink1Color)
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 13)
            .padding(.bottom, 12)
            .frame(maxWidth: .infinity, alignment: .leading)

            switch target {
            case .review:
                rule
                Button {
                    Haptics.tap()
                    onReview()
                } label: {
                    row(minHeight: 60) {
                        Image(systemName: "star")
                            .font(.system(size: 17, weight: .medium))
                            .frame(width: 36, height: 36)
                            .background(Circle().fill(palette.ink0Color.opacity(0.12)))
                    } text: {
                        lines(
                            "Leave a review",
                            detail: "Tell your household what you thought"
                        )
                    }
                }
                .buttonStyle(PressableStyle())
                .accessibilityIdentifier("finish-review")

            case .next(let next, let started, let percent):
                rule
                NavigationLink(value: Destination.book(uuid: next.uuid)) {
                    row(minHeight: 70) {
                        BookCover(identity: CoverIdentity(next), size: .sm, cornerRadius: 3)
                            .frame(width: 36, height: 54)
                            .shadow(color: .black.opacity(0.5), radius: 5, x: 3, y: 4)
                            .rotationEffect(.degrees(-2.5))
                    } text: {
                        lines(
                            FinishCopy.nextTitle(next.displayTitle, started: started),
                            detail: FinishCopy.nextMeta(
                                index: next.seriesIndex, series: book.series, percent: percent
                            )
                        )
                    }
                }
                .buttonStyle(PressableStyle())
                .accessibilityIdentifier("finish-next")

            case .seriesDone:
                rule
                seriesDone

            case nil:
                EmptyView()
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(palette.finishGround))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(palette.bookText.opacity(0.35), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.35), radius: 20, y: 14)
    }

    @ViewBuilder
    private var seriesDone: some View {
        let content = row(minHeight: 66) {
            HStack(spacing: -12) {
                ForEach(Array(members.prefix(5).enumerated()), id: \.element.id) { index, member in
                    BookCover(identity: CoverIdentity(member), size: .sm, cornerRadius: 2)
                        .frame(width: 28, height: 42)
                        .shadow(color: .black.opacity(0.5), radius: 3, x: 2, y: 3)
                        .rotationEffect(.degrees(Double(index - 2) * 4))
                }
            }
            .accessibilityHidden(true)
        } text: {
            lines(
                FinishCopy.readAll(count: members.count),
                detail: "\(book.series ?? ""), start to finish"
            )
        }

        if let id = book.seriesId {
            NavigationLink(value: Destination.series(id: id)) { content }
                .buttonStyle(PressableStyle())
                .accessibilityIdentifier("finish-series-done")
        } else {
            content
        }
    }

    private var rule: some View {
        Rectangle().fill(palette.ink0Color.opacity(0.16)).frame(height: 1)
    }

    private func lines(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .font(.ui(15, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
            Text(detail)
                .font(.ui(13))
                .foregroundStyle(palette.ink1Color)
        }
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row<Leading: View, Lines: View>(
        minHeight: CGFloat,
        @ViewBuilder leading: () -> Leading,
        @ViewBuilder text: () -> Lines
    ) -> some View {
        HStack(spacing: 12) {
            leading()
            text()
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
        }
        .foregroundStyle(palette.ink0Color)
        .padding(.leading, 18)
        .padding(.trailing, 16)
        .padding(.vertical, 8)
        .frame(minHeight: minHeight)
        .contentShape(Rectangle())
    }
}

// MARK: - The burst

/// One thing thrown up around the cover: where it comes to rest, as percents of
/// the burst's frame, what it is, and how it lies there.
private struct BurstPiece {
    enum Kind { case ribbon, squiggle, diamond }
    enum Tone { case accent, cream, gold }

    let x: CGFloat
    let y: CGFloat
    let kind: Kind
    let tone: Tone
    let rotation: Double

    var size: CGSize {
        switch kind {
        case .ribbon: CGSize(width: 7, height: 20)
        case .squiggle: CGSize(width: 24, height: 10)
        case .diamond: CGSize(width: 10, height: 10)
        }
    }

    static let all: [BurstPiece] = [
        .init(x: 8, y: 6, kind: .ribbon, tone: .accent, rotation: -24),
        .init(x: 84, y: 8, kind: .squiggle, tone: .cream, rotation: 12),
        .init(x: 20, y: 2, kind: .diamond, tone: .gold, rotation: 0),
        .init(x: 66, y: 0, kind: .ribbon, tone: .cream, rotation: 32),
        .init(x: 2, y: 30, kind: .squiggle, tone: .gold, rotation: -40),
        .init(x: 92, y: 32, kind: .ribbon, tone: .gold, rotation: 18),
        .init(x: 6, y: 54, kind: .diamond, tone: .accent, rotation: 0),
        .init(x: 90, y: 56, kind: .diamond, tone: .cream, rotation: 0),
        .init(x: 0, y: 76, kind: .ribbon, tone: .cream, rotation: 42),
        .init(x: 93, y: 78, kind: .squiggle, tone: .accent, rotation: 64),
        .init(x: 40, y: 0, kind: .squiggle, tone: .accent, rotation: -12),
        .init(x: 12, y: 90, kind: .squiggle, tone: .cream, rotation: -22),
        .init(x: 84, y: 92, kind: .ribbon, tone: .accent, rotation: -30),
        .init(x: 52, y: 4, kind: .diamond, tone: .cream, rotation: 0),
        .init(x: 30, y: 96, kind: .diamond, tone: .gold, rotation: 0),
        .init(x: 70, y: 96, kind: .ribbon, tone: .gold, rotation: 14),
    ]
}

/// The notched ribbon, the diamond and the wave, each on its own small grid.
private struct BurstShape: Shape {
    let kind: BurstPiece.Kind

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let scale = CGAffineTransform(scaleX: rect.width / gridWidth, y: rect.height / gridHeight)
        switch kind {
        case .ribbon:
            path.move(to: CGPoint(x: 0, y: 0))
            path.addLine(to: CGPoint(x: 7, y: 0))
            path.addLine(to: CGPoint(x: 7, y: 20))
            path.addLine(to: CGPoint(x: 3.5, y: 17))
            path.addLine(to: CGPoint(x: 0, y: 20))
            path.closeSubpath()
        case .diamond:
            path.move(to: CGPoint(x: 5, y: 0))
            path.addLine(to: CGPoint(x: 10, y: 5))
            path.addLine(to: CGPoint(x: 5, y: 10))
            path.addLine(to: CGPoint(x: 0, y: 5))
            path.closeSubpath()
        case .squiggle:
            path.move(to: CGPoint(x: 1, y: 7))
            path.addCurve(
                to: CGPoint(x: 9, y: 7),
                control1: CGPoint(x: 4, y: 1), control2: CGPoint(x: 6, y: 1)
            )
            path.addCurve(
                to: CGPoint(x: 17, y: 7),
                control1: CGPoint(x: 12, y: 13), control2: CGPoint(x: 14, y: 13)
            )
            path.addCurve(
                to: CGPoint(x: 23, y: 4),
                control1: CGPoint(x: 20, y: 1), control2: CGPoint(x: 21, y: 3)
            )
        }
        return path.applying(scale)
    }

    private var gridWidth: CGFloat { kind == .ribbon ? 7 : kind == .squiggle ? 24 : 10 }
    private var gridHeight: CGFloat { kind == .ribbon ? 20 : 10 }
}

/// Where a piece is on its way to rest.
private struct BurstMotion {
    var opacity: Double = 1
    var x: CGFloat = 0
    var y: CGFloat = 0
    var scale: CGFloat = 1
    var turn: Double = 0
}

/// Sixteen pieces flung out from behind the cover. They stay where they land,
/// and a tap on the cover throws them again.
struct StageBurst: View {
    /// Bumped to throw them again.
    var replays: Int

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Starts at zero so the first throw is a change the animators see.
    @State private var throws_ = 0

    var body: some View {
        GeometryReader { geometry in
            ForEach(Array(BurstPiece.all.enumerated()), id: \.offset) { index, piece in
                pieceView(piece)
                    .frame(width: piece.size.width, height: piece.size.height)
                    .rotationEffect(.degrees(piece.rotation))
                    .keyframeAnimator(initialValue: BurstMotion(), trigger: throws_) { view, motion in
                        view
                            .rotationEffect(.degrees(motion.turn))
                            .scaleEffect(motion.scale)
                            .offset(x: motion.x, y: motion.y)
                            .opacity(motion.opacity)
                    } keyframes: { _ in
                        let delay = 0.001 + Double(index % 3) * 0.05
                        let fromX = (50 - piece.x) * 2.6
                        let fromY = (50 - piece.y) * 3.2

                        KeyframeTrack(\.opacity) {
                            MoveKeyframe(0)
                            LinearKeyframe(0, duration: delay)
                            CubicKeyframe(1, duration: 0.3)
                        }
                        KeyframeTrack(\.x) {
                            MoveKeyframe(fromX)
                            LinearKeyframe(fromX, duration: delay)
                            CubicKeyframe(0, duration: 0.3)
                        }
                        KeyframeTrack(\.y) {
                            MoveKeyframe(fromY)
                            LinearKeyframe(fromY, duration: delay)
                            CubicKeyframe(0, duration: 0.3)
                            CubicKeyframe(14, duration: 0.75)
                            CubicKeyframe(0, duration: 0.45)
                        }
                        KeyframeTrack(\.scale) {
                            MoveKeyframe(0.3)
                            LinearKeyframe(0.3, duration: delay)
                            CubicKeyframe(1, duration: 0.3)
                        }
                        KeyframeTrack(\.turn) {
                            MoveKeyframe(-piece.rotation)
                            LinearKeyframe(-piece.rotation, duration: delay)
                            CubicKeyframe(0, duration: 0.3)
                            CubicKeyframe(12, duration: 0.75)
                            CubicKeyframe(0, duration: 0.45)
                        }
                    }
                    .position(
                        x: geometry.size.width * piece.x / 100 + piece.size.width / 2,
                        y: geometry.size.height * piece.y / 100 + piece.size.height / 2
                    )
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { fire() }
        .onChange(of: replays) { _, _ in fire() }
    }

    private func fire() {
        guard !reduceMotion else { return }
        throws_ += 1
    }

    @ViewBuilder
    private func pieceView(_ piece: BurstPiece) -> some View {
        let color = tint(piece.tone)
        if piece.kind == .squiggle {
            BurstShape(kind: piece.kind)
                .stroke(color, style: StrokeStyle(lineWidth: 3, lineCap: .round))
        } else {
            BurstShape(kind: piece.kind).fill(color)
        }
    }

    private func tint(_ tone: BurstPiece.Tone) -> Color {
        switch tone {
        case .accent: palette.bookRibbon
        case .cream: Color(red: 0.953, green: 0.922, blue: 0.867)
        case .gold: Color(red: 0.788, green: 0.631, blue: 0.357)
        }
    }
}
