//  BookOverviewTab.swift
//  The Overview tab: what the book is, how it is filed, your reading of it, who
//  else in the household has been in it, and where to go next — the rest of its
//  series, more by its author, and what other readers paired it with.

import SwiftUI

struct BookOverviewTab: View {
    let book: Book
    let model: BookDetailModel
    /// Opens the quick editor for a chip row. `nil` for a reader who can't
    /// edit metadata, which also keeps the "+" off those rows.
    var onEditChips: ((ChipEditKind) -> Void)?
    /// Whether the "+" on those rows is live — off while offline.
    var chipEditsOnline = true
    /// How far above the series section a jump to it has to aim, for the
    /// section to land below the pinned tabs rather than under them.
    var jumpClearance: CGFloat = 0
    var onShelves: () -> Void

    @Environment(\.palette) private var palette

    private var record: DetailReadRecord? { DetailStats.record(from: model.sessions) }

    private var seriesBooks: [Book] {
        model.seriesBooks.sorted {
            (Double($0.seriesIndex ?? "") ?? 0) < (Double($1.seriesIndex ?? "") ?? 0)
        }
    }

    private var shelves: [ShelfSummary] {
        model.allShelves.filter { model.shelvesContaining.contains($0.id) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let description = book.description?.nilIfBlank?.strippingHTML.nilIfBlank {
                StageBlurb(text: description)
            }

            chipRows
                .padding(.top, 8)

            readingCard
                .padding(.top, 28)

            if !model.household.isEmpty {
                activity
                    .padding(.top, 28)
            }

            if book.series?.nilIfBlank != nil, seriesBooks.count > 1 {
                SeriesFan(book: book, members: seriesBooks)
                    .padding(.top, 40)
                    .background(alignment: .top) {
                        Color.clear
                            .frame(height: jumpClearance)
                            .alignmentGuide(.top) { $0[.bottom] }
                            .id(BookDetailView.seriesAnchor)
                    }
            }

            if !model.authorBooks.isEmpty {
                moreByAuthor
                    .padding(.top, 40)
            }

            if !model.isWishlistOnly {
                ReadAlikes(book: book, suggestions: model.suggestions)
            }
        }
    }

    // MARK: - Chips

    private var chipRows: some View {
        VStack(alignment: .leading, spacing: 0) {
            if DetailRead.showsChipRow(values: book.genres, canEdit: onEditChips != nil) {
                ChipRow(label: "Genres") {
                    ForEach(book.genres, id: \.self) { genre in
                        NavigationLink(value: Destination.genre(name: genre)) {
                            StageChip(label: genre)
                        }
                        .buttonStyle(PressableStyle())
                    }
                    if let onEditChips {
                        AddChip(kind: .genres, enabled: chipEditsOnline) { onEditChips(.genres) }
                    }
                }
                .accessibilityIdentifier("book-detail-genres")
            }
            if DetailRead.showsChipRow(values: book.subjects, canEdit: onEditChips != nil) {
                ChipRow(label: "Tags") {
                    ForEach(book.subjects, id: \.self) { subject in
                        NavigationLink(value: Destination.tag(name: subject)) {
                            StageChip(label: subject)
                        }
                        .buttonStyle(PressableStyle())
                    }
                    if let onEditChips {
                        AddChip(kind: .tags, enabled: chipEditsOnline) { onEditChips(.tags) }
                    }
                }
                .accessibilityIdentifier("book-detail-tags")
            }
            ChipRow(label: "Shelves") {
                ForEach(shelves) { shelf in
                    NavigationLink(value: Destination.shelf(id: shelf.id)) {
                        StageChip(label: shelf.name)
                    }
                    .buttonStyle(PressableStyle())
                }
                AddCircle(
                    label: "Add to a shelf", identifier: "book-detail-add-shelf", action: onShelves
                )
            }
            .accessibilityIdentifier("book-detail-shelves")
        }
    }

    // MARK: - Your reading

    private var percent: Int? { model.fraction.map { Int($0 * 100) } }

    private var readingCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Your reading")
                .font(.display(26, weight: .semibold))
                .foregroundStyle(palette.ink0Color)

            Text(DetailStats.readingLine(
                status: model.readStatus,
                wishlistOnly: model.isWishlistOnly,
                hasFile: model.hasFile,
                hasPhysical: book.hasPhysical,
                hasPosition: model.hasPosition,
                record: record,
                finishedAt: model.finishedAt
            ))
            .font(.ui(15))
            .foregroundStyle(palette.ink1Color)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 4)

            if let record, !model.isWishlistOnly {
                ReadingStats(
                    rows: DetailStats.rows(
                        record: record, percent: percent, status: model.readStatus
                    ),
                    sessions: model.sessions
                )
                .padding(.top, 16)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.bg1Color)
        )
    }

    // MARK: - Activity

    private var activity: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Activity")
                .font(.display(22, weight: .semibold))
                .foregroundStyle(palette.ink0Color)

            ForEach(model.household) { reader in
                HStack(alignment: .top, spacing: 12) {
                    UserAvatar(
                        id: reader.id, name: reader.name, hasAvatar: reader.hasAvatar, size: 32
                    )
                    VStack(alignment: .leading, spacing: 0) {
                        Text(reader.name)
                            .font(.ui(15, weight: .semibold))
                            .foregroundStyle(palette.ink0Color)
                        Text(DetailStats.activityLine(reader))
                            .font(.ui(14))
                            .foregroundStyle(palette.ink1Color)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    // MARK: - More by

    private var moreByAuthor: some View {
        VStack(alignment: .leading, spacing: 8) {
            StageSectionHeader(title: "More by \(book.creators.first?.name ?? book.authorDisplay)") {
                if let author = DetailRead.linkedCreators(book.creators).first {
                    NavigationLink(value: Destination.author(id: author.id)) {
                        StageSectionLink(label: "Author page")
                    }
                    .buttonStyle(.plain)
                }
            }

            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(model.authorBooks.prefix(12)) { other in
                        NavigationLink(value: Destination.book(uuid: other.uuid)) {
                            StageShelfCard(
                                cover: BookCover(
                                    identity: CoverIdentity(other), size: .md, cornerRadius: 4
                                ),
                                title: other.displayTitle,
                                meta: other.year
                            )
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 6)
            }
            .scrollIndicators(.hidden)
            .padding(.horizontal, -16)
        }
    }
}

// MARK: - Pieces

/// A section's serif heading with its one link set against the far edge.
struct StageSectionHeader<Link: View>: View {
    let title: String
    @ViewBuilder var link: () -> Link

    @Environment(\.palette) private var palette

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(title)
                .font(.display(30, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            link()
        }
    }
}

/// The `Series page ›` look.
struct StageSectionLink: View {
    let label: String

    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 3) {
            Text(label)
                .font(.ui(15, weight: .semibold))
                .fixedSize()
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .bold))
        }
        .foregroundStyle(palette.ink1Color)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

/// A cover with its caption, on a shelf that runs off the edge.
struct StageShelfCard<Cover: View>: View {
    let cover: Cover
    let title: String
    var meta: String?

    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            cover
                .frame(width: 112, height: 164)
                .shadow(color: .black.opacity(0.4), radius: 1.5, y: 2)
                .shadow(color: .black.opacity(0.5), radius: 9, x: 6, y: 10)
            Text(title)
                .font(.ui(14, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .padding(.top, 9)
            if let meta {
                Text(meta)
                    .font(.ui(13))
                    .foregroundStyle(palette.ink1Color)
                    .lineLimit(1)
                    .padding(.top, 2)
            }
        }
        .frame(width: 112, alignment: .leading)
    }
}

/// The blurb, three lines until it is asked for more. The toggle shows only
/// when the text actually runs past them, at this phone's width.
private struct StageBlurb: View {
    let text: String

    @Environment(\.palette) private var palette
    @State private var open = false
    @State private var fullHeight: CGFloat = 0
    @State private var clampedHeight: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            copy
                .lineLimit(open ? nil : 3)
                .background { measures }

            if fullHeight > clampedHeight + 1 {
                Button {
                    Haptics.tap()
                    withAnimation(Motion.settle) { open.toggle() }
                } label: {
                    Text(open ? "Show less" : "Show more")
                        .font(.ui(15, weight: .semibold))
                        .foregroundStyle(palette.ink1Color)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("book-blurb-toggle")
            }
        }
    }

    private var copy: some View {
        Text(text)
            .font(.ui(16))
            .foregroundStyle(palette.ink1Color)
            .lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var measures: some View {
        ZStack {
            copy.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fullHeight = $0 }
            copy.lineLimit(3)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { clampedHeight = $0 }
        }
        .hidden()
    }
}

/// One filing row: its name, then its chips running off the edge.
private struct ChipRow<Chips: View>: View {
    let label: String
    @ViewBuilder var chips: () -> Chips

    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.ui(15, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .frame(width: 64, alignment: .leading)
            ScrollView(.horizontal) {
                HStack(spacing: 8) { chips() }
                    .padding(.trailing, 16)
            }
            .scrollIndicators(.hidden)
            .padding(.trailing, -16)
        }
    }
}

/// A filing chip. Sized for a finger while drawn smaller than that.
struct StageChip: View {
    let label: String

    @Environment(\.palette) private var palette

    var body: some View {
        Text(label)
            .font(.ui(15, weight: .medium))
            .foregroundStyle(palette.ink0Color)
            .lineLimit(1)
            .padding(.horizontal, 13)
            .frame(height: 34)
            .overlay(Capsule().strokeBorder(palette.ink0Color.opacity(0.24), lineWidth: 1))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
    }
}

/// The rows of the Your reading card, and the sittings behind them.
private struct ReadingStats: View {
    let rows: [DetailStatRow]
    let sessions: [SessionLogEntry]

    @Environment(\.palette) private var palette
    @State private var showsSessions = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(palette.line.color).frame(height: 0.5)

            ForEach(rows) { row in
                HStack(alignment: .firstTextBaseline, spacing: 16) {
                    Text(row.key)
                        .foregroundStyle(palette.ink1Color)
                    Spacer(minLength: 0)
                    Text(row.value)
                        .font(.ui(15, weight: .medium))
                        .foregroundStyle(palette.ink0Color)
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                }
                .font(.ui(15))
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(palette.line.color).frame(height: 0.5)
                }
                .accessibilityElement(children: .combine)
            }

            if showsSessions {
                ForEach(sessions) { session in
                    HStack(alignment: .firstTextBaseline, spacing: 16) {
                        Text(DetailFormat.lastRead(unix: session.startedAt))
                            .foregroundStyle(palette.ink1Color)
                        Spacer(minLength: 0)
                        Text(DetailFormat.duration(session.seconds))
                            .foregroundStyle(palette.ink0Color)
                            .monospacedDigit()
                    }
                    .font(.ui(14))
                    .padding(.vertical, 8)
                    .accessibilityElement(children: .combine)
                }
                .transition(.opacity)
            }

            Button {
                Haptics.tap()
                withAnimation(Motion.settle) { showsSessions.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Text(showsSessions ? "Hide sessions" : "Show sessions")
                        .font(.ui(15, weight: .semibold))
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .bold))
                        .rotationEffect(.degrees(showsSessions ? 180 : 0))
                }
                .foregroundStyle(palette.ink1Color)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 6)
            .accessibilityIdentifier("book-show-sessions")
        }
    }
}

// MARK: - The series fan

/// The series as a hand of covers: gathered at rest with this book raised, and
/// spread to walk through. Pure geometry lives in `SeriesFanLayout`.
private struct SeriesFan: View {
    let book: Book
    let members: [Book]

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spread = false

    private var position: Int? { members.firstIndex { $0.id == book.id } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            StageSectionHeader(title: "\(book.series ?? "") series") {
                if let id = book.seriesId {
                    NavigationLink(value: Destination.series(id: id)) {
                        StageSectionLink(label: "Series page")
                    }
                    .buttonStyle(.plain)
                }
            }

            GeometryReader { geometry in
                let width = geometry.size.width

                ScrollView(.horizontal) {
                    ZStack(alignment: .topLeading) {
                        ForEach(Array(members.enumerated()), id: \.element.id) { index, member in
                            card(member, index: index, width: width)
                        }
                    }
                    .frame(
                        width: spread
                            ? SeriesFanLayout.spreadWidth(count: members.count) : width,
                        height: spread ? SeriesFanLayout.spreadHeight : SeriesFanLayout.gatheredHeight,
                        alignment: .topLeading
                    )
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                }
                .scrollDisabled(!spread)
                .scrollIndicators(.hidden)
                .scrollClipDisabled()
                .padding(.horizontal, -16)
            }
            .frame(height: (spread ? SeriesFanLayout.spreadHeight : SeriesFanLayout.gatheredHeight) + 14)
            .padding(.top, 6)

            Text(caption)
                .font(.ui(14))
                .foregroundStyle(palette.ink1Color)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
        }
    }

    private var nextTitle: String? {
        guard let position, position + 1 < members.count else { return nil }
        return members[position + 1].displayTitle
    }

    private var caption: String {
        let count = StatsFormat.counted(Int64(members.count), "book")
        guard let nextTitle else { return "\(count) in your library" }
        return "\(count) in your library · \(nextTitle) is up next"
    }

    @ViewBuilder
    private func card(_ member: Book, index: Int, width: CGFloat) -> some View {
        let isThis = member.id == book.id
        let at = position ?? 0
        let pose = SeriesFanLayout.pose(
            index: index, count: members.count, current: at, width: width, spread: spread
        )
        let meta = SeriesFanLayout.meta(
            index: member.seriesIndex, isThis: isThis, isNext: index == at + 1
        )

        Group {
            if spread, !isThis {
                // Spread, a tap opens that book; gathered, any tap spreads.
                NavigationLink(value: Destination.book(uuid: member.uuid)) {
                    cover(member, isThis: isThis, meta: meta)
                }
                .buttonStyle(.plain)
            } else {
                Button {
                    Haptics.tap()
                    withAnimation(reduceMotion ? nil : Motion.glide) { spread.toggle() }
                } label: {
                    cover(member, isThis: isThis, meta: meta)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(width: SeriesFanLayout.cardWidth)
        .rotationEffect(.degrees(pose.rotation), anchor: .bottom)
        .offset(x: pose.x, y: pose.y + 6)
        .zIndex(Double(pose.z))
        .accessibilityLabel("\(member.displayTitle), \(meta)")
        .accessibilityAddTraits(isThis ? .isSelected : [])
    }

    private func cover(_ member: Book, isThis: Bool, meta: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            BookCover(identity: CoverIdentity(member), size: .md, cornerRadius: 4)
                .frame(width: SeriesFanLayout.cardWidth, height: 152)
                .overlay(alignment: .topTrailing) {
                    if isThis {
                        RibbonShape()
                            .fill(palette.bookRibbon)
                            .frame(width: 14, height: 30)
                            .shadow(color: .black.opacity(0.5), radius: 2, x: 1, y: 2)
                            .offset(x: -10, y: -3)
                    }
                }
                .shadow(color: .black.opacity(0.4), radius: 1.5, y: 2)
                .shadow(color: .black.opacity(0.5), radius: 11, x: 8, y: 12)

            VStack(alignment: .leading, spacing: 2) {
                Text(member.displayTitle)
                    .font(.ui(13, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(meta)
                    .font(.ui(13))
                    .foregroundStyle(palette.ink1Color)
                    .lineLimit(2)
            }
            .padding(.top, 8)
            .opacity(spread ? 1 : 0)
        }
        .contentShape(Rectangle())
    }
}

/// Where each card of the fan sits. Pure so the arithmetic has a test.
enum SeriesFanLayout {
    static let cardWidth: CGFloat = 104
    static let spreadStep: CGFloat = 120
    static let gatheredHeight: CGFloat = 176
    static let spreadHeight: CGFloat = 236

    struct Pose: Equatable {
        var x: CGFloat
        var y: CGFloat
        var rotation: Double
        var z: Int
    }

    static func pose(
        index: Int, count: Int, current: Int, width: CGFloat, spread: Bool
    ) -> Pose {
        let z = count - abs(index - current)
        if spread {
            return Pose(x: CGFloat(index) * spreadStep, y: 0, rotation: 0, z: z)
        }
        let step = count > 1 ? (width - cardWidth) / CGFloat(count - 1) : 0
        // A long series keeps the same overall turn rather than one per card,
        // which would stand its outer covers on end.
        let turn = min(5, 20 / Double(max(1, count - 1)))
        return Pose(
            x: CGFloat(index) * step,
            y: index == current ? -10 : 0,
            rotation: (Double(index) - Double(count - 1) / 2) * turn,
            z: z
        )
    }

    static func spreadWidth(count: Int) -> CGFloat {
        CGFloat(count) * spreadStep - 16
    }

    /// `Book 2 · This book`, `Book 3 · Up next`.
    static func meta(index: String?, isThis: Bool, isNext: Bool) -> String {
        var parts: [String] = []
        if let index = index?.nilIfBlank { parts.append("Book \(index)") }
        if isThis { parts.append("This book") }
        if isNext { parts.append("Up next") }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Read-alikes

/// `Readers who finished … also read`, from Hardcover's curated lists: a shelf
/// when they are ready, and saying so while the server is still asking.
private struct ReadAlikes: View {
    let book: Book
    let suggestions: BookSuggestions?

    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL

    var body: some View {
        switch suggestions {
        case .pending:
            section { status(spinning: true, "Looking for read-alikes via Hardcover…") }
        case .unavailable:
            section { status(spinning: false, "Suggestions are unavailable right now.") }
        case .ready(let items) where !items.isEmpty:
            section { shelf(items) }
        case .ready, .notConfigured, nil:
            EmptyView()
        }
    }

    private func section<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Readers who finished \(book.displayTitle) also read")
                .font(.display(30, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text("From Hardcover")
                .font(.ui(14))
                .foregroundStyle(palette.ink1Color)
                .padding(.top, 6)
            content()
                .padding(.top, 14)
        }
        .padding(.top, 40)
    }

    private func status(spinning: Bool, _ text: String) -> some View {
        HStack(spacing: 10) {
            if spinning {
                ProgressView().controlSize(.small).tint(palette.ink1Color)
            }
            Text(text)
                .font(.ui(15))
                .foregroundStyle(palette.ink1Color)
        }
        .accessibilityElement(children: .combine)
    }

    private func shelf(_ items: [BookSuggestion]) -> some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 14) {
                ForEach(items) { item in
                    Button {
                        Haptics.tap()
                        if let url = URL(string: item.hardcoverURL) { openURL(url) }
                    } label: {
                        StageShelfCard(
                            cover: SuggestionCover(item: item),
                            title: item.title,
                            meta: item.author
                        )
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityHint("Opens on Hardcover")
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 6)
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -16)
    }
}

/// A suggested book's cover, or a plate of its title when Hardcover has none.
private struct SuggestionCover: View {
    let item: BookSuggestion

    private var identity: CoverIdentity {
        CoverIdentity(
            uuid: String(item.hardcoverId), title: item.title, author: item.author, hasCover: false
        )
    }

    var body: some View {
        GeneratedCoverPlate(identity: identity)
            .overlay {
                if let path = item.coverURL {
                    RemoteImage(path: path) { Color.clear }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}
