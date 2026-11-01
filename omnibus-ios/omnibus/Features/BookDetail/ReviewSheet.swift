//  ReviewSheet.swift
//  Write or edit your review: stars you drag across, the public text with its
//  spoiler flag, a kept line to quote, and private notes. Saves on Save, never
//  per keystroke, in one patch of what changed. Writing folds the stars down to
//  a thin row so the text gets the room the keyboard left.

import SwiftUI

// MARK: - The draft

/// What the sheet holds: the fields as set, and the review they are a change
/// to. A save diffs against `baseline`, so the baseline has to follow the server
/// while the sheet is open — a draft seeded from a stale replica would otherwise
/// send text over a review the writer never saw.
struct ReviewDraft: Equatable {
    enum Field: Hashable { case stars, body, notes, spoiler }

    /// Half stars; 0 is none.
    var stars: Double
    var body: String
    var notes: String
    var spoiler: Bool
    private(set) var baseline: Review?

    init(_ review: Review?) {
        stars = review?.stars ?? 0
        body = review?.bodyMd ?? ""
        notes = review?.notesMd ?? ""
        spoiler = review?.spoiler ?? false
        baseline = review
    }

    /// What Save sends: the fields that differ from the baseline.
    var patch: ReviewPatch {
        .edits(from: baseline, stars: stars, body: body, notes: notes, spoiler: spoiler)
    }

    /// The fields changed since the baseline — exactly the ones Save would
    /// send, so blank text over no text is no edit here either.
    var touched: Set<Field> {
        let edits = patch
        var out: Set<Field> = []
        if edits.stars != .unchanged { out.insert(.stars) }
        if edits.bodyMd != .unchanged { out.insert(.body) }
        if edits.notesMd != .unchanged { out.insert(.notes) }
        if edits.spoiler != nil { out.insert(.spoiler) }
        return out
    }

    /// Move onto `latest`. A field you haven't touched follows it; one you
    /// have keeps what you set, and comes back as a conflict when `latest`
    /// moved it too — so the sheet can say so before a save replaces it.
    /// The spoiler flag describes the text, so text you wrote keeps the flag it
    /// was written under, and a flag moved underneath it is a conflict.
    mutating func rebase(onto latest: Review?) -> Set<Field> {
        let typed = touched
        // Only text you wrote carries a flag; clearing the text leaves the
        // flag nothing to describe.
        let writesText: Bool = {
            if case .set = patch.bodyMd { return true }
            return false
        }()
        var conflicts: Set<Field> = []
        if (baseline?.stars ?? 0) != (latest?.stars ?? 0) {
            if typed.contains(.stars) { conflicts.insert(.stars) } else { stars = latest?.stars ?? 0 }
        }
        if (baseline?.bodyMd ?? "") != (latest?.bodyMd ?? "") {
            if typed.contains(.body) { conflicts.insert(.body) } else { body = latest?.bodyMd ?? "" }
        }
        if (baseline?.notesMd ?? "") != (latest?.notesMd ?? "") {
            if typed.contains(.notes) { conflicts.insert(.notes) } else { notes = latest?.notesMd ?? "" }
        }
        if (baseline?.spoiler ?? false) != (latest?.spoiler ?? false) {
            if typed.contains(.spoiler) || writesText {
                conflicts.insert(.spoiler)
            } else {
                spoiler = latest?.spoiler ?? false
            }
        }
        baseline = latest
        return conflicts
    }
}

// MARK: - The wording

enum ReviewWords {
    /// What a rating means, half star by half star.
    static func word(for stars: Double) -> String? {
        switch stars {
        case 0.5: "Not for me"
        case 1: "Didn\u{2019}t work for me"
        case 1.5: "Hard going"
        case 2: "Had its moments"
        case 2.5: "Mixed feelings"
        case 3: "Liked it"
        case 3.5: "Liked it a lot"
        case 4: "Really good"
        case 4.5: "Loved it"
        case 5: "A favorite"
        default: nil
        }
    }

    /// The compact row's note while writing.
    static func compactNote(_ stars: Double) -> String {
        guard stars > 0 else { return "Not rated yet" }
        return "\(stars.formatted()) · \(word(for: stars) ?? "")"
    }

    /// The same rating, said aloud.
    static func spoken(_ stars: Double) -> String {
        guard stars > 0 else { return "Not rated" }
        return "\(stars.formatted()) of 5, \(word(for: stars) ?? "")"
    }

    /// The value at `x` across a row `width` wide: always at least half a star,
    /// a dragged-to-nothing row being what a second tap is for.
    static func stars(at x: CGFloat, width: CGFloat) -> Double {
        guard width > 0 else { return 0.5 }
        let fraction = min(1, max(0, x / width))
        return max(0.5, (fraction * 10).rounded(.up) / 2)
    }

    /// Where the bubble over the row points, as a fraction of its width: the
    /// middle of the star, or the middle of its filled half.
    static func bubblePosition(_ stars: Double) -> CGFloat {
        let isHalf = stars.truncatingRemainder(dividingBy: 1) != 0
        return (CGFloat(stars.rounded(.up)) - 0.5 - (isHalf ? 0.25 : 0)) / 5
    }
}

/// The Markdown the writing bar inserts. Pure, so the caret arithmetic has a test.
enum ReviewMarkup {
    /// Wrap the selection in `marker`, or set an empty pair with the caret
    /// between them. Returns the new text and where the selection goes.
    static func wrap(
        _ text: String, selection: Range<String.Index>?, marker: String
    ) -> (text: String, selection: Range<String.Index>) {
        let range = selection ?? text.endIndex..<text.endIndex
        let picked = text[range]
        let before = text[text.startIndex..<range.lowerBound]
        let after = text[range.upperBound...]
        let next = before + marker + picked + marker + after
        let start = next.index(next.startIndex, offsetBy: before.count + marker.count)
        let end = next.index(start, offsetBy: picked.count)
        return (String(next), start..<end)
    }

    /// A kept line set as a quote above what is already written.
    static func quoted(_ passage: String, above body: String) -> String {
        let quote = passage
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { "> \($0)" }
            .joined(separator: "\n")
        return body.nilIfBlank == nil ? "\(quote)\n\n" : "\(quote)\n\n\(body)"
    }
}

// MARK: - The stars

/// Five stars you drag across. A tap lands where you touched, half stars
/// included, and a second tap on the value already set clears it. The row pops
/// as it changes, and a full five runs a wave along it.
struct ScrubStars: View {
    @Binding var stars: Double
    var starSize: CGFloat = 46
    var cellSize = CGSize(width: 54, height: 60)
    /// Whether a bubble rides over the row while it is being dragged.
    var showsBubble = true
    var identifier = "review-sheet-stars"

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scrubbing = false
    /// The value the touch came down on, for telling a tap on it from a change.
    @State private var startedOn: Double?
    @State private var pops = 0

    private var width: CGFloat { cellSize.width * 5 }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(1...5, id: \.self) { slot in
                star(slot)
                    .frame(width: cellSize.width, height: cellSize.height)
            }
        }
        .frame(width: width)
        .contentShape(Rectangle())
        .gesture(scrub)
        .overlay(alignment: .topLeading) {
            if showsBubble, scrubbing, stars > 0 {
                bubble
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Your rating, in half stars")
        .accessibilityValue(ReviewWords.spoken(stars))
        .accessibilityAdjustableAction { direction in
            let step = direction == .increment ? 0.5 : -0.5
            stars = min(5, max(0, stars + step))
        }
        .accessibilityIdentifier(identifier)
    }

    private func star(_ slot: Int) -> some View {
        let filled = Double(slot) <= stars
        let half = !filled && Double(slot) - 0.5 <= stars
        // The star just reached pops; a five runs the whole row in turn.
        let wave = stars == 5
        let isPopping = wave || slot == Int(stars.rounded(.up))
        let delay = wave ? Double(slot - 1) * 0.055 : 0

        return Image(systemName: filled ? "star.fill" : (half ? "star.leadinghalf.filled" : "star"))
            .font(.system(size: starSize * 0.86))
            .foregroundStyle(filled || half ? palette.bookText : palette.ink0Color.opacity(0.62))
            .frame(width: starSize, height: starSize)
            .scaleEffect(scrubbing && !reduceMotion ? 1.06 : 1)
            .animation(Motion.lift, value: scrubbing)
            .keyframeAnimator(initialValue: StarPop(), trigger: pops) { view, pop in
                view
                    .scaleEffect(reduceMotion ? 1 : pop.scale)
                    .rotationEffect(.degrees(reduceMotion ? 0 : pop.turn))
                    .offset(y: reduceMotion ? 0 : pop.lift)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    LinearKeyframe(1, duration: 0.001 + delay)
                    CubicKeyframe(isPopping && !wave ? 1.22 : 1, duration: 0.13)
                    CubicKeyframe(1, duration: 0.19)
                }
                KeyframeTrack(\.turn) {
                    LinearKeyframe(0, duration: 0.001 + delay)
                    CubicKeyframe(isPopping ? -6 : 0, duration: 0.13)
                    CubicKeyframe(0, duration: 0.19)
                }
                KeyframeTrack(\.lift) {
                    LinearKeyframe(0, duration: 0.001 + delay)
                    CubicKeyframe(wave ? -9 : 0, duration: 0.19)
                    CubicKeyframe(0, duration: 0.29)
                }
            }
    }

    private var bubble: some View {
        VStack(spacing: 0) {
            Text(stars.formatted())
                .font(.ui(14, weight: .semibold))
                .foregroundStyle(palette.bg0Color)
                .fixedSize()
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().fill(palette.ink0Color))
            Rectangle().fill(palette.ink0Color).frame(width: 2, height: 9)
        }
        .fixedSize()
        .alignmentGuide(.leading) { $0.width / 2 }
        .alignmentGuide(.top) { $0.height - 8 }
        .offset(x: width * ReviewWords.bubblePosition(stars))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// A zero-distance drag, so a tap resolves through the same mapping. A
    /// vertical-dominant one is someone scrolling, and rates nothing.
    private var scrub: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { drag in
                let vertical = abs(drag.translation.height) > 12
                    && abs(drag.translation.height) > abs(drag.translation.width)
                guard !vertical else {
                    // Put back what the touch set on its way down.
                    if let startedOn { stars = startedOn }
                    scrubbing = false
                    return
                }
                if startedOn == nil {
                    startedOn = stars
                    scrubbing = true
                }
                let next = ReviewWords.stars(at: drag.location.x, width: width)
                if next != stars { set(next) }
            }
            .onEnded { drag in
                let isTap = abs(drag.translation.width) < 4 && abs(drag.translation.height) < 4
                let value = ReviewWords.stars(at: drag.location.x, width: width)
                if let startedOn, StarRating.committed(value, current: startedOn, isTap: isTap) == 0 {
                    set(0)
                }
                startedOn = nil
                scrubbing = false
            }
    }

    private func set(_ value: Double) {
        stars = value
        guard value > 0 else { return }
        Haptics.select()
        pops += 1
    }
}

private struct StarPop {
    var scale: CGFloat = 1
    var turn: Double = 0
    var lift: CGFloat = 0
}

// MARK: - The sheet

struct ReviewSheet: View {
    let book: Book
    let original: Review?
    /// Your review as it stands now. The sheet can open on the replica's first
    /// answer; a fresher one landing underneath it rebases the draft.
    var latest: Review?
    /// The kept lines "From highlights" offers, newest first.
    var highlights: [Highlight] = []
    var chapters: [AlignmentEbookChapter] = []
    var onSave: (ReviewPatch) -> Void

    private enum Field { case body, notes }

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ReviewDraft(nil)
    /// Fields you had changed that also changed elsewhere since.
    @State private var conflicts: Set<ReviewDraft.Field> = []
    @State private var didLoad = false
    @State private var notesOpen = false
    @State private var showsPicker = false
    @State private var confirmDiscard = false
    @State private var selection: TextSelection?
    @FocusState private var focus: Field?

    private var dirty: Bool { !draft.patch.isEmpty }
    private var typing: Bool { focus == .body }

    private var quotable: [Highlight] {
        highlights.filter { KeptLineRow.quotable($0) != nil }
    }

    private var isEditing: Bool {
        original.map(DetailReviews.hasWriting) ?? false
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    if typing {
                        compactStars
                    } else {
                        identity
                        roomyStars
                    }

                    if let note = DetailReviews.conflictNote(conflicts) {
                        Text(note)
                            .font(.ui(13))
                            .foregroundStyle(palette.warnColor)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 8)
                            .accessibilityIdentifier("review-composer-conflict")
                    }

                    reviewField(available: geometry.size.height)

                    if !typing {
                        options
                        notes
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, typing ? 8 : 34)
                .animation(Motion.settle, value: typing)
                .animation(Motion.settle, value: notesOpen)
            }
            .scrollDisabled(typing)
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if focus != nil { writingBar }
        }
        .background(alignment: .top) { wash }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(Radius.xl)
        .presentationBackground(palette.bg1Color)
        .interactiveDismissDisabled(dirty)
        .sheet(isPresented: $showsPicker) {
            HighlightPickerSheet(highlights: quotable, chapters: chapters) { highlight in
                guard let passage = KeptLineRow.quotable(highlight) else { return }
                draft.body = ReviewMarkup.quoted(passage, above: draft.body)
                showsPicker = false
            }
        }
        .confirmationDialog(
            "Discard your review?", isPresented: $confirmDiscard, titleVisibility: .visible
        ) {
            Button("Discard", role: .destructive) { dismiss() }
            // No cancel role: the system would fold it away into a tap outside,
            // and this is the answer most readers want.
            Button("Keep editing") {}
        } message: {
            Text("Your stars and what you wrote here won\u{2019}t be saved.")
        }
        // The dialog's answers read in ink; the book's tone is too faint on a light ground.
        .tint(palette.ink0Color)
        .onAppear {
            // Seeded once: a re-appear must not discard what has been typed.
            guard !didLoad else { return }
            didLoad = true
            draft = ReviewDraft(original)
            notesOpen = original?.notesMd?.nilIfBlank != nil
            if latest != original { conflicts.formUnion(draft.rebase(onto: latest)) }
        }
        .onChange(of: latest) { _, now in
            conflicts.formUnion(draft.rebase(onto: now))
        }
    }

    // MARK: - Chrome

    private var header: some View {
        HStack(spacing: Spacing.md) {
            Button("Cancel") {
                if dirty {
                    confirmDiscard = true
                } else {
                    dismiss()
                }
            }
            .font(.ui(17, weight: .medium))
            .foregroundStyle(palette.ink0Color)
            .frame(minHeight: 44)
            .accessibilityIdentifier("review-sheet-cancel")

            Spacer(minLength: 0)

            Text(isEditing ? "Edit review" : "Your review")
                .font(.display(21, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .accessibilityAddTraits(.isHeader)

            Spacer(minLength: 0)

            Button {
                Haptics.success()
                onSave(draft.patch)
                dismiss()
            } label: {
                Text("Save")
                    .font(.ui(16, weight: .semibold))
                    .foregroundStyle(dirty ? .white : palette.ink0Color.opacity(0.58))
                    .frame(minWidth: 68, minHeight: 36)
                    .background(Capsule().fill(dirty ? palette.bookDeep : palette.quietFill))
                    .padding(.vertical, 4)
                    .contentShape(Capsule())
            }
            .buttonStyle(PressableStyle())
            .disabled(!dirty)
            .accessibilityIdentifier("review-sheet-save")
        }
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .padding(.top, 15)
    }

    /// The book's own color bleeding in at the top of the sheet.
    private var wash: some View {
        // `Color.clear` holds the frame: an image filling it reports its own,
        // taller size, which would stretch the fade past where the sheet clips.
        Color.clear
            .overlay {
                if book.coverURL != nil {
                    RemoteImage(
                        path: "/api/thumbs/\(book.uuid)/md",
                        alternates: ["/api/thumbs/\(book.uuid)/lg", "/api/thumbs/\(book.uuid)/sm"]
                    ) {
                        Color.clear
                    }
                    .scaleEffect(1.8)
                    .blur(radius: 28)
                    .saturation(1.3)
                    .brightness(palette.bg0.l > 0.5 ? 0 : -0.3)
                }
            }
            .overlay {
                LinearGradient(
                    stops: [
                        .init(color: palette.bg1Color.opacity(0.3), location: 0),
                        .init(color: palette.bg1Color, location: 0.96),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .frame(height: 240)
            .frame(maxWidth: .infinity)
            .clipped()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    // MARK: - What it's about

    private var identity: some View {
        VStack(spacing: 0) {
            BookCover(identity: CoverIdentity(book), size: .sm, cornerRadius: 3)
                .frame(width: 58, height: 86)
                .shadow(color: .black.opacity(0.55), radius: 10, x: 6, y: 9)
                .rotationEffect(.degrees(-2.5))
                .rotation3DEffect(.degrees(8), axis: (x: 0, y: 1, z: 0), perspective: 0.15)
                .accessibilityHidden(true)

            Text(book.displayTitle)
                .font(.display(24, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .multilineTextAlignment(.center)
                .padding(.top, 10)

            Text(book.authorDisplay)
                .font(.ui(14))
                .foregroundStyle(palette.ink1Color)
                .multilineTextAlignment(.center)
                .padding(.top, 3)
        }
        .padding(.top, 4)
        .frame(maxWidth: .infinity)
    }

    // MARK: - Stars

    private var roomyStars: some View {
        VStack(spacing: 0) {
            ScrubStars(stars: $draft.stars)
                .padding(.top, 16)

            Group {
                if draft.stars > 0 {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(draft.stars.formatted())
                            .font(.display(30, weight: .semibold))
                            .foregroundStyle(palette.ink0Color)
                            .contentTransition(.numericText(value: draft.stars))
                        Text(ReviewWords.word(for: draft.stars) ?? "")
                            .font(.ui(15))
                            .foregroundStyle(palette.ink1Color)
                    }
                } else {
                    Text("Tap or drag. Half stars count.")
                        .font(.ui(15))
                        .foregroundStyle(palette.ink1Color)
                        .padding(.top, 6)
                }
            }
            .frame(minHeight: 36)
            .animation(Motion.snap, value: draft.stars)
        }
    }

    private var compactStars: some View {
        HStack(spacing: 10) {
            ScrubStars(
                stars: $draft.stars, starSize: 24, cellSize: CGSize(width: 30, height: 44),
                showsBubble: false
            )
            Spacer(minLength: 0)
            Text(ReviewWords.compactNote(draft.stars))
                .font(.ui(14))
                .foregroundStyle(palette.ink1Color)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(minHeight: 44)
    }

    // MARK: - The review

    private func reviewField(available: CGFloat) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: Spacing.md) {
                Text("Review")
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                Spacer(minLength: 0)
                Text("Your household can read this")
                    .font(.ui(13))
                    .foregroundStyle(palette.ink1Color)
            }
            .frame(minHeight: 36)
            .accessibilityElement(children: .combine)

            TextEditor(text: $draft.body, selection: $selection)
                .font(.ui(16))
                .foregroundStyle(palette.ink0Color)
                .tint(palette.bookText)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .focused($focus, equals: .body)
                // Writing, the field takes what the keyboard left; otherwise a
                // few lines, so the options below stay on screen.
                .frame(height: typing ? max(120, available - 96) : 112)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.bg0Color)
                )
                .overlay(alignment: .topLeading) {
                    if draft.body.isEmpty {
                        placeholder("What did you make of it?")
                    }
                }
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(palette.ink0Color.opacity(0.18), lineWidth: 1)
                )
                .accessibilityLabel("Review")
                .accessibilityIdentifier("review-composer-body")
        }
        .padding(.top, typing ? 0 : 8)
    }

    private func placeholder(_ text: String) -> some View {
        Text(text)
            .font(.ui(16))
            .foregroundStyle(palette.ink2Color)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .allowsHitTesting(false)
    }

    private var options: some View {
        HStack(spacing: 10) {
            if !quotable.isEmpty {
                Button {
                    Haptics.tap()
                    showsPicker = true
                } label: {
                    fromHighlightsLabel
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("review-from-highlights")
            }
            Spacer(minLength: 0)
            Toggle(isOn: $draft.spoiler) {
                Text("Contains spoilers")
                    .font(.ui(15))
                    .foregroundStyle(palette.ink0Color)
            }
            .toggleStyle(CheckboxToggleStyle())
            .frame(minHeight: 44)
            .accessibilityIdentifier("review-composer-spoiler")
        }
        .frame(minHeight: 48)
    }

    private var fromHighlightsLabel: some View {
        HStack(spacing: 7) {
            RibbonShape()
                .fill(palette.bookText)
                .frame(width: 12, height: 20)
            Text("From highlights")
                .font(.ui(15, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .fixedSize()
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    // MARK: - Private notes

    @ViewBuilder
    private var notes: some View {
        if notesOpen {
            VStack(spacing: 0) {
                HStack(spacing: Spacing.md) {
                    HStack(spacing: 7) {
                        Image(systemName: "lock")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(palette.ink1Color)
                        Text("Private notes")
                            .font(.ui(15, weight: .semibold))
                            .foregroundStyle(palette.ink0Color)
                    }
                    Spacer(minLength: 0)
                    Text("Only you can see these")
                        .font(.ui(13))
                        .foregroundStyle(palette.ink1Color)
                }
                .frame(minHeight: 36)
                .accessibilityElement(children: .combine)

                TextEditor(text: $draft.notes)
                    .font(.ui(16))
                    .foregroundStyle(palette.ink0Color)
                    .tint(palette.bookText)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .focused($focus, equals: .notes)
                    .frame(height: 96)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.bg0Color)
                    )
                    .overlay(alignment: .topLeading) {
                        if draft.notes.isEmpty {
                            placeholder("Notes to yourself")
                        }
                    }
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(
                                palette.ink0Color.opacity(0.3),
                                style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                            )
                    )
                    .accessibilityLabel("Private notes")
                    .accessibilityIdentifier("review-composer-notes")
            }
            .padding(.top, 4)
            .transition(.opacity)
        } else {
            Button {
                Haptics.tap()
                notesOpen = true
                focus = .notes
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "lock")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(palette.ink1Color)
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Private notes")
                            .font(.ui(15, weight: .semibold))
                            .foregroundStyle(palette.ink0Color)
                        Text("Only you can see these")
                            .font(.ui(13))
                            .foregroundStyle(palette.ink1Color)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "plus")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(palette.ink1Color)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 56)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(
                            palette.ink0Color.opacity(0.26),
                            style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                        )
                )
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(PressableStyle())
            .padding(.top, 2)
            .accessibilityIdentifier("review-add-notes")
        }
    }

    // MARK: - The writing bar

    /// Rides the keyboard: the marks the journal's text understands, the
    /// highlights, and the way out of writing.
    private var writingBar: some View {
        HStack(spacing: 2) {
            if focus == .body {
                markButton("B", label: "Bold", font: .system(size: 18, weight: .bold, design: .serif)) {
                    mark("**")
                }
                markButton("I", label: "Italic", font: .system(size: 19, weight: .medium, design: .serif).italic()) {
                    mark("*")
                }
                markButton("||", label: "Wrap as a spoiler", font: .ui(17, weight: .semibold)) {
                    mark("||")
                }
                if !quotable.isEmpty {
                    Button {
                        Haptics.tap()
                        showsPicker = true
                    } label: {
                        HStack(spacing: 6) {
                            RibbonShape()
                                .fill(palette.bookText)
                                .frame(width: 11, height: 18)
                            Text("Highlights")
                                .font(.ui(15, weight: .semibold))
                                .foregroundStyle(palette.ink0Color)
                                .fixedSize()
                        }
                        .padding(.horizontal, 8)
                        .frame(height: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer(minLength: 0)
            Button("Done") {
                focus = nil
            }
            .font(.ui(16, weight: .semibold))
            .foregroundStyle(palette.bookText)
            .padding(.horizontal, 6)
            .frame(height: 44)
            .accessibilityIdentifier("review-writing-done")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 3)
        .background(palette.bg2Color)
        .overlay(alignment: .top) {
            Rectangle().fill(palette.ink0Color.opacity(0.12)).frame(height: 1)
        }
    }

    private func markButton(
        _ text: String, label: String, font: Font, action: @escaping () -> Void
    ) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Text(text)
                .font(font)
                .foregroundStyle(palette.ink0Color)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func mark(_ marker: String) {
        var range: Range<String.Index>?
        if case .selection(let picked)? = selection?.indices {
            range = picked
        }
        let result = ReviewMarkup.wrap(draft.body, selection: range, marker: marker)
        draft.body = result.text
        selection = TextSelection(range: result.selection)
    }
}

// MARK: - From highlights

/// The reader's kept lines, each a tap away from being quoted.
private struct HighlightPickerSheet: View {
    let highlights: [Highlight]
    let chapters: [AlignmentEbookChapter]
    var onPick: (Highlight) -> Void

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("From your highlights")
                    .font(.display(26, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Close")
            }
            .padding(.leading, 16)
            .padding(.trailing, 6)
            .padding(.top, 15)

            Text("Tap one to quote it in your review.")
                .font(.ui(14))
                .foregroundStyle(palette.ink1Color)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(highlights) { highlight in
                        row(highlight)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 34)
            }
            .scrollIndicators(.hidden)
        }
        .presentationDetents([.fraction(0.75), .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(Radius.xl)
        .presentationBackground(palette.bg2Color)
    }

    private func row(_ highlight: Highlight) -> some View {
        Button {
            Haptics.tap()
            onPick(highlight)
        } label: {
            VStack(alignment: .leading, spacing: 5) {
                Text(highlight.text ?? "")
                    .font(.display(20, weight: .medium))
                    .foregroundStyle(palette.ink0Color)
                    .multilineTextAlignment(.leading)
                Text(KeptLineRow.footer(
                    chapter: ChapterLocator.label(chapters: chapters, cfi: highlight.epubCFIRange),
                    createdAt: highlight.createdAt
                ))
                .font(.ui(14))
                .foregroundStyle(palette.ink1Color)
            }
            .padding(.vertical, 14)
            .padding(.trailing, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) {
                Rectangle().fill(palette.ink0Color.opacity(0.12)).frame(height: 1)
            }
            .overlay(alignment: .topTrailing) {
                RibbonShape()
                    .fill(highlight.color.tint)
                    .frame(width: 12, height: 28)
                    .offset(x: -2, y: -1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
    }
}
