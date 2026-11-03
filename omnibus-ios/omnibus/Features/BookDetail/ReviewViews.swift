//  ReviewViews.swift
//  The Reviews tab: your review at the top, stars you can set where you see
//  them, then what the rest of the household made of the book.
//
//  Text is set from its Markdown source through the journal pipeline, so a
//  `||spoiler||` reads the same here as in a journal entry, and an edit still
//  waiting on the server reads the same as one it has rendered.

import SwiftUI

// MARK: - Pure derivations

/// What the household has said about a book, as the stage states it.
struct ReviewHeadline: Equatable {
    var average: Double
    var count: Int

    /// The average on the half-star grid the stars can draw.
    var rounded: Double { (average * 2).rounded() / 2 }
}

/// Copy and decisions behind the Reviews tab, kept off the views so the unit
/// suite can pin them.
enum DetailReviews {
    /// How tall another reader's text stands before Read more takes over.
    static let collapsedTextHeight: CGFloat = 116

    /// The stage's figure. The server's summary when it sends one; below its
    /// threshold there is none, so this is the mean of the ratings the page
    /// already lists — nothing a reader can't see further down.
    static func headline(_ reviews: BookReviews?) -> ReviewHeadline? {
        guard let reviews else { return nil }
        if let summary = reviews.summary {
            return ReviewHeadline(average: summary.averageStars, count: Int(summary.ratings))
        }
        let ratings = reviews.others.compactMap(\.stars) + [reviews.mine?.stars].compactMap { $0 }
        guard !ratings.isEmpty else { return nil }
        return ReviewHeadline(
            average: ratings.reduce(0, +) / Double(ratings.count), count: ratings.count
        )
    }

    /// The mean to one decimal, dropping a trailing zero: `4.5`, `4`.
    static func average(_ stars: Double) -> String {
        ((stars * 10).rounded() / 10).formatted()
    }

    /// The stage's rating said aloud, the one place its figures are put in words.
    static func headlineSpoken(_ headline: ReviewHeadline?, state: ReviewCardState) -> String {
        switch state {
        case .loading: return "Checking reviews…"
        case .unavailable(.offline): return "Reviews need a connection"
        case .unavailable(.failed): return "Couldn't load reviews"
        case .ready: break
        }
        guard let headline else { return "No reviews yet" }
        return "Average rating \(average(headline.average)) of 5, from "
            + StatsFormat.counted(Int64(headline.count), "review")
    }

    /// Whether your review holds text or notes, not just stars.
    static func hasWriting(_ review: Review) -> Bool {
        review.bodyMd?.nilIfBlank != nil || review.notesMd?.nilIfBlank != nil
    }

    /// The pencil's name: it starts a review as well as editing one.
    static func composeLabel(_ review: Review?) -> String {
        review.map(hasWriting) == true ? "Edit review" : "Write review"
    }

    /// The note under your stars while your review is unknown — true to why.
    static func unknownNote(_ state: ReviewCardState) -> String {
        switch state {
        case .unavailable(.offline): "Loads when you're back online."
        case .unavailable(.failed): "Couldn't load. Pull down to retry."
        default: "Loading your review…"
        }
    }

    /// The composer's warning when fields you were editing also changed
    /// elsewhere; `nil` when none did.
    static func conflictNote(_ fields: Set<ReviewDraft.Field>) -> String? {
        let names = [
            (ReviewDraft.Field.stars, "stars"),
            (.body, "review text"),
            (.notes, "private notes"),
            (.spoiler, "spoiler flag"),
        ].filter { fields.contains($0.0) }.map(\.1)
        guard !names.isEmpty else { return nil }
        let list = names.count == 1
            ? names[0]
            : names.dropLast().joined(separator: ", ") + " and " + names[names.count - 1]
        return "Your \(list) changed elsewhere while this was open. Save keeps yours."
    }

    /// Whether a change in connectivity should read the reviews again: only
    /// coming back online, and only while there is still nothing known.
    static func rereadsOnReconnect(wasOnline: Bool, isOnline: Bool, known: Bool) -> Bool {
        !wasOnline && isOnline && !known
    }

    /// The note under your stars.
    static func starsNote(_ stars: Double?) -> String {
        guard let stars, stars > 0 else {
            return "Not rated yet. Tap or drag the stars, half stars count."
        }
        return "You rated it \(stars.formatted())"
    }

    /// Whether a review's text starts collapsed behind its spoiler warning.
    /// Never for a reader who has finished the book — there is nothing left
    /// to spoil — and never for the stars, which the warning doesn't cover.
    static func hidesText(spoiler: Bool, viewerStatus: ReadStatus) -> Bool {
        spoiler && viewerStatus != .finished
    }

    /// A body as plain lines for a preview: every line run through the journal
    /// preview, so spoilers are already veiled and Markdown is resolved.
    static func excerpt(_ md: String) -> [MaskedRun] {
        let lines = md.replacingOccurrences(of: "\r\n", with: "\n")
            .split(separator: "\n")
            .map { DetailJournal.preview(String($0)) }
            .filter { !$0.isEmpty }
        return Array(lines.joined(separator: [.text("\n")]))
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
}

// MARK: - The tab

/// Everything on the Reviews tab.
struct BookReviewsTab: View {
    let book: Book
    let model: BookDetailModel
    /// Opens the review sheet, once your review is known.
    var onCompose: () -> Void

    @Environment(\.palette) private var palette

    private var reviews: BookReviews { model.reviews ?? .empty }

    private var cardState: ReviewCardState {
        .resolve(model.reviews, failure: model.reviewsFailure)
    }

    private var nobody: Bool {
        guard case .ready(let mine) = cardState else { return false }
        return reviews.others.isEmpty && mine?.stars == nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if nobody {
                VStack(alignment: .leading, spacing: 4) {
                    Text("No ratings or reviews yet")
                        .font(.display(26, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                    Text("Nobody in your household has rated or reviewed this book.")
                        .font(.ui(15))
                        .foregroundStyle(palette.ink1Color)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 2)
                .padding(.bottom, 20)
            }

            MyReviewCard(
                state: cardState,
                onStars: { stars in write(.stars(stars)) },
                onCompose: onCompose,
                onDelete: { Task { await model.deleteReview(uuid: book.uuid) } }
            )

            if !reviews.others.isEmpty {
                household
                    .padding(.top, 30)
            }
        }
    }

    private var household: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("Household")
                        .font(.display(30, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                        .accessibilityAddTraits(.isHeader)
                    Text("\(reviews.others.count)")
                        .font(.ui(17, weight: .medium))
                        .foregroundStyle(palette.ink2Color)
                }
                Spacer(minLength: 0)
                if let headline = DetailReviews.headline(model.reviews) {
                    Text("\(DetailReviews.average(headline.average)) average")
                        .font(.ui(15))
                        .foregroundStyle(palette.ink1Color)
                }
            }

            // In the server's order: text reviews first, newest first, then
            // bare ratings.
            ForEach(reviews.others) { review in
                OtherReviewRow(review: review, viewerStatus: model.readStatus)
            }
        }
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
        VStack(alignment: .leading, spacing: 0) {
            header

            if state.isInteractive {
                StarRating(
                    stars: review?.stars ?? 0,
                    size: 32,
                    interactive: true,
                    fillTint: palette.bookText,
                    emptyTint: palette.ink0Color.opacity(0.6),
                    starSpacing: 12
                ) { stars in
                    onStars(stars)
                }
                .frame(height: 46)
                .padding(.top, 2)
                .accessibilityIdentifier("review-stars")
                .animation(Motion.snap, value: review?.stars)

                note(DetailReviews.starsNote(review?.stars))
            } else {
                unknownStars
            }

            if let body_ {
                JournalBody(md: body_, face: .interface)
                    .padding(.top, 12)
                    .accessibilityIdentifier("review-text")
            }

            if let notes {
                privateNotes(notes)
                    .padding(.top, 12)
            }

            if body_ == nil, state.isInteractive {
                prompt
                    .padding(.top, 12)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.bg1Color))
        .confirmationDialog(
            "Delete your review?", isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { onDelete() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes your stars, your review and your private notes for good. This can't be undone.")
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.ui(14))
            .foregroundStyle(palette.ink1Color)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// The stars while your review is unknown: drawn, not live, and pulsing
    /// while a read is out — the app's placeholder, in the row's shape.
    private var unknownStars: some View {
        VStack(alignment: .leading, spacing: 0) {
            StarRating(
                stars: 0, size: 32, emptyTint: palette.ink0Color.opacity(0.6), starSpacing: 12
            )
            .frame(height: 46)
            .opacity(0.35)
            .padding(.top, 2)
            note(DetailReviews.unknownNote(state))
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

    private func privateNotes(_ md: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Image(systemName: "lock")
                    .font(.system(size: 11, weight: .semibold))
                Text("Private notes. Only you can see these.")
                    .font(.ui(13))
            }
            .foregroundStyle(palette.ink1Color)
            .accessibilityElement(children: .combine)
            JournalBody(md: md, face: .interface)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .strokeBorder(
                    palette.ink0Color.opacity(0.24),
                    style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                )
        )
        .accessibilityIdentifier("review-notes")
    }

    /// The way into writing when there is nothing written yet.
    private var prompt: some View {
        Button {
            Haptics.tap()
            onCompose()
        } label: {
            Text("What did you make of it?")
                .font(.ui(15))
                .foregroundStyle(palette.ink2Color)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(palette.bg0Color)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(palette.ink0Color.opacity(0.14), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("review-prompt")
    }

    /// The heading, then the pencil and — once there is a review to remove —
    /// the trash at the far edge.
    private var header: some View {
        HStack(spacing: 0) {
            Text("Your review")
                .font(.display(26, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: Spacing.sm)
            iconButton(
                "pencil", label: DetailReviews.composeLabel(review),
                identifier: "review-compose", tint: palette.ink0Color
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
        .padding(.trailing, -12)
        .frame(minHeight: 44)
    }

    private func iconButton(
        _ symbol: String, label: String, identifier: String, tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
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

/// A checkbox, for the sheet's one yes/no about the text — a switch reads as a
/// setting.
struct CheckboxToggleStyle: ToggleStyle {
    @Environment(\.palette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        Button {
            Haptics.select()
            configuration.isOn.toggle()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 20))
                    .foregroundStyle(configuration.isOn ? palette.bookText : palette.ink2Color)
                configuration.label
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(configuration.isOn ? "On" : "Off")
        .accessibilityAddTraits(.isToggle)
    }
}

// MARK: - Other readers

/// Another reader's rating and review: who, their stars, when, and the text — a
/// few lines with Read more, behind a spoiler warning until revealed, or noted
/// as a rating alone.
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

        HStack(alignment: .top, spacing: 14) {
            UserAvatar(
                id: review.userId, name: review.username, hasAvatar: review.hasAvatar, size: 40
            )

            VStack(alignment: .leading, spacing: 0) {
                byline

                if !review.hasText {
                    Text("Rated only")
                        .font(.ui(15))
                        .foregroundStyle(palette.ink2Color)
                        .padding(.top, 7)
                } else if hidden {
                    spoilerCover
                        .padding(.top, 6)
                } else if !DetailReviews.hasVisibleText(md) {
                    Text("An image. The app can't show review images yet.")
                        .font(.ui(15))
                        .foregroundStyle(palette.ink2Color)
                        .padding(.top, 7)
                } else {
                    text(md)
                        .padding(.top, 7)
                    if DetailReviews.isTruncated(fullHeight: fullHeight) {
                        readMore
                    }
                }
            }
        }
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            Rectangle().fill(palette.line.color).frame(height: 0.5)
        }
    }

    private var readMore: some View {
        Button {
            Haptics.tap()
            withAnimation(Motion.snap) { expanded.toggle() }
        } label: {
            Text(expanded ? "Show less" : "Read more")
                .font(.ui(15, weight: .semibold))
                .foregroundStyle(palette.ink1Color)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The text set in full through the journal pipeline — formatting, lists,
    /// tappable `||spoilers||` — and, collapsed, cut at a fixed height with a
    /// fade rather than flattened into a summary.
    private func text(_ md: String) -> some View {
        let truncated = !expanded && DetailReviews.isTruncated(fullHeight: fullHeight)
        return JournalBody(md: md, face: .interface)
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
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(review.username)
                    .font(.ui(16, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                Text(" · \(DetailFormat.day(unix: review.updatedAt))")
                    .font(.ui(14))
                    .foregroundStyle(palette.ink1Color)
            }
            if let stars = review.stars {
                HStack(spacing: 5) {
                    StageStars(stars: stars, size: 15)
                    Text(stars.formatted())
                        .font(.ui(14))
                        .foregroundStyle(palette.ink1Color)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(stars.formatted()) out of 5 stars")
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var spoilerCover: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                spoilerNote
                Spacer(minLength: 0)
                showReview
            }
            VStack(alignment: .leading, spacing: 0) {
                spoilerNote
                showReview
            }
        }
    }

    private var spoilerNote: some View {
        Text("This review gives away the story.")
            .font(.ui(15))
            .foregroundStyle(palette.ink1Color)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var showReview: some View {
        Button {
            Haptics.tap()
            withAnimation(Motion.snap) { revealed = true }
        } label: {
            Text("Show review")
                .font(.ui(15, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .fixedSize()
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("review-spoiler-cover")
    }
}
