//  BookStage.swift
//  The top of the book page: a blurred wash of the cover, the book itself
//  standing on it at a slight turn, and under it who wrote it, where you are in
//  it and what the household made of it.

import SwiftUI

/// The room the book stands in. Pans a little per tab, and drifts slowly while
/// the page is up.
struct StageBackdrop: View {
    let book: Book
    let tab: BookTab

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drift = false

    /// How far past its own frame the wash runs, so a pull down never finds an
    /// edge.
    static let overscroll: CGFloat = 480

    private var isLight: Bool { palette.bg0.l > 0.5 }
    private var hasCover: Bool { book.coverURL != nil }

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size

            ZStack(alignment: .top) {
                (hasCover ? palette.bg0Color : OKLCH(0.3, palette.accent.c, palette.accent.h).color)
                if hasCover { wash(size) }
                warmth(size)
                scrim(size)
            }
            .frame(width: size.width, height: size.height + Self.overscroll)
            .clipped()
            .offset(y: -Self.overscroll)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 22).repeatForever(autoreverses: true)) {
                drift = true
            }
        }
    }

    private func wash(_ size: CGSize) -> some View {
        let height = size.height + Self.overscroll

        // The smallest thumb is plenty under a blur this wide, and it keeps
        // the drift cheap: the blur is flattened once and only the result moves.
        return RemoteImage(
            path: "/api/thumbs/\(book.uuid)/md",
            alternates: ["/api/thumbs/\(book.uuid)/lg", "/api/thumbs/\(book.uuid)/sm"]
        ) {
            Color.clear
        }
        .frame(width: size.width * 1.4, height: height * 1.2)
        .clipped()
        .blur(radius: 20)
        .saturation(1.3)
        .brightness(isLight ? 0 : -0.2)
        .drawingGroup()
        .scaleEffect(drift ? 1.07 : 1.02)
        .offset(
            x: size.width * (tab.backdropPan + (drift ? 0.02 : -0.02)),
            y: height * (drift ? 0.015 : -0.015)
        )
        .frame(width: size.width, height: height)
        .animation(Motion.glide, value: tab)
    }

    private func warmth(_ size: CGSize) -> some View {
        EllipticalGradient(
            colors: [Color(red: 1, green: 0.66, blue: 0.38).opacity(0.32), .clear],
            startRadiusFraction: 0,
            endRadiusFraction: 0.5
        )
        .frame(width: size.width * 1.7, height: size.height)
        .position(x: size.width / 2, y: Self.overscroll + size.height * 0.26)
        .opacity(tab.warmth)
        .animation(Motion.glide, value: tab)
    }

    private func scrim(_ size: CGSize) -> some View {
        let ground = palette.bg0Color
        // A light ground needs more of itself over the art for dark ink to
        // hold, where a dark one only has to fade out at the foot.
        let top = isLight ? 0.78 : 0.55
        let middle = isLight ? 0.62 : 0.16
        let low = isLight ? 0.86 : 0.74

        return VStack(spacing: 0) {
            ground.opacity(top).frame(height: Self.overscroll)
            LinearGradient(
                stops: [
                    .init(color: ground.opacity(top), location: 0),
                    .init(color: ground.opacity(middle), location: 0.3),
                    .init(color: ground.opacity(low), location: 0.76),
                    .init(color: ground, location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: size.height)
        }
    }
}

/// The book, standing up: turned a few degrees off square, lit from behind, its
/// shadow on the floor. It leans as the page moves under it.
struct StageCover: View {
    let book: Book
    /// Whether the burst is out around the book.
    var bursts = false
    /// Bumped to throw it again.
    var burstReplays = 0
    var onTap: () -> Void

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let width: CGFloat = 168
    static var height: CGFloat { (width * 3 / 2).rounded() }

    /// How dark the book's shadow falls: on a pale ground the dark theme's
    /// reads as a smudge rather than as depth.
    private var shadowDepth: Double { palette.bg0.l > 0.5 ? 0.28 : 0.62 }

    var body: some View {
        Button {
            Haptics.tap()
            onTap()
        } label: {
            cover
                .background { halo }
                .overlay {
                    if bursts {
                        StageBurst(replays: burstReplays)
                            .frame(width: Self.width * 1.8, height: Self.height * 1.4)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(book.displayTitle) cover")
        .accessibilityIdentifier("book-stage-cover")
    }

    private var cover: some View {
        let calm = reduceMotion

        return BookCover(identity: CoverIdentity(book), size: .lg, cornerRadius: 5)
            .frame(width: Self.width, height: Self.height)
            .overlay { spine }
            .compositingGroup()
            .shadow(color: .black.opacity(0.4), radius: 2, y: 2)
            .shadow(color: .black.opacity(shadowDepth), radius: 30, x: 22, y: 30)
            .rotationEffect(.degrees(-2.5))
            .visualEffect { content, proxy in
                // The pointer lean of a desktop has no finger to follow here;
                // the scroll is what moves under a reader's thumb instead.
                let drift = calm ? 0 : (proxy.frame(in: .global).minY - 90) / 260
                let lean = min(1, max(-1, drift))
                return content
                    .rotation3DEffect(
                        .degrees(2 - lean * 3.5), axis: (x: 1, y: 0, z: 0), perspective: 0.15
                    )
                    .rotation3DEffect(.degrees(8), axis: (x: 0, y: 1, z: 0), perspective: 0.15)
            }
    }

    /// The fold down the spine: dark, a catch of light, dark, then nothing.
    private var spine: some View {
        LinearGradient(
            stops: [
                .init(color: .black.opacity(0.55), location: 0),
                .init(color: .black.opacity(0.15), location: 0.022),
                .init(color: .white.opacity(0.22), location: 0.032),
                .init(color: .white.opacity(0), location: 0.055),
                .init(color: .black.opacity(0.18), location: 0.065),
                .init(color: .black.opacity(0), location: 0.09),
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
        .allowsHitTesting(false)
    }

    /// Light behind the book, a brighter fall of it from above, and the floor.
    /// Elliptical gradients, so each fades out exactly at its own frame.
    private var halo: some View {
        ZStack {
            EllipticalGradient(
                stops: [
                    .init(color: Color(red: 1, green: 0.74, blue: 0.48).opacity(0.24), location: 0),
                    .init(color: palette.bookRibbon.opacity(0.36), location: 0.42),
                    .init(color: palette.bookRibbon.opacity(0.08), location: 0.72),
                    .init(color: .clear, location: 1),
                ],
                startRadiusFraction: 0,
                endRadiusFraction: 0.5
            )
            .frame(width: Self.width * 2.7, height: Self.height * 1.7)
            .offset(y: Self.height * -0.1)

            EllipticalGradient(
                colors: [Color(red: 1, green: 0.89, blue: 0.75).opacity(0.18), .clear],
                startRadiusFraction: 0,
                endRadiusFraction: 0.5
            )
            .frame(width: Self.width * 1.8, height: Self.height * 1.9)
            .offset(y: Self.height * -0.62)

            Ellipse()
                .fill(.black.opacity(shadowDepth + 0.1))
                .blur(radius: 10)
                .frame(width: Self.width * 1.04, height: 28)
                .offset(x: 6, y: Self.height / 2 + 12)
        }
    }
}

/// Sets a title's lines closer than Cormorant's own leading, which is airy at
/// display sizes. A renderer because `lineSpacing` won't go negative, and
/// `lineHeight` clips descenders to the shortened line.
struct TightLeading: TextRenderer {
    let tighten: CGFloat

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for (index, line) in layout.enumerated() {
            var copy = context
            copy.translateBy(x: 0, y: -tighten * CGFloat(index))
            copy.draw(line)
        }
    }

    func sizeThatFits(proposal: ProposedViewSize, text: TextProxy) -> CGSize {
        let size = text.sizeThatFits(proposal)
        let line = text.sizeThatFits(.unspecified).height
        let lines = line > 0 ? (size.height / line).rounded() : 1
        return CGSize(width: size.width, height: size.height - tighten * max(0, lines - 1))
    }
}

/// A row of stars reading out a rating: filled to the half star, outlined past
/// it. For the writable row see `StarRating`.
struct StageStars: View {
    let stars: Double
    var size: CGFloat = 18
    /// Bumped to have the row answer, a star at a time.
    var pulse = 0

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { slot in
                let filled = Double(slot) <= stars
                let half = !filled && Double(slot) - 0.5 <= stars
                Image(systemName: filled ? "star.fill" : (half ? "star.leadinghalf.filled" : "star"))
                    .font(.system(size: size * 0.86))
                    .foregroundStyle(filled || half ? palette.bookText : palette.ink0Color.opacity(0.6))
                    .frame(width: size, height: size)
                    .keyframeAnimator(initialValue: 0.0, trigger: pulse) { view, amount in
                        view
                            .scaleEffect(reduceMotion ? 1 : 1 + 0.4 * amount)
                            .rotationEffect(.degrees(reduceMotion ? 0 : -10 * amount))
                    } keyframes: { _ in
                        KeyframeTrack {
                            LinearKeyframe(0, duration: 0.24 + Double(slot - 1) * 0.05)
                            CubicKeyframe(1, duration: 0.18)
                            CubicKeyframe(0, duration: 0.28)
                        }
                    }
            }
        }
    }
}

/// The bar across the stage: one division per chapter, filled to where you
/// are, with a flag standing on the spot.
struct StageProgressBar: View {
    let segments: [StageSegment]
    let fraction: Double
    let flag: String
    let label: String

    @Environment(\.palette) private var palette

    private static let gap: CGFloat = 3

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let room = max(0, width - Self.gap * CGFloat(max(0, segments.count - 1)))
            let total = segments.reduce(0) { $0 + $1.weight }

            ZStack(alignment: .topLeading) {
                HStack(spacing: Self.gap) {
                    ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                        segmentView(segment)
                            .frame(width: total > 0 ? room * segment.weight / total : 0)
                    }
                }
                flagView(x: width * fraction, width: width)
            }
        }
        .frame(height: 6)
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue("\(Int(fraction * 100)) percent")
    }

    private func segmentView(_ segment: StageSegment) -> some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                palette.ink0Color.opacity(0.2)
                palette.bookRibbon.frame(width: geometry.size.width * segment.fill)
            }
        }
        .clipShape(Capsule())
    }

    /// The label stays inside the bar's width at either end; only its stem
    /// keeps to the exact spot.
    private func flagView(x: CGFloat, width: CGFloat) -> some View {
        let half: CGFloat = 26
        let center = min(width - half, max(half, x))

        return ZStack(alignment: .top) {
            Text(flag)
                .font(.ui(13, weight: .semibold))
                .foregroundStyle(palette.bg0Color)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(Capsule().fill(palette.ink0Color))
                .position(x: center, y: -19)
            Rectangle()
                .fill(palette.ink0Color)
                .frame(width: 2, height: 14)
                .position(x: x, y: -3)
        }
        .frame(width: width, height: 6, alignment: .topLeading)
        .allowsHitTesting(false)
    }
}

/// Everything the stage states about the book and your place in it.
struct BookStage: View {
    let book: Book
    let model: BookDetailModel
    let tab: BookTab
    var isOnline = true
    /// Whether this device holds a copy the reader can open with no network.
    var holdsCopy = false
    var onReview: () -> Void = {}
    var onReviews: () -> Void
    var onSeries: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.palette) private var palette
    /// Bumped by a tap on the cover, to throw the burst again.
    @State private var burstReplays = 0

    private var titleSize: CGFloat {
        let length = book.displayTitle.count
        return length <= 22 ? 48 : length <= 30 ? 42 : 38
    }

    private var inSeries: Bool { book.series?.nilIfBlank != nil }

    private var showsStatus: Bool {
        DetailRead.showsReadStatus(
            hasFile: model.hasFile, hasPhysical: book.hasPhysical,
            wishlisted: model.wishlistEntry != nil
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            StageCover(
                book: book,
                bursts: model.readStatus == .finished && model.celebrations > 0,
                burstReplays: burstReplays + model.celebrations
            ) {
                burstReplays += 1
            }

            if model.isWishlistOnly, let entry = model.wishlistEntry {
                Text(DetailRead.wishlistLine(source: WishlistCopy.sourceLabel(entry.source)))
                    .font(.ui(14))
                    .foregroundStyle(palette.ink1Color)
                    .multilineTextAlignment(.center)
                    .padding(.top, 22)
            }

            Text(book.displayTitle)
                .font(.display(titleSize, weight: .semibold))
                .kerning(titleSize * -0.015)
                .foregroundStyle(palette.ink0Color)
                .multilineTextAlignment(.center)
                .lineLimit(4)
                .minimumScaleFactor(0.7)
                .textRenderer(TightLeading(tighten: titleSize * 0.2))
                .padding(.top, model.isWishlistOnly ? 10 : 24)
                .accessibilityAddTraits(.isHeader)

            byline
                .padding(.top, 2)

            HStack(spacing: Spacing.sm) {
                if showsStatus { statusPill }
                Spacer(minLength: 0)
                ratingButton
            }
            .padding(.top, 2)

            place
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 14)
        .animation(reduceMotion ? nil : Motion.settle, value: model.readStatus)
    }

    // MARK: - Byline

    /// The author, then the series on a line of its own. Without a series, the
    /// year beside the author when it fits and under them when not.
    private var byline: some View {
        Group {
            if inSeries {
                // Each line keeps a finger's height to tap and overlaps the
                // other by a little, so the two read as one byline.
                VStack(spacing: 0) {
                    authorLink.padding(.vertical, -6)
                    seriesLink.padding(.vertical, -6)
                }
                .padding(.vertical, 6)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) {
                        authorLink
                        yearText(separated: true)
                    }
                    VStack(spacing: 0) {
                        authorLink
                        yearText(separated: false)
                    }
                }
            }
        }
        .font(.ui(16, weight: .medium))
        .foregroundStyle(palette.ink1Color)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
    }

    private var seriesLink: some View {
        Button(action: onSeries) {
            Text(seriesLabel)
                .underline(color: palette.ink1Color.opacity(0.45))
                .frame(minHeight: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("book-series-link")
    }

    @ViewBuilder
    private func yearText(separated: Bool) -> some View {
        if let year = book.year {
            Text(separated ? "· \(year)" : year).frame(minHeight: 40)
        }
    }

    @ViewBuilder
    private var authorLink: some View {
        if let author = DetailRead.linkedCreators(book.creators).first {
            NavigationLink(value: Destination.author(id: author.id)) {
                Text(book.authorDisplay).frame(minHeight: 40)
            }
            .buttonStyle(.plain)
        } else {
            Text(book.authorDisplay).frame(minHeight: 40)
        }
    }

    private var seriesLabel: String {
        guard let series = book.series else { return "" }
        return DetailRead.seriesLabel(
            series: series, index: book.seriesIndex, total: model.seriesBooks.count
        )
    }

    // MARK: - Status and rating

    private var statusPill: some View {
        Menu {
            ForEach(ReadStatus.allCases, id: \.self) { status in
                Button {
                    guard status != model.readStatus else { return }
                    Haptics.select()
                    Task { await model.setStatus(status, uuid: book.uuid) }
                } label: {
                    Text(status.label)
                    if status == .finished, model.readStatus == .finished,
                       let finishedAt = model.finishedAt
                    {
                        Text(DetailFormat.shortDay(unix: finishedAt))
                    }
                    if status == model.readStatus {
                        Image(systemName: "checkmark")
                    }
                }
            }
        } label: {
            HStack(spacing: 7) {
                Text(model.readStatusKnown ? model.readStatus.label : "Reading status")
                    .font(.ui(15, weight: .semibold))
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .bold))
            }
            .foregroundStyle(palette.ink0Color)
            .padding(.leading, 15)
            .padding(.trailing, 12)
            .frame(minHeight: 44)
            .background(Capsule().fill(palette.bookWash))
            .overlay(Capsule().strokeBorder(palette.bookRim, lineWidth: 1))
            .contentShape(Capsule())
        }
        .menuOrder(.fixed)
        .accessibilityLabel(
            model.readStatusKnown ? "Read status: \(model.readStatus.label)" : "Read status"
        )
        .accessibilityIdentifier("book-read-status")
    }

    private var ratingButton: some View {
        let state = ReviewCardState.resolve(model.reviews, failure: model.reviewsFailure)
        let headline = DetailReviews.headline(model.reviews)

        return Button {
            Haptics.tap()
            onReviews()
        } label: {
            HStack(spacing: 5) {
                StageStars(stars: headline?.rounded ?? 0, pulse: model.reviewSaves)
                    .opacity(model.reviews == nil ? 0.45 : 1)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(palette.ink1Color)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(DetailReviews.headlineSpoken(headline, state: state))
        .accessibilityHint("Opens Reviews")
        .accessibilityIdentifier("household-rating")
    }

    // MARK: - Your place

    @ViewBuilder
    private var place: some View {
        if model.hasFile {
            switch model.readStatus {
            case .reading:
                reading
            case .unread:
                EmptyView()
            case .finished:
                FinishCard(book: book, model: model, onReview: onReview)
                    .padding(.top, 12)
                    .transition(.opacity.combined(with: .offset(y: 26)))
            }
            if !isOnline, !holdsCopy { offlineNote }
        }
    }

    @ViewBuilder
    private var reading: some View {
        if let fraction = model.fraction {
            let percent = Int(fraction * 100)
            let audioSeconds = model.fractionIsAudio ? model.audioProgress?.audioPositionSeconds : nil

            StageProgressBar(
                segments: StageProgress.segments(weights: weights, fraction: fraction),
                fraction: fraction,
                flag: DetailRead.flagLabel(
                    chapter: model.currentChapter, audioSeconds: audioSeconds, percent: percent
                ),
                label: model.fractionIsAudio ? "Listening progress" : "Reading progress"
            )
            .padding(.top, 36)

            HStack(spacing: 0) {
                Text("\(percent)%")
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                if let left = DetailStats.leftLine(
                    record: DetailStats.record(from: model.sessions), percent: percent,
                    isAudio: model.fractionIsAudio, audioSeconds: audioSeconds,
                    audioDuration: model.audioDuration
                ) {
                    Text(" · \(left)")
                        .font(.ui(15))
                        .foregroundStyle(palette.ink1Color)
                }
            }
            .padding(.top, 10)
        } else if model.hasPosition {
            // A place exists but supports no honest bar: a bare CFI, or audio
            // with no measured duration. Say so rather than draw zero.
            line("In progress")
                .padding(.top, 14)
        }
    }

    private var weights: [Double] {
        if model.fractionIsAudio || !book.hasEbook {
            return StageProgress.weights(durations: model.audioChapters.map(\.durationSeconds))
        }
        return StageProgress.weights(starts: model.chapters.map(\.percent))
    }

    private func line(_ text: String) -> some View {
        Text(text)
            .font(.ui(15))
            .foregroundStyle(palette.ink1Color)
            .multilineTextAlignment(.center)
    }

    private var offlineNote: some View {
        HStack(spacing: 7) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 13, weight: .medium))
            Text("Offline. This book isn't downloaded.")
                .font(.ui(14))
        }
        .foregroundStyle(palette.ink1Color)
        .padding(.top, 8)
        .accessibilityElement(children: .combine)
    }
}
