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

    /// Lines an excerpt shows before Read more takes over.
    static let excerptLines = 4

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
            .map { JournalRow.preview(String($0)) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }

    /// Characters a line of the excerpt holds on a phone, for estimating wraps.
    static let excerptLineChars = 44

    /// Whether the collapsed excerpt is likely to cut the text short — the
    /// cue for Read more. An estimate, counting each line's wraps.
    static func isLong(_ md: String) -> Bool {
        let lines = excerpt(md).split(separator: "\n").reduce(0) { total, line in
            total + max(1, (line.count + excerptLineChars - 1) / excerptLineChars)
        }
        return lines > excerptLines
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
/// keeps your card and hands everyone else's to the sheet.
struct ReviewsBlock: View {
    let book: Book
    let model: BookDetailModel
    var uncapped = true
    /// Opens the all-reviews sheet; only the capped block offers it.
    var onAll: (() -> Void)?

    @State private var composing: ReviewComposerTarget?

    private var reviews: BookReviews { model.reviews ?? .empty }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            DetailKicker(text: DetailReviews.kicker(othersCount: reviews.others.count))
                .id(DetailReviews.anchorID)

            MyReviewCard(
                review: reviews.mine,
                uncapped: uncapped,
                onStars: { stars in write(.stars(stars)) },
                onSpoiler: { spoiler in write(ReviewPatch(spoiler: spoiler)) },
                onCompose: { composing = ReviewComposerTarget(original: reviews.mine) },
                onDelete: { Task { await model.deleteReview(uuid: book.uuid) } }
            )
            .padding(.top, 12)

            if let summary = reviews.summary {
                ReviewSummaryView(summary: summary, compact: !uncapped)
                    .padding(.top, uncapped ? 22 : 14)
            }

            if uncapped {
                others
            } else if let onAll, handsOff {
                MoreRowButton(
                    label: DetailReviews.allLabel(othersCount: reviews.others.count),
                    identifier: "reviews-all"
                ) { onAll() }
            }
        }
        .sheet(item: $composing) { target in
            ReviewComposer(original: target.original) { patch in
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
}

// MARK: - Your card

/// Your review: stars that save on tap, your text and private notes, the
/// spoiler flag once there is text, and Write / Edit / Delete.
struct MyReviewCard: View {
    let review: Review?
    var uncapped = true
    var onStars: (Double) -> Void
    var onSpoiler: (Bool) -> Void
    var onCompose: () -> Void
    var onDelete: () -> Void

    @Environment(\.palette) private var palette
    @State private var confirmDelete = false

    /// Your text and notes as written, or `nil` when absent or blank.
    private var body_: String? { review?.bodyMd.flatMap { $0.nilIfBlank == nil ? nil : $0 } }
    private var notes: String? { review?.notesMd.flatMap { $0.nilIfBlank == nil ? nil : $0 } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            RowLabel("Your review")

            HStack(spacing: 12) {
                StarRating(stars: review?.stars ?? 0, size: 22, interactive: true) { stars in
                    onStars(stars)
                }
                .accessibilityIdentifier("review-stars")
                MonoNote(text: DetailReviews.starsNote(review?.stars))
            }
            .animation(Motion.snap, value: review?.stars)

            if let body_ {
                text(body_)
                    .accessibilityIdentifier("review-text")
                Toggle(isOn: Binding(
                    get: { review?.spoiler ?? false },
                    set: { onSpoiler($0) }
                )) {
                    Text("Contains spoilers")
                        .font(.ui(12.5))
                        .foregroundStyle(palette.ink1Color)
                }
                .toggleStyle(CheckboxToggleStyle())
                .accessibilityIdentifier("review-spoiler")
            }

            if let notes {
                privateNotes(notes)
            }

            actions
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
        .confirmationDialog(
            "Delete your review?", isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            Button("Delete review", role: .destructive) { onDelete() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your stars, review and private notes are all removed.")
        }
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

    private var actions: some View {
        HStack(spacing: 10) {
            Button {
                Haptics.tap()
                onCompose()
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 10, weight: .semibold))
                    Text(body_ == nil && notes == nil ? "WRITE REVIEW" : "EDIT")
                        .font(.monoUI(9.5))
                        .tracking(1.3)
                }
                .foregroundStyle(palette.accentColor)
                .padding(.horizontal, 13)
                .frame(height: 30)
                .background(Capsule().fill(palette.accentColor.opacity(0.14)))
                .overlay(
                    Capsule().strokeBorder(palette.accentColor.opacity(0.45), lineWidth: 0.5)
                )
            }
            .buttonStyle(PressableStyle())
            .accessibilityIdentifier("review-compose")

            Spacer(minLength: 0)

            if review != nil {
                Button {
                    confirmDelete = true
                } label: {
                    Text("Delete review")
                        .font(.ui(12.5, weight: .medium))
                        .foregroundStyle(palette.badColor)
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("review-delete")
            }
        }
    }
}

/// A checkbox, for the one yes/no on the card — a switch reads as a setting.
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
                } else if expanded {
                    JournalBody(md: md)
                } else {
                    Text(DetailReviews.excerpt(md))
                        .font(.display(17))
                        .foregroundStyle(palette.ink1Color)
                        .lineSpacing(4)
                        .lineLimit(DetailReviews.excerptLines)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if !hidden, DetailReviews.isLong(md) {
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

/// Write or edit your review: the public text and your private notes, each
/// in the journal's editor, and the spoiler flag once there is text. Saves
/// on Save, never per keystroke; the stars stay on the card, where a tap
/// saves them.
struct ReviewComposer: View {
    let original: Review?
    var onSave: (ReviewPatch) -> Void

    private enum Field { case body, notes }

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var body_ = ""
    @State private var notes = ""
    @State private var spoiler = false
    @State private var didLoad = false
    @FocusState private var focus: Field?

    private var patch: ReviewPatch {
        .edits(from: original, body: body_, notes: notes, spoiler: spoiler)
    }

    private var isEditing: Bool {
        original.map(DetailReviews.hasWriting) ?? false
    }

    var body: some View {
        NavigationStack {
            // Whichever field has focus takes the room; the other keeps a few
            // lines in view, so both stay one tap away.
            VStack(spacing: 0) {
                fieldHeader("Review", note: "every reader of this book can see it")
                MarkdownEditorField(text: $body_, placeholder: "What did you think?")
                    .focused($focus, equals: .body)
                    .frame(maxHeight: focus == .notes ? 110 : .infinity)
                    .accessibilityIdentifier("review-composer-body")

                Hairline()

                fieldHeader("Private notes", note: "only you can see these", locked: true)
                MarkdownEditorField(text: $notes, placeholder: "Notes for yourself")
                    .focused($focus, equals: .notes)
                    .frame(maxHeight: focus == .notes ? .infinity : 110)
                    .accessibilityIdentifier("review-composer-notes")

                if body_.nilIfBlank != nil {
                    VStack(spacing: 0) {
                        Hairline()
                        Toggle(isOn: $spoiler) {
                            Text("Contains spoilers")
                                .font(.ui(14.5))
                                .foregroundStyle(palette.ink1Color)
                        }
                        .tint(palette.accentColor)
                        .padding(.horizontal, Spacing.screen)
                        .padding(.vertical, 11)
                    }
                    .background(palette.bg1Color)
                    .transition(.opacity)
                }
            }
            .animation(Motion.settle, value: focus)
            .animation(Motion.snap, value: body_.nilIfBlank == nil)
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
            body_ = original?.bodyMd ?? ""
            notes = original?.notesMd ?? ""
            spoiler = original?.spoiler ?? false
            focus = .body
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
