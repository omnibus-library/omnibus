//  MetadataFetchCards.swift
//  The fetch view's vocabulary: an edition's cover, its list row and rail stop,
//  one row of the comparison, the per-source line, and what stands in while a
//  request is out. Every piece is a leaf — it takes values and closures, never
//  the network — so `MetadataFetchView` owns all the async work in one place.

import SwiftUI

// MARK: - Edition

/// An edition's art, or the tile that says it offered none.
struct EditionTile: View {
    let edition: ProviderEdition
    var width: CGFloat
    var height: CGFloat

    @Environment(\.palette) private var palette

    var body: some View {
        Group {
            if let url = MetadataFetchFlow.coverURL(edition) {
                ExternalImage(url: url) { noArt }
            } else {
                noArt
            }
        }
        .frame(width: width, height: height)
        .clipShape(UnevenRoundedRectangle(
            topLeadingRadius: 2, bottomLeadingRadius: 2, bottomTrailingRadius: 3, topTrailingRadius: 3
        ))
    }

    private var noArt: some View {
        Rectangle()
            .fill(palette.bg2Color)
            .overlay {
                Text("No art")
                    .font(.ui(13))
                    .foregroundStyle(palette.ink2Color)
            }
    }
}

/// One candidate. Selecting it is the row's only action, so the whole row is
/// the control.
struct EditionRow: View {
    let edition: ProviderEdition
    /// How many things this candidate would change: the one thing a list of
    /// near-identical printings can't tell you by looking.
    let changes: Int
    /// Where this row falls when the list is dealt out, or `nil` when it's
    /// already on the table.
    let deal: Int?
    let action: () -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                EditionTile(edition: edition, width: 52, height: 78)
                    .shadow(color: .black.opacity(0.5), radius: 7, x: 4, y: 6)
                    .rotationEffect(.degrees(-1.5))

                VStack(alignment: .leading, spacing: 3) {
                    Text(edition.title)
                        .font(.display(20, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                        .lineLimit(3)
                    // Open Library can credit every contributor to every edition
                    // of a work, dozens of names, so this has to stop somewhere.
                    Text(MetadataFetchFlow.metaLine(edition))
                        .font(.ui(14))
                        .foregroundStyle(palette.ink1Color)
                        .lineLimit(2)
                    Text("\(edition.source.displayName) \u{b7} \(MetadataFetchFlow.changesLabel(changes))")
                        .font(.ui(13))
                        .foregroundStyle(palette.ink1Color)
                }
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(palette.ink1Color)
            }
            .padding(.vertical, 12)
            .frame(minHeight: 102)
            .overlay(alignment: .top) {
                Rectangle().fill(palette.ink0Color.opacity(0.1)).frame(height: 1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .modifier(DealIn(index: deal))
        .accessibilityHint(MetadataFetchFlow.changesLabel(changes))
        .accessibilityIdentifier("fetch-edition-\(edition.id)")
    }
}

/// A row dealt onto the table from the right, one after another.
private struct DealIn: ViewModifier {
    let index: Int?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dealt = false

    func body(content: Content) -> some View {
        let held = index != nil && !reduceMotion && !dealt
        content
            .opacity(held ? 0 : 1)
            .rotationEffect(.degrees(held ? 4 : 0))
            .offset(x: held ? 46 : 0, y: held ? -10 : 0)
            .onAppear {
                withAnimation(
                    .timingCurve(0.16, 1, 0.3, 1, duration: 0.46).delay(Double(index ?? 0) * 0.09)
                ) {
                    dealt = true
                }
            }
    }
}

/// The other editions while comparing one, so a comparison is a tap from the
/// next without going back to the list.
struct EditionRail: View {
    let editions: [ProviderEdition]
    let selected: ProviderEdition
    let onPick: (ProviderEdition) -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .bottom, spacing: 14) {
                ForEach(editions) { edition in
                    stop(edition, isOn: edition.id == selected.id)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 8)
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -16)
        .padding(.top, 2)
    }

    private func stop(_ edition: ProviderEdition, isOn: Bool) -> some View {
        Button {
            guard !isOn else { return }
            onPick(edition)
        } label: {
            VStack(spacing: 7) {
                EditionTile(edition: edition, width: 72, height: 108)
                    .shadow(color: .black.opacity(0.5), radius: 9, x: 5, y: 8)
                    .scaleEffect(isOn ? 1.06 : 0.92, anchor: .bottom)
                    .offset(y: isOn ? -6 : 0)
                Text(edition.source.displayName)
                    .font(.ui(13, weight: isOn ? .semibold : .medium))
                    .foregroundStyle(isOn ? palette.ink0Color : palette.ink1Color)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(height: 32, alignment: .top)
            }
            .frame(width: 72)
            .opacity(isOn ? 1 : 0.62)
            .overlay(alignment: .topTrailing) {
                if isOn {
                    RibbonShape()
                        .fill(palette.bookText)
                        .frame(width: 12, height: 26)
                        .shadow(color: .black.opacity(0.5), radius: 1, x: 1, y: 2)
                        .offset(x: -8, y: -10)
                }
            }
            .animation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.42), value: isOn)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(edition.title), from \(edition.source.displayName)")
        .accessibilityAddTraits(isOn ? .isSelected : [])
        .accessibilityIdentifier("fetch-rail-\(edition.id)")
    }
}

// MARK: - Comparison

/// One thing an edition would change, with the tick that takes it.
struct EditionDiffRow: View {
    let row: MetadataDiffRow
    let isOn: Bool
    let book: Book
    let staged: StagedCover?
    let onToggle: () -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: onToggle) {
            HStack(alignment: .top, spacing: 12) {
                tick.padding(.top, 1)

                VStack(alignment: .leading, spacing: 2) {
                    Text(row.label)
                        .font(.ui(14, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                    if case let .cover(url) = row.kind {
                        cover(url).padding(.top, 4)
                    } else {
                        if !row.fills {
                            Text(row.before)
                                .font(.ui(14))
                                .foregroundStyle(palette.ink1Color)
                                .strikethrough(true, color: palette.ink1Color.opacity(0.6))
                                .lineLimit(3)
                        }
                        Text(row.after)
                            .font(.ui(16))
                            .foregroundStyle(palette.ink0Color)
                            .lineLimit(3)
                    }
                }
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)
            }
            .padding(.vertical, 11)
            .overlay(alignment: .top) {
                Rectangle().fill(palette.ink0Color.opacity(0.1)).frame(height: 1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
        .accessibilityIdentifier("fetch-row-\(row.id)")
    }

    private var tick: some View {
        RoundedRectangle(cornerRadius: 5, style: .continuous)
            .fill(isOn ? palette.bookFill : .clear)
            .overlay {
                if isOn {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                } else {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .strokeBorder(palette.ink0Color.opacity(0.4), lineWidth: 1.5)
                }
            }
            .frame(width: 22, height: 22)
    }

    private func cover(_ url: String) -> some View {
        HStack(spacing: 10) {
            if row.fills {
                RoundedRectangle(cornerRadius: 2)
                    .fill(palette.bg2Color)
                    .overlay {
                        Text("None")
                            .font(.ui(11))
                            .foregroundStyle(palette.ink2Color)
                    }
                    .frame(width: 38, height: 57)
            } else {
                EditCoverArt(book: book, staged: staged)
                    .frame(width: 38, height: 57)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                    .accessibilityLabel("Current cover")
            }

            Image(systemName: "arrow.right")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(palette.ink1Color)

            ExternalImage(url: url) { Rectangle().fill(palette.bg2Color) }
                .frame(width: 46, height: 69)
                .clipShape(RoundedRectangle(cornerRadius: 2))
                .shadow(color: .black.opacity(0.45), radius: 6, x: 3, y: 5)
                .rotationEffect(.degrees(-1.5))
                .accessibilityLabel("New cover")

            Text("Fetched when you press Save")
                .font(.ui(13))
                .foregroundStyle(palette.ink1Color)
        }
    }
}

// MARK: - Per-source line

/// What each source contributed.
///
/// It exists because a short list has several causes and they are not
/// interchangeable: a provider that answered with nothing and one that could not
/// be reached look identical from the list alone. A source this instance never
/// asked is left out; the button that opened this view already named who is.
struct FetchSourceLine: View {
    let sources: [ProviderSearchSource]

    @Environment(\.palette) private var palette

    private var asked: [ProviderSearchSource] {
        sources.filter { $0.status != .notConfigured }
    }

    /// A phone has no hover, so a failure's own message is printed under the
    /// line rather than riding along as a tooltip.
    private var failures: [String] {
        asked.compactMap { source in
            guard case let .failed(message) = source.status, let text = message.nilIfBlank else {
                return nil
            }
            return "\(source.displayName): \(text)"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            FlowLayout(spacing: 12, lineSpacing: 3) {
                ForEach(asked) { source in
                    let status = MetadataFetchFlow.sourceStatus(source.status)
                    Text("\(source.displayName) \(status.text)")
                        .font(.ui(14))
                        .foregroundStyle(status.isProblem ? palette.warnColor : palette.ink1Color)
                }
            }
            ForEach(failures, id: \.self) { line in
                Text(line)
                    .font(.ui(13))
                    .foregroundStyle(palette.ink1Color)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("fetch-sources")
    }
}

// MARK: - Placeholders

/// What a request is waiting on, in words beside a spinner.
struct FetchWaitLine: View {
    let text: String

    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 9) {
            ProgressView().controlSize(.small).tint(palette.ink1Color)
            Text(text)
                .font(.ui(15))
                .foregroundStyle(palette.ink1Color)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The opacity both placeholders breathe at, still under reduced motion.
private struct FetchPulse: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    func body(content: Content) -> some View {
        content
            .opacity(dim ? 0.5 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                    dim = true
                }
            }
            .accessibilityHidden(true)
    }
}

/// The list's shape without its content, so the real rows land where the eye
/// is already looking.
struct MetadataFetchSkeleton: View {
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<3, id: \.self) { _ in
                HStack(alignment: .top, spacing: 12) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(palette.bg2Color)
                        .frame(width: 52, height: 78)
                    GeometryReader { geometry in
                        VStack(alignment: .leading, spacing: 0) {
                            bar(geometry.size.width * 0.72, height: 16)
                            bar(geometry.size.width * 0.88, height: 12).padding(.top, 10)
                            bar(geometry.size.width * 0.4, height: 12).padding(.top, 8)
                        }
                        .padding(.top, 4)
                    }
                }
                .frame(height: 78)
                .padding(.vertical, 12)
                .overlay(alignment: .top) {
                    Rectangle().fill(palette.ink0Color.opacity(0.1)).frame(height: 1)
                }
            }
        }
        .modifier(FetchPulse())
    }

    private func bar(_ width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(palette.bg2Color)
            .frame(width: width, height: height)
    }
}

/// Three lines of nothing yet, while one record is re-fetched.
struct FetchPulseBars: View {
    @Environment(\.palette) private var palette

    var body: some View {
        GeometryReader { geometry in
            VStack(alignment: .leading, spacing: 12) {
                ForEach([0.92, 0.7, 0.82], id: \.self) { share in
                    RoundedRectangle(cornerRadius: 4)
                        .fill(palette.bg2Color)
                        .frame(width: geometry.size.width * share, height: 14)
                }
            }
        }
        .frame(height: 66)
        .modifier(FetchPulse())
    }
}
