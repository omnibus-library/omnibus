//  ShelvesViews.swift
//  Shelves index, shelf detail, the "add to shelf" picker, and shelf creation.

import SwiftUI

struct ShelvesView: View {
    @Environment(\.palette) private var palette
    // The index is unfiltered, so shelves the viewer does not own reach it and
    // need attributing. (Wishlists reach it too and are never attributed —
    // their names already carry the owner.)
    @Environment(AppState.self) private var app
    @State private var previews: [ShelfPreview] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var showCreate = false

    var body: some View {
        Group {
            if isLoading && previews.isEmpty {
                LoadingView()
            } else if let error, previews.isEmpty {
                ErrorStateView(message: error) { Task { await load() } }
            } else if previews.isEmpty {
                EmptyStateView(
                    icon: "square.stack",
                    title: "No shelves yet",
                    message: "A shelf gathers books by hand, or fills itself from a rule you set.",
                    kicker: "Your shelves",
                    fanned: true,
                    actionTitle: "Create a shelf",
                    action: { showCreate = true }
                )
            } else {
                ScrollView {
                    CoverGrid(previews) { preview in
                        NavigationLink(value: Destination.shelf(id: preview.shelf.id)) {
                            ShelfCard(preview: preview, viewerId: app.user?.id)
                        }
                        .buttonStyle(BookPressStyle())
                        .shelfContextMenu(preview.shelf) {
                            Task { await load(force: true) }
                        }
                    }
                    .screenPadding()
                    .padding(.vertical, Spacing.lg)
                }
                .scrollIndicators(.hidden)
            }
        }
        .background(ScreenBackground())
        .navigationTitle("Shelves")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showCreate = true } label: { Image(systemName: "plus") }
            }
        }
        .refreshTask { await load(force: true) }
        .sheet(isPresented: $showCreate) {
            CreateShelfSheet { Task { await load(force: true) } }
        }
        .task { await load() }
        .onChange(of: ReplicaInvalidations.shared.generation(of: CacheKey.shelfPreviews)) { _, _ in
            Task { await load() }
        }
    }

    private func load(force: Bool = false) async {
        // No cache-clear on the way in, even for a pull. `Cache.live` refetches
        // on every read regardless — the delete only forced it to re-*yield* an
        // identical answer — and offline it threw away the only copy of the
        // shelves there was, so pulling to refresh with no signal emptied the
        // screen.
        do {
            for try await read in UserDataService.shelfPreviews() {
                previews = read.value
                error = nil
                isLoading = false
            }
        } catch {
            if previews.isEmpty {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
        isLoading = false
    }
}

struct ShelfDetailView: View {
    let id: Int64

    init(id: Int64) {
        self.id = id
    }

    @Environment(\.palette) private var palette
    @State private var shelf: Shelf?
    /// The shelf's identity as the cached index knows it, for when the detail
    /// read hasn't landed.
    ///
    /// `UserDataService.shelf(id:)` is the only read carrying rules and a
    /// description, and on a cold cache it is network-only — so offline this
    /// page lost its name, its mosaic and its *kind* at once, and with the kind
    /// gone it told a manual shelf that nothing matched its conditions. The
    /// shelves index is already in the replica and carries every field the
    /// header needs.
    @State private var indexed: ShelfPreview?
    /// The member read. Its own `settled`, not `isLoading`, says whether it has
    /// answered: `isLoading` clears on either stream's first value, so a detail
    /// read winning the race would otherwise pass for an unreachable shelf.
    @State private var members = ShelfMemberRead()
    private var filters = LibraryFilterStore.shared
    @State private var isLoading = true
    /// The server answered that this shelf doesn't exist — a card cached
    /// before it was deleted elsewhere must not open it.
    @State private var isGone = false
    @State private var showAddBooks = false
    @State private var showEdit = false
    @State private var scrollY: CGFloat = 0
    @Environment(AppState.self) private var app

    /// Whatever is known about this shelf, detail read first.
    private var identity: ShelfSummary? {
        isGone ? nil : shelf.map(Self.summary) ?? indexed?.shelf
    }

    /// Covers for the header mosaic: this shelf's own members once they land,
    /// and the ones the cached index already holds until then. Without the
    /// fallback the offline header drew the flat empty plate while the shelves
    /// screen one back was showing that shelf's art from the same replica.
    private var mosaicCovers: [Book] {
        members.books.isEmpty ? (indexed?.covers ?? []) : Array(members.books.prefix(4))
    }

    /// Only a manual shelf can be filled by hand — a smart shelf's membership
    /// is whatever its rules match, and the wishlist's is what you check in.
    private var canAddBooks: Bool { identity?.kind == .manual }

    /// Whether the pencil is offered: the same rule the long-press menu uses,
    /// so the two ways to reach the editor never disagree about who may.
    private var canEdit: Bool {
        guard let identity else { return false }
        return ShelfActions.canEdit(
            viewerId: app.user?.id,
            isAdmin: app.user?.isAdmin == true,
            ownerUserId: identity.ownerUserId,
            kind: identity.kind
        )
    }

    var body: some View {
        Group {
            if isGone {
                EmptyStateView(
                    icon: "square.stack",
                    title: "This shelf is gone",
                    message: "It was deleted, or its owner stopped sharing it.",
                    kicker: "Shelf"
                )
            } else if isLoading {
                LoadingView()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 30) {
                        header

                        LibraryFilterBar(store: filters, viewerId: app.user?.id)

                        switch members.phase(knownCount: identity?.bookCount) {
                        case .loading:
                            LoadingView().frame(minHeight: 380)
                        case .filtered(let phase):
                            FilteredResultsState(phase: phase) { filters.clear() }
                        case .unreachable(let count):
                            unreachableState(count: count)
                        case .empty:
                            emptyState
                        case .members:
                            StackedBookGrid(members.books) { book, cell in
                                NavigationLink(value: Destination.book(uuid: book.uuid)) {
                                    cell
                                }
                                .buttonStyle(BookPressStyle())
                                .bookContextMenu(book, onEdited: { Task { await load() } }) {
                                    if shelf?.kind == .manual {
                                        Button(role: .destructive) {
                                            Task {
                                                await UserDataService.removeBook(
                                                    shelfId: id, uuid: book.uuid
                                                )
                                                // A filtered copy is dropped, not patched, so
                                                // offline the reload can't take the book away.
                                                members.remove(book.uuid)
                                                await load()
                                            }
                                        } label: {
                                            Label("Remove from shelf", systemImage: "minus.circle")
                                        }
                                    }
                                }
                            }
                            .screenPadding()
                        }
                    }
                    .padding(.bottom, 40)
                }
                .scrollIndicators(.hidden)
                .trackingScrollOffset($scrollY)
            }
        }
        .background(ScreenBackground())
        // The header states the shelf's name at full size; the bar picks it up
        // only once that has scrolled away.
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            FadingBarTitle(title: identity?.name ?? "", scrollY: scrollY, appearsAfter: 76)
        }
        .toolbar {
            if canEdit {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Haptics.tap()
                        showEdit = true
                    } label: {
                        Image(systemName: ShelfMenuGlyph.edit)
                    }
                    .accessibilityLabel("Edit this shelf")
                }
            }
            if canAddBooks {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Haptics.tap()
                        showAddBooks = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Add books to this shelf")
                }
            }
        }
        .sheet(isPresented: $showEdit) {
            if let identity {
                EditShelfSheet(shelf: identity) {
                    Task { await load(force: true) }
                }
            }
        }
        .sheet(isPresented: $showAddBooks) {
            if let identity {
                AddBooksToShelfSheet(shelfId: identity.id, shelfName: identity.name) {
                    Task { await load(force: true) }
                }
            }
        }
        .refreshTask { await load(force: true) }
        .task(id: filters.clauses) { await load() }
    }

    /// A shelf you can fill asks to be filled; one driven by rules explains
    /// itself instead of offering an action that wouldn't apply.
    private var emptyState: some View {
        let copy = ShelfEmptyCopy.forKind(identity?.kind)

        return EmptyStateView(
            icon: (identity?.kind ?? .manual).glyph,
            title: copy.title,
            message: copy.message,
            kicker: copy.kicker,
            fanned: true,
            actionTitle: copy.actionTitle,
            action: copy.actionTitle == nil ? nil : { showAddBooks = true }
        )
        // Inside the page's scroll view this sizes to its content, so give it
        // enough of the pane to sit in rather than letting it hug the header.
        .frame(minHeight: 380)
    }

    /// Named so a test can prove it resolves — `Image(systemName:)` neither
    /// warns nor fails on a name that doesn't, it just draws nothing.
    static let unreachableGlyph = "arrow.trianglehead.2.clockwise.rotate.90"

    /// The shelf has books the device hasn't got a copy of.
    private func unreachableState(count: Int64) -> some View {
        EmptyStateView(
            icon: Self.unreachableGlyph,
            title: "Not here yet",
            message: ShelfEmptyCopy.unreachable(count: count),
            kicker: "Off the network",
            fanned: true
        )
        .frame(minHeight: 380)
    }

    /// Mosaic beside the shelf's identity, so a smart shelf's conditions are
    /// visible without opening an editor.
    @ViewBuilder
    private var header: some View {
        if let identity {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                HStack(alignment: .top, spacing: Spacing.lg) {
                    ShelfMosaic(
                        preview: ShelfPreview(shelf: identity, covers: mosaicCovers)
                    )
                    .frame(width: 104)
                    .coverShadow(1.2)

                    VStack(alignment: .leading, spacing: 7) {
                        // Same accent lead-in the masthead and book jacket use.
                        Rectangle()
                            .fill(palette.accentColor)
                            .frame(width: 24, height: 1.5)

                        Text(identity.name)
                            .font(.display(30))
                            .foregroundStyle(palette.ink0Color)
                            .fixedSize(horizontal: false, vertical: true)

                        Text(Self.metaLine(identity))
                            .font(.monoUI(10, weight: .medium))
                            .tracking(0.7)
                            .textCase(.uppercase)
                            .foregroundStyle(palette.ink3Color)

                        if let description = shelf?.description?.nilIfBlank {
                            Text(description)
                                .font(.display(18))
                                .foregroundStyle(palette.ink2Color)
                                .padding(.top, 2)
                        }
                    }

                    Spacer(minLength: 0)
                }

                if let shelf, shelf.kind == .smart, !shelf.rules.isEmpty {
                    ruleSummary(shelf)
                }
            }
            .screenPadding()
            .padding(.top, Spacing.sm)
        }
    }

    private func ruleSummary(_ shelf: Shelf) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(shelf.matchMode == .any ? "Matches any of" : "Matches all of")
                .font(.monoUI(10, weight: .medium))
                .tracking(0.7)
                .textCase(.uppercase)
                .foregroundStyle(palette.ink3Color)

            FlowLayout(spacing: 5, lineSpacing: 5) {
                ForEach(Array(shelf.rules.enumerated()), id: \.offset) { _, rule in
                    Chip(label: "\(rule.field.label) \(rule.op.label) \(rule.value)")
                }
            }
        }
    }

    /// Every kind names itself. It used to print "Manual" for anything that
    /// wasn't smart, so the wishlist — which nobody fills by hand — described
    /// itself as the one kind you do.
    static func metaLine(_ shelf: ShelfSummary) -> String {
        var parts = ["\(shelf.bookCount) book\(shelf.bookCount == 1 ? "" : "s")"]
        switch shelf.kind {
        case .smart: parts.append("Smart")
        case .manual: parts.append("Manual")
        case .wishlist: parts.append("Wishlist")
        }
        if shelf.visibility == .public { parts.append("Public") }
        return parts.joined(separator: " · ")
    }

    /// Whether a failed shelf read means the shelf no longer exists for this
    /// reader, as opposed to not being reachable right now.
    nonisolated static func isGone(_ error: Error) -> Bool {
        if case APIError.http(status: 404, _) = error { return true }
        return false
    }

    /// The mosaic takes a summary; detail carries the same fields under a
    /// different type.
    static func summary(_ shelf: Shelf) -> ShelfSummary {
        ShelfSummary(
            id: shelf.id,
            ownerUserId: shelf.ownerUserId,
            ownerUsername: shelf.ownerUsername,
            kind: shelf.kind,
            name: shelf.name,
            visibility: shelf.visibility,
            accent: shelf.accent,
            bookCount: shelf.bookCount
        )
    }

    private func load(force: Bool = false) async {
        if force {
            await OfflineStore.shared.cacheDelete(CacheKey.shelf(id))
            await UserDataService.dropShelfPages(id)
        }
        let clauses = filters.clauses
        let ticket = members.begin(clauses)
        await withTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in
                // Cheap, local, and only ever a fallback — the detail read
                // wins the moment it lands.
                let previews: [ShelfPreview]? = await Cache.cachedOnly(CacheKey.shelfPreviews)
                self.indexed = previews?.first { $0.shelf.id == self.id }
            }
            group.addTask { @MainActor in
                do {
                    for try await read in UserDataService.shelf(id: id) {
                        self.shelf = read.value
                        self.isLoading = false
                    }
                } catch where Self.isGone(error) {
                    self.isGone = true
                    self.shelf = nil
                    self.indexed = nil
                    self.members.removeAll()
                    await UserDataService.forgetShelf(id: self.id)
                } catch {}
            }
            group.addTask { @MainActor in
                do {
                    for try await read in UserDataService.shelfBooks(id: id, filter: clauses) {
                        guard !Task.isCancelled else { return }
                        self.members.receive(read.value.books, ticket: ticket)
                        self.isLoading = false
                    }
                } catch {
                    guard !Task.isCancelled else { return }
                    self.members.fail(LibraryFilterError.message(for: error), ticket: ticket)
                }
                // A filter change cancels this read; settling then would claim
                // the next filter's answer before it arrives.
                guard !Task.isCancelled else { return }
                self.members.settle(ticket: ticket)
            }
        }
        isLoading = false
    }
}

/// What a shelf with nothing on it should say.
///
/// A table rather than a branch in the view: the three kinds are filled by
/// three different mechanisms — by hand, by a rule, by checking a book in —
/// so only one of them has an action to offer, and telling the other two that
/// "no books match this shelf's conditions" describes machinery they don't
/// have. `nil` is the honest fourth case: offline before the detail read has
/// landed, the kind isn't known, and the page must not guess at one.
enum ShelfEmptyCopy {
    struct Copy: Equatable {
        let kicker: String
        let title: String
        let message: String
        /// Non-nil only where the reader can actually fill this shelf here.
        let actionTitle: String?
    }

    static func forKind(_ kind: ShelfKind?) -> Copy {
        switch kind {
        case .manual:
            Copy(
                kicker: "Empty shelf",
                title: "Nothing on this shelf",
                message: "Pick books out of your library and they gather here, in the order you add them.",
                actionTitle: "Add books"
            )
        case .smart:
            Copy(
                kicker: "No matches",
                title: "Nothing matches yet",
                message: "This shelf fills itself from its rules. Nothing in the library meets them right now.",
                actionTitle: nil
            )
        case .wishlist:
            Copy(
                kicker: "Wishlist",
                title: "Nothing on the wishlist",
                message: "Check in a book you don't own yet and it waits here until a copy arrives.",
                actionTitle: nil
            )
        case nil:
            Copy(
                kicker: "Empty shelf",
                title: "Nothing on this shelf",
                message: "No books are on it yet.",
                actionTitle: nil
            )
        }
    }

    /// What to say when the shelf is known to hold books the device hasn't
    /// fetched — offline, with the member page never cached. States the count
    /// so the line agrees with the header rather than contradicting it.
    static func unreachable(count: Int64) -> String {
        count == 1
            ? "This shelf holds one book, but it hasn't reached this device. "
                + "It'll appear the next time you're online."
            : "This shelf holds \(count) books, but they haven't reached this device. "
                + "They'll appear the next time you're online."
    }
}

// MARK: - Add to shelf

/// Toggle a book's shelves.
///
/// Every hand-picked shelf is a row with a live check, its covers gaining this
/// book as it goes on. Smart shelves this book matches are listed read-only, so
/// their absence from the toggles isn't mistaken for a bug.
struct ShelfPickerSheet: View {
    let book: Book

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var previews: [ShelfPreview] = []
    @State private var member: Set<Int64> = []
    @State private var smart: Set<Int64> = []
    @State private var busy: Set<Int64> = []
    @State private var isLoading = true
    @State private var showCreate = false

    private var manual: [ShelfPreview] { previews.filter { $0.shelf.kind == .manual } }
    private var automatic: [ShelfPreview] {
        previews.filter { $0.shelf.kind != .manual && smart.contains($0.shelf.id) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BookSheetHeader(title: "Add to shelf") { dismiss() }

            if isLoading {
                LoadingView()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if manual.isEmpty {
                            Text("You have no hand-picked shelves yet. Make one and this book goes on it.")
                                .font(.ui(16))
                                .foregroundStyle(palette.ink1Color)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.top, 6)
                                .padding(.bottom, 12)
                        } else {
                            Text("Tap a shelf to add or remove this book.")
                                .font(.ui(14))
                                .foregroundStyle(palette.ink1Color)
                                .padding(.top, 2)
                                .padding(.bottom, 8)
                            ForEach(manual) { row($0) }
                        }

                        newShelfRow

                        if !automatic.isEmpty {
                            Text("Automatic")
                                .font(.ui(15, weight: .semibold))
                                .foregroundStyle(palette.ink0Color)
                                .padding(.top, 20)
                                .padding(.bottom, 2)
                            Text("These follow each shelf\u{2019}s rules, so they can\u{2019}t be changed here.")
                                .font(.ui(14))
                                .foregroundStyle(palette.ink1Color)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.bottom, 6)
                            ForEach(automatic) { automaticRow($0) }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 28)
                }
                .scrollIndicators(.hidden)
            }
        }
        .bookSheet([.fraction(0.82), .large])
        .sheet(isPresented: $showCreate) {
            CreateShelfSheet(bookUUIDs: [book.uuid]) { Task { await load() } }
        }
        .task { await load() }
    }

    /// Two of the shelf's covers fanned, and this book laid on top once it
    /// belongs there.
    private func stack(_ preview: ShelfPreview, withBook: Bool, dimmed: Bool = false) -> some View {
        let covers = preview.covers.filter { $0.id != book.id }.prefix(withBook ? 2 : 3)

        return HStack(spacing: -14) {
            ForEach(Array(covers.enumerated()), id: \.element.id) { index, cover in
                stackCover(CoverIdentity(cover), turn: index == 0 ? -4 : 2)
            }
            if withBook {
                stackCover(CoverIdentity(book), turn: 4)
                    .transition(
                        reduceMotion
                            ? .opacity
                            : .opacity
                                .combined(with: .offset(y: -22))
                                .combined(with: .scale(scale: 0.8))
                    )
            }
        }
        .opacity(dimmed ? 0.82 : 1)
        .frame(width: 66, alignment: .leading)
        .accessibilityHidden(true)
    }

    private func stackCover(_ identity: CoverIdentity, turn: Double) -> some View {
        BookCover(identity: identity, size: .sm, cornerRadius: 2)
            .frame(width: 30, height: 45)
            .shadow(color: .black.opacity(0.5), radius: 3, x: 2, y: 3)
            .rotationEffect(.degrees(turn))
    }

    private func rule() -> some View {
        Rectangle().fill(palette.ink0Color.opacity(0.1)).frame(height: 1)
    }

    private func row(_ preview: ShelfPreview) -> some View {
        let shelf = preview.shelf
        let isOn = member.contains(shelf.id)

        return HStack(spacing: 14) {
            stack(preview, withBook: isOn)
                .animation(Motion.settle, value: isOn)
            VStack(alignment: .leading, spacing: 0) {
                Text(shelf.name)
                    .font(.ui(16, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                Text(StatsFormat.counted(shelf.bookCount, "book"))
                    .font(.ui(14))
                    .foregroundStyle(palette.ink1Color)
            }
            Spacer(minLength: 0)
            check(isOn: isOn, busy: busy.contains(shelf.id))
        }
        .padding(.vertical, 8)
        .frame(minHeight: 66)
        .overlay(alignment: .top) { rule() }
        .tapRow {
            Task { await toggle(shelf, currentlyOn: isOn) }
        }
        .accessibilityAddTraits(isOn ? .isSelected : [])
        .accessibilityIdentifier("shelf-row-\(shelf.id)")
    }

    @ViewBuilder
    private func check(isOn: Bool, busy: Bool) -> some View {
        if busy {
            ProgressView().controlSize(.small).frame(width: 26, height: 26)
        } else {
            ZStack {
                Circle()
                    .fill(isOn ? palette.bookDeep : .clear)
                    .overlay {
                        if !isOn {
                            Circle().strokeBorder(palette.ink0Color.opacity(0.34), lineWidth: 1.5)
                        }
                    }
                if isOn {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .frame(width: 26, height: 26)
        }
    }

    private var newShelfRow: some View {
        Button {
            Haptics.tap()
            showCreate = true
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(palette.bookText)
                    .frame(width: 52)
                Text("New shelf")
                    .font(.ui(16, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                Spacer(minLength: 0)
            }
            .frame(minHeight: 56)
            .overlay(alignment: .top) { rule() }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("shelf-new")
    }

    private func automaticRow(_ preview: ShelfPreview) -> some View {
        HStack(spacing: 14) {
            stack(preview, withBook: false, dimmed: true)
            VStack(alignment: .leading, spacing: 0) {
                Text(preview.shelf.name)
                    .font(.ui(16, weight: .medium))
                    .foregroundStyle(palette.ink0Color)
                Text(StatsFormat.counted(preview.shelf.bookCount, "book"))
                    .font(.ui(14))
                    .foregroundStyle(palette.ink1Color)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .frame(minHeight: 60)
        .overlay(alignment: .top) { rule() }
        .accessibilityElement(children: .combine)
    }

    private func toggle(_ shelf: ShelfSummary, currentlyOn: Bool) async {
        busy.insert(shelf.id)
        defer { busy.remove(shelf.id) }

        if currentlyOn {
            await UserDataService.removeBook(shelfId: shelf.id, uuid: book.uuid)
            member.remove(shelf.id)
        } else {
            await UserDataService.addBooks(shelfId: shelf.id, uuids: [book.uuid])
            member.insert(shelf.id)
        }
        Haptics.select()
        await load(quiet: true)
    }

    private func load(quiet: Bool = false) async {
        if !quiet { isLoading = true }
        // Deliberately not clearing the cache first: the live read refetches
        // anyway, and dropping it offline leaves this sheet with no shelves to
        // show at all.
        for await value in UserDataService.shelfPreviews().values() { previews = value }
        for await ids in UserDataService.shelvesContaining(uuid: book.uuid).values() {
            member = Set(ids)
        }
        for await ids in UserDataService.smartShelvesContaining(uuid: book.uuid).values() {
            smart = Set(ids)
        }
        isLoading = false
    }
}
