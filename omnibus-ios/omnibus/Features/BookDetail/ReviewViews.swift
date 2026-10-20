//  ReviewViews.swift
//  The Reviews block on the book detail, where the stars used to sit: your
//  review card, the household summary, and other readers' reviews — plus the
//  read-only household rating by the title, the composer, and the sheet the
//  marquee's one-screen Stats stop hands the whole block off to.
//
//  Text is set from its Markdown source through the journal pipeline, so a
//  `||spoiler||` reads the same here as in a journal entry, and an edit still
//  waiting on the server reads the same as one it has rendered.

import SwiftUI

// MARK: - Pure derivations

/// Copy and decisions behind the Reviews block, kept off the views so the
/// unit suite can pin them.
enum DetailReviews {
    /// Scroll id of the block's top edge, which the title line jumps to.
    static let anchorID = "detail-reviews"

    /// How tall another reader's text stands before Read more takes over —
    /// four lines of the reading face.
    static let collapsedTextHeight: CGFloat = 116

    /// `4.3 · 3 readers` — the household line by the title.
    static func titleLine(_ summary: ReviewSummary) -> String {
        "\(average(summary.averageStars)) · \(StatsFormat.counted(summary.ratings, "reader"))"
    }

    /// The mean to one decimal, the precision the web shows it at.
    static func average(_ stars: Double) -> String {
        String(format: "%.1f", stars)
    }

    /// The block's kicker: how many other readers have said anything.
    static func kicker(othersCount: Int) -> String {
        guard othersCount > 0 else { return "Reviews" }
        let noun = othersCount == 1 ? "other reader" : "other readers"
        return "Reviews · \(othersCount) \(noun)"
    }

    /// The capped stop's hand-off to the sheet that holds the whole block.
    static func allLabel(othersCount: Int) -> String {
        guard othersCount > 0 else { return "Your whole review" }
        return "All reviews · \(othersCount) other \(othersCount == 1 ? "reader" : "readers")"
    }

    /// Whether your review holds text or notes, not just stars.
    static func hasWriting(_ review: Review) -> Bool {
        review.bodyMd?.nilIfBlank != nil || review.notesMd?.nilIfBlank != nil
    }

    /// The pencil's name: it starts a review as well as editing one.
    static func composeLabel(_ review: Review?) -> String {
        review.map(hasWriting) == true ? "Edit review" : "Write review"
    }

    /// The note beside the stars while your review is unknown — true to why.
    static func unknownNote(_ state: ReviewCardState) -> String {
        switch state {
        case .unavailable(.offline): "loads when you're back online"
        case .unavailable(.failed): "couldn't load · pull down to retry"
        default: "loading your review"
        }
    }

    /// The composer's warning when fields you were editing also changed
    /// elsewhere; `nil` when none did.
    static func conflictNote(_ fields: Set<ReviewDraft.Field>) -> String? {
        let names = [
            (ReviewDraft.Field.body, "review text"),
            (.notes, "private notes"),
            (.spoiler, "spoiler flag"),
        ].filter { fields.contains($0.0) }.map(\.1)
        guard !names.isEmpty else { return nil }
        let list = names.count == 1
            ? names[0]
            : names.dropLast().joined(separator: ", ") + " and " + names[names.count - 1]
        return "Your \(list) changed elsewhere while this was open — Save keeps yours."
    }

    /// Whether a change in connectivity should read the reviews again: only
    /// coming back online, and only while there is still nothing known.
    static func rereadsOnReconnect(wasOnline: Bool, isOnline: Bool, known: Bool) -> Bool {
        !wasOnline && isOnline && !known
    }

    /// The note beside your stars.
    static func starsNote(_ stars: Double?) -> String {
        guard let stars, stars > 0 else { return "tap a star to rate" }
        return "rated \(stars.formatted()) of 5"
    }

    /// Whether a review's text starts collapsed behind its spoiler warning.
    /// Never for a reader who has finished the book — there is nothing left
    /// to spoil — and never for the stars, which the warning doesn't cover.
    static func hidesText(spoiler: Bool, viewerStatus: ReadStatus) -> Bool {
        spoiler && viewerStatus != .finished
    }

    /// Other readers' written reviews, in the server's order.
    static func written(_ others: [AttributedReview]) -> [AttributedReview] {
        others.filter(\.hasText)
    }

    /// Other readers who rated without writing — the compact row.
    static func starsOnly(_ others: [AttributedReview]) -> [AttributedReview] {
        others.filter { !$0.hasText && $0.stars != nil }
    }

    /// A body as plain lines for the collapsed view: every line run through
    /// the journal row's preview, so spoilers are already censored and
    /// Markdown syntax is resolved rather than shown.
    static func excerpt(_ md: String) -> String {
        md.replacingOccurrences(of: "\r\n", with: "\n")
            .split(separator: "\n")
            // An image parses to an attachment character the reading face
            // has nothing to draw for.
            .map { JournalRow.preview(String($0)).replacingOccurrences(of: "\u{FFFC}", with: "") }
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }

    /// Whether a body has any text to set at all — an image-only review has
    /// none the app can draw, and says so rather than showing a blank row.
    static func hasVisibleText(_ md: String) -> Bool {
        !excerpt(md).isEmpty
    }

    /// Whether text measured at `fullHeight` runs past the collapsed height —
    /// the cue for Read more. Measured, not estimated, so a narrow phone that
    /// wraps more still gets it.
    static func isTruncated(fullHeight: CGFloat) -> Bool {
        fullHeight > collapsedTextHeight + 1
    }

    /// The ten half-star buckets as bars, styled as the stats page's rating
    /// histogram is, each counting readers rather than books.
    static func summaryBars(_ buckets: [ReviewBucket]) -> [TrendBar] {
        let base = StatsDrill.bars(buckets.map { ($0.starLabel, Double($0.readers)) })
        return zip(base, buckets).map { bar, bucket in
            TrendBar(
                index: bar.index,
                label: bar.label,
                title: "\(bar.label) \u{2605} \u{00B7} \(StatsFormat.counted(bucket.readers, "reader"))",
                fraction: bar.fraction,
                value: bucket.readers > 0 ? String(bucket.readers) : nil,
                isEmpty: bucket.readers <= 0
            )
        }
    }
}

// MARK: - Title line

/// `★ 4.3 · 3 readers` under the byline. Read-only; a tap goes to Reviews.
struct HouseholdRatingLine: View {
    let summary: ReviewSummary
    var onTap: () -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        Button {
            Haptics.tap()
            onTap()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "star.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(palette.accentColor)
                Text(DetailReviews.titleLine(summary))
                    .font(.monoUI(10.5))
                    .foregroundStyle(palette.ink1Color)
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            "Rated \(DetailReviews.average(summary.averageStars)) by "
                + StatsFormat.counted(summary.ratings, "reader")
        )
        .accessibilityHint("Shows the reviews")
        .accessibilityIdentifier("household-rating")
    }
}

// MARK: - The block

/// Everything under the Reviews kicker. `uncapped` is the flow and the
/// all-reviews sheet; capped is the marquee's Stats stop, one screenful that
/// keeps your card and hands everyone else's to the sheet from the kicker row.
struct ReviewsBlock: View {
    let book: Book
    let model: BookDetailModel
    var uncapped = true
    /// Opens the all-reviews sheet; only the capped block offers it.
    var onAll: (() -> Void)?

    @Environment(\.palette) private var palette
    @State private var composing: ReviewComposerTarget?

    private var reviews: BookReviews { model.reviews ?? .empty }

    private var cardState: ReviewCardState {
        .resolve(model.reviews, failure: model.reviewsFailure)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                DetailKicker(text: DetailReviews.kicker(othersCount: reviews.others.count))
                Spacer(minLength: Spacing.sm)
                // Up here rather than at the foot: the stop is one screen, and
                // on a small one its foot is what fades away.
                if !uncapped, let onAll, handsOff {
                    allPill(onAll)
                }
            }
            .id(DetailReviews.anchorID)

            MyReviewCard(
                state: cardState,
                uncapped: uncapped,
                onStars: { stars in write(.stars(stars)) },
                onCompose: { composing = ReviewComposerTarget.make(for: cardState) },
                onDelete: { Task { await model.deleteReview(uuid: book.uuid) } }
            )
            .padding(.top, 12)

            if let summary = reviews.summary {
                ReviewSummaryView(summary: summary, compact: !uncapped)
                    .padding(.top, uncapped ? 22 : 14)
            }

            if uncapped {
                others
            }
        }
        .sheet(item: $composing) { target in
            // `latest` follows the model, so an answer that lands while the
            // composer is open rebases it rather than going unseen.
            ReviewComposer(original: target.original, latest: cardState.review) { patch in
                write(patch)
            }
        }
    }

    @ViewBuilder
    private var others: some View {
        let written = DetailReviews.written(reviews.others)
        let starsOnly = DetailReviews.starsOnly(reviews.others)

        if !written.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(written) { review in
                    OtherReviewRow(review: review, viewerStatus: model.readStatus)
                }
            }
            .padding(.top, 18)
        }
        if !starsOnly.isEmpty {
            StarsOnlyRow(reviews: starsOnly)
                .padding(.top, written.isEmpty ? 22 : 16)
        }
    }

    /// The capped stop's hand-off to the sheet, styled as the Journals stop's
    /// Write pill; its touch target runs past the pill to 44pt.
    private func allPill(_ onAll: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            onAll()
        } label: {
            HStack(spacing: 5) {
                Text("ALL")
                    .font(.monoUI(9.5))
                    .tracking(1.3)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(palette.accentColor)
            .padding(.horizontal, 13)
            .frame(height: 30)
            .background(Capsule().fill(palette.accentColor.opacity(0.14)))
            .overlay(Capsule().strokeBorder(palette.accentColor.opacity(0.45), lineWidth: 0.5))
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .padding(.vertical, -7)
        .accessibilityLabel(DetailReviews.allLabel(othersCount: reviews.others.count))
        .accessibilityIdentifier("reviews-all")
    }

    /// Whether the capped stop leaves anything for the sheet: other readers,
    /// or the rest of your own text, which the stop clips to a few lines.
    private var handsOff: Bool {
        !reviews.others.isEmpty || reviews.mine.map(DetailReviews.hasWriting) == true
    }

    private func write(_ patch: ReviewPatch) {
        Task { await model.patchReview(patch, uuid: book.uuid) }
    }
}

/// What the composer opens on. `Identifiable` so the composer is an
/// item-driven sheet, which keeps the review it seeds from attached to the
/// presentation that carries it.
struct ReviewComposerTarget: Identifiable {
    let id = UUID()
    let original: Review?

    /// A target only once your review is known: a composer seeded from an
    /// unknown one would send typed text over whatever the server holds.
    static func make(for state: ReviewCardState) -> ReviewComposerTarget? {
        guard case .ready(let review) = state else { return nil }
        return ReviewComposerTarget(original: review)
    }
}

/// Why a reviews read settled with nothing to show.
enum ReviewsReadFailure: Equatable {
    /// No connection, and no replica to fall back on.
    case offline
    /// The server answered with something unusable — a refusal, a fault, a
    /// payload that did not decode.
    case failed

    /// The failure a finished read leaves behind, if any. A read that answered
    /// left none, and a cancelled one — the screen went away, or a reload
    /// replaced it — says nothing about the server either.
    static func classify(_ error: Error?, answered: Bool, cancelled: Bool) -> ReviewsReadFailure? {
        guard !answered, !cancelled, let error, !isCancellation(error) else { return nil }
        return (error as? APIError)?.isRecoverableOffline == true ? .offline : .failed
    }
}

/// Where your card stands. `nil` reviews are unknown — not yet read, or not
/// readable — which is not the same as having none.
enum ReviewCardState: Equatable {
    case loading
    case unavailable(ReviewsReadFailure)
    case ready(Review?)

    static func resolve(_ reviews: BookReviews?, failure: ReviewsReadFailure?) -> ReviewCardState {
        if let reviews { return .ready(reviews.mine) }
        return failure.map(ReviewCardState.unavailable) ?? .loading
    }

    /// Whether the stars and the pencil may write.
    var isInteractive: Bool {
        if case .ready = self { return true }
        return false
    }

    /// Your review when known; `nil` both for none and for unknown.
    var review: Review? {
        if case .ready(let review) = self { return review }
        return nil
    }
}

// MARK: - Your card

/// Your review: stars that save on tap, your text and private notes, and a
/// pencil and a trash can in the header. Nothing else is a control — the
/// spoiler flag is set in the editor, alongside the text it describes.
struct MyReviewCard: View {
    let state: ReviewCardState
    var uncapped = true
    var onStars: (Double) -> Void
    var onCompose: () -> Void
    var onDelete: () -> Void

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var confirmDelete = false
    @State private var dim = false

    private var review: Review? { state.review }

    /// Your text and notes as written, or `nil` when absent or blank.
    private var body_: String? { review?.bodyMd.flatMap { $0.nilIfBlank == nil ? nil : $0 } }
    private var notes: String? { review?.notesMd.flatMap { $0.nilIfBlank == nil ? nil : $0 } }

    var body: some View {
        Group {
            if uncapped {
                card(text: true, notes: true)
            } else {
                // The marquee's Stats stop is one screen. On a short one the
                // card gives up its notes, then its text, rather than running
                // under the swipe hint — the sheet behind ALL keeps both.
                ViewThatFits(in: .vertical) {
                    card(text: true, notes: true)
                    card(text: true, notes: false)
                    card(text: false, notes: false)
                }
            }
        }
        .confirmationDialog(
            "Delete your review?", isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            Button("Delete review", role: .destructive) { onDelete() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your stars, review and private notes are all removed.")
        }
    }

    private func card(text showsText: Bool, notes showsNotes: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            header

            if state.isInteractive {
                HStack(spacing: 12) {
                    StarRating(stars: review?.stars ?? 0, size: 22, interactive: true) { stars in
                        onStars(stars)
                    }
                    .accessibilityIdentifier("review-stars")
                    MonoNote(text: DetailReviews.starsNote(review?.stars))
                }
                .animation(Motion.snap, value: review?.stars)
            } else {
                unknownStars
            }

            if showsText, let body_ {
                text(body_)
                    .accessibilityIdentifier("review-text")
            }

            if showsNotes, let notes {
                privateNotes(notes)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .fill(palette.bg1Color.opacity(0.7))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .strokeBorder(palette.line2.color, lineWidth: 0.5)
        )
    }

    /// The stars row while your review is unknown: drawn, not live, and
    /// pulsing while a read is out — the app's placeholder, in the row's shape.
    private var unknownStars: some View {
        HStack(spacing: 12) {
            StarRating(stars: 0, size: 22)
                .opacity(0.35)
            MonoNote(text: DetailReviews.unknownNote(state))
        }
        .opacity(state == .loading && dim ? 0.55 : 1)
        .onAppear {
            guard state == .loading, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                dim = true
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("review-unknown")
    }

    /// Full in the flow; a few lines on the marquee's one-screen stop, where
    /// the rest is a tap away in the editor.
    @ViewBuilder
    private func text(_ md: String) -> some View {
        if uncapped {
            JournalBody(md: md)
        } else {
            Text(DetailReviews.excerpt(md))
                .font(.display(17))
                .foregroundStyle(palette.ink1Color)
                .lineSpacing(4)
                .lineLimit(3)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func privateNotes(_ md: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 9, weight: .semibold))
                RowLabel("Private notes · only you can see these")
            }
            .foregroundStyle(palette.ink3Color)
            .accessibilityElement(children: .combine)
            text(md)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .fill(palette.bg2Color.opacity(0.7))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .strokeBorder(
                    palette.ink3Color.opacity(0.45),
                    style: StrokeStyle(lineWidth: 0.75, dash: [3, 2])
                )
        )
        .accessibilityIdentifier("review-notes")
    }

    /// The label, then the pencil and — once there is a review to remove —
    /// the trash at the far edge. Each target is 44pt; the negative padding
    /// keeps that from pushing the row taller than its label.
    private var header: some View {
        HStack(spacing: 0) {
            RowLabel("Your review")
            Spacer(minLength: Spacing.sm)
            iconButton(
                "pencil", label: DetailReviews.composeLabel(review),
                identifier: "review-compose", tint: palette.ink1Color
            ) {
                Haptics.tap()
                onCompose()
            }
            .disabled(!state.isInteractive)
            .opacity(state.isInteractive ? 1 : 0.35)
            if review != nil {
                iconButton(
                    "trash", label: "Delete review",
                    identifier: "review-delete", tint: palette.badColor
                ) {
                    confirmDelete = true
                }
            }
        }
        .padding(.vertical, -12)
        .padding(.trailing, -12)
    }

    private func iconButton(
        _ symbol: String, label: String, identifier: String, tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
        .help(label)
        .accessibilityIdentifier(identifier)
    }
}

/// A checkbox, for the editor's one yes/no about the text — a switch reads as
/// a setting.
struct CheckboxToggleStyle: ToggleStyle {
    @Environment(\.palette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        Button {
            Haptics.select()
            configuration.isOn.toggle()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 15))
                    .foregroundStyle(configuration.isOn ? palette.accentColor : palette.ink3Color)
                configuration.label
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(configuration.isOn ? "On" : "Off")
        .accessibilityAddTraits(.isToggle)
    }
}

// MARK: - Household summary

/// The average, how many readers it is over, and the spread across the ten
/// half-star values. Compact on the marquee stop: the line alone.
struct ReviewSummaryView: View {
    let summary: ReviewSummary
    var compact = false

    @Environment(\.palette) private var palette

    var body: some View {
        if compact {
            HStack(spacing: 6) {
                RowLabel("Household")
                Image(systemName: "star.fill")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(palette.accentColor)
                Text(DetailReviews.titleLine(summary))
                    .font(.monoUI(10.5))
                    .foregroundStyle(palette.ink1Color)
            }
            .accessibilityElement(children: .combine)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                RowLabel("Household rating")
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(DetailReviews.average(summary.averageStars))
                        .font(.display(34, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                    VStack(alignment: .leading, spacing: 4) {
                        StarRating(stars: (summary.averageStars * 2).rounded() / 2, size: 11)
                        MonoNote(text: "average of \(StatsFormat.counted(summary.ratings, "reader"))")
                    }
                }
                .accessibilityElement(children: .combine)
                TrendStrip(
                    bars: DetailReviews.summaryBars(summary.buckets),
                    accessibilityLabel: "How readers rated it",
                    height: 64
                )
            }
            .accessibilityIdentifier("review-summary")
        }
    }
}

// MARK: - Other readers

/// Another reader's written review: who, their stars, when, and the text —
/// a few lines with Read more, or behind a spoiler warning until revealed.
struct OtherReviewRow: View {
    let review: AttributedReview
    let viewerStatus: ReadStatus

    @Environment(\.palette) private var palette
    @State private var revealed = false
    @State private var expanded = false
    /// The text's whole height, measured as set, so Read more appears exactly
    /// when the collapsed view would cut it — whatever the phone's width.
    @State private var fullHeight: CGFloat = 0

    private var hidden: Bool {
        !revealed && DetailReviews.hidesText(spoiler: review.spoiler, viewerStatus: viewerStatus)
    }

    var body: some View {
        let md = review.bodyMd ?? ""

        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 9) {
                byline
                if hidden {
                    spoilerCover
                } else if !DetailReviews.hasVisibleText(md) {
                    MonoNote(text: "an image — the app can't show review images yet")
                } else {
                    text(md)
                }
                if !hidden, DetailReviews.isTruncated(fullHeight: fullHeight) {
                    Button {
                        Haptics.tap()
                        withAnimation(Motion.snap) { expanded.toggle() }
                    } label: {
                        Text(expanded ? "SHOW LESS" : "READ MORE")
                            .font(.monoUI(9.5))
                            .tracking(1.3)
                            .foregroundStyle(palette.accentColor)
                            .padding(.vertical, 4)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 13)

            Hairline()
        }
    }

    /// The text set in full through the journal pipeline — formatting, lists,
    /// tappable `||spoilers||` — and, collapsed, cut at a fixed height with a
    /// fade rather than flattened into a summary.
    private func text(_ md: String) -> some View {
        let truncated = !expanded && DetailReviews.isTruncated(fullHeight: fullHeight)
        return JournalBody(md: md)
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fullHeight = $0 }
            .frame(
                maxHeight: expanded ? nil : DetailReviews.collapsedTextHeight,
                alignment: .top
            )
            .clipped()
            .mask {
                LinearGradient(
                    stops: [
                        .init(color: .black, location: 0),
                        .init(color: .black, location: truncated ? 0.7 : 1),
                        .init(color: truncated ? .clear : .black, location: 1),
                    ],
                    startPoint: .top, endPoint: .bottom
                )
            }
    }

    private var byline: some View {
        HStack(spacing: 10) {
            UserAvatar(
                id: review.userId, name: review.username, hasAvatar: review.hasAvatar, size: 26
            )
            VStack(alignment: .leading, spacing: 3) {
                Text(review.username)
                    .font(.ui(13, weight: .medium))
                    .foregroundStyle(palette.ink0Color)
                HStack(spacing: 7) {
                    if let stars = review.stars {
                        StarRating(stars: stars, size: 10)
                    }
                    MonoNote(text: Format.date(unix: review.updatedAt))
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var spoilerCover: some View {
        Button {
            Haptics.tap()
            withAnimation(Motion.snap) { revealed = true }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "eye.slash")
                    .font(.system(size: 12, weight: .semibold))
                Text("Contains spoilers")
                    .font(.ui(12.5, weight: .medium))
                Spacer(minLength: 0)
                Text("SHOW")
                    .font(.monoUI(9.5))
                    .tracking(1.3)
                    .foregroundStyle(palette.accentColor)
            }
            .foregroundStyle(palette.ink2Color)
            .padding(.horizontal, 12)
            .frame(height: 40)
            .background(
                RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                    .fill(palette.bg2Color.opacity(0.8))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("Review contains spoilers")
        .accessibilityHint("Shows the review")
        .accessibilityIdentifier("review-spoiler-cover")
    }
}

/// Everyone who rated without writing, in one compact row of avatars and
/// stars — however many there are, it scrolls rather than caps.
struct StarsOnlyRow: View {
    let reviews: [AttributedReview]

    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            RowLabel("Also rated")
            ScrollView(.horizontal) {
                HStack(spacing: 7) {
                    ForEach(reviews) { review in
                        chip(review)
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
        .accessibilityIdentifier("review-stars-only")
    }

    private func chip(_ review: AttributedReview) -> some View {
        HStack(spacing: 6) {
            UserAvatar(
                id: review.userId, name: review.username, hasAvatar: review.hasAvatar, size: 22
            )
            Image(systemName: "star.fill")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(palette.accentColor)
            Text((review.stars ?? 0).formatted())
                .font(.monoUI(11))
                .foregroundStyle(palette.ink1Color)
        }
        .padding(.leading, 4)
        .padding(.trailing, 10)
        .frame(height: 30)
        .background(Capsule().fill(palette.bg2Color.opacity(0.8)))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(review.username), \((review.stars ?? 0).formatted()) stars")
    }
}

// MARK: - The draft

/// What the composer holds: the three fields as typed, and the review they
/// are a change to. A save diffs against `baseline`, so the baseline has to
/// follow the server while the composer is open — a draft seeded from a stale
/// replica would otherwise send text over a review the writer never saw.
struct ReviewDraft: Equatable {
    enum Field: Hashable { case body, notes, spoiler }

    var body: String
    var notes: String
    var spoiler: Bool
    private(set) var baseline: Review?

    init(_ review: Review?) {
        body = review?.bodyMd ?? ""
        notes = review?.notesMd ?? ""
        spoiler = review?.spoiler ?? false
        baseline = review
    }

    /// What Save sends: the fields that differ from the baseline.
    var patch: ReviewPatch {
        .edits(from: baseline, body: body, notes: notes, spoiler: spoiler)
    }

    /// The fields typed over since the baseline.
    var touched: Set<Field> {
        var out: Set<Field> = []
        if body != (baseline?.bodyMd ?? "") { out.insert(.body) }
        if notes != (baseline?.notesMd ?? "") { out.insert(.notes) }
        if spoiler != (baseline?.spoiler ?? false) { out.insert(.spoiler) }
        return out
    }

    /// Move onto `latest`. A field you haven't touched follows it; one you
    /// have keeps what you typed, and comes back as a conflict when `latest`
    /// moved it too — so the composer can say so before a save replaces it.
    mutating func rebase(onto latest: Review?) -> Set<Field> {
        let typed = touched
        var conflicts: Set<Field> = []
        if (baseline?.bodyMd ?? "") != (latest?.bodyMd ?? "") {
            if typed.contains(.body) { conflicts.insert(.body) } else { body = latest?.bodyMd ?? "" }
        }
        if (baseline?.notesMd ?? "") != (latest?.notesMd ?? "") {
            if typed.contains(.notes) { conflicts.insert(.notes) } else { notes = latest?.notesMd ?? "" }
        }
        if (baseline?.spoiler ?? false) != (latest?.spoiler ?? false) {
            if typed.contains(.spoiler) {
                conflicts.insert(.spoiler)
            } else {
                spoiler = latest?.spoiler ?? false
            }
        }
        baseline = latest
        return conflicts
    }
}

// MARK: - Sheets

/// The whole block, uncapped — where the marquee's Stats stop hands off.
struct AllReviewsSheet: View {
    let book: Book
    let model: BookDetailModel

    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Reviews · \(book.displayTitle)")
                    .font(.ui(14, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(1)
                MonoNote(text: "every reader of this book can see stars and reviews")
            }
            .padding(.horizontal, 18)
            .padding(.top, 22)
            .padding(.bottom, 8)

            ScrollView {
                ReviewsBlock(book: book, model: model)
                    .padding(.horizontal, 18)
                    .padding(.top, 10)
                    .padding(.bottom, 34)
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(palette.bg1Color)
    }
}

/// Write or edit your review: the public text with its spoiler flag under it,
/// and your private notes, each in the journal's editor. Saves on Save, never
/// per keystroke, in one patch of what changed; the stars stay on the card,
/// where a tap saves them.
struct ReviewComposer: View {
    let original: Review?
    /// Your review as it stands now. The composer can open on the replica's
    /// first answer; a fresher one landing underneath it rebases the draft.
    var latest: Review?
    var onSave: (ReviewPatch) -> Void

    private enum Field { case body, notes }

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var draft = ReviewDraft(nil)
    /// Fields you had typed over that also changed elsewhere since.
    @State private var conflicts: Set<ReviewDraft.Field> = []
    @State private var didLoad = false
    @FocusState private var focus: Field?

    private var patch: ReviewPatch { draft.patch }

    private var isEditing: Bool {
        original.map(DetailReviews.hasWriting) ?? false
    }

    var body: some View {
        NavigationStack {
            // Whichever field has focus takes the room; the other keeps a few
            // lines in view, so both stay one tap away.
            VStack(spacing: 0) {
                if let note = DetailReviews.conflictNote(conflicts) {
                    MonoNote(text: note, color: palette.warnColor)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, Spacing.screen)
                        .padding(.top, Spacing.sm)
                        .accessibilityIdentifier("review-composer-conflict")
                }
                fieldHeader("Review", note: "every reader of this book can see it")
                MarkdownEditorField(text: $draft.body, placeholder: "What did you think?")
                    .focused($focus, equals: .body)
                    .frame(maxHeight: focus == .notes ? 110 : .infinity)
                    .accessibilityIdentifier("review-composer-body")

                // Under the text it describes, and nowhere else: the card in
                // read mode carries no spoiler control.
                Toggle(isOn: $draft.spoiler) {
                    Text("Contains spoilers")
                        .font(.ui(13.5))
                        .foregroundStyle(palette.ink1Color)
                }
                .toggleStyle(CheckboxToggleStyle())
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Spacing.screen)
                .padding(.vertical, 10)
                .accessibilityIdentifier("review-composer-spoiler")

                Hairline()

                fieldHeader("Private notes", note: "only you can see these", locked: true)
                MarkdownEditorField(text: $draft.notes, placeholder: "Notes for yourself")
                    .focused($focus, equals: .notes)
                    .frame(maxHeight: focus == .notes ? .infinity : 110)
                    .accessibilityIdentifier("review-composer-notes")
            }
            .animation(Motion.settle, value: focus)
            .background(ScreenBackground())
            .navigationTitle(isEditing ? "Edit review" : "Write a review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Haptics.success()
                        onSave(patch)
                        dismiss()
                    }
                    .disabled(patch.isEmpty)
                }
            }
        }
        .onAppear {
            // Seeded once, as the journal composer is: a re-appear must not
            // discard what has been typed.
            guard !didLoad else { return }
            didLoad = true
            draft = ReviewDraft(original)
            if latest != original { conflicts.formUnion(draft.rebase(onto: latest)) }
            focus = .body
        }
        .onChange(of: latest) { _, now in
            conflicts.formUnion(draft.rebase(onto: now))
        }
    }

    private func fieldHeader(_ title: String, note: String, locked: Bool = false) -> some View {
        HStack(spacing: 6) {
            if locked {
                Image(systemName: "lock.fill")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(palette.ink3Color)
            }
            RowLabel(title)
            Text("· \(note)")
                .font(.ui(11.5))
                .foregroundStyle(palette.ink3Color)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.screen)
        .padding(.top, Spacing.md)
        .padding(.bottom, 2)
        .accessibilityElement(children: .combine)
    }
}
