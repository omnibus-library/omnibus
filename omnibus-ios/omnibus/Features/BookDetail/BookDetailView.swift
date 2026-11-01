//  BookDetailView.swift
//  The book page: the stage at the top — the book standing on a wash of its own
//  cover, with where you are in it — then four tabs that pin under the top bar,
//  and a primary action that never scrolls away. The sections live in their own
//  files; this one is the shell, what opens from it, and the actions it takes.

import SwiftUI

struct BookDetailView: View {
    let uuid: String

    init(uuid: String) {
        self.uuid = uuid
    }

    /// The top bar's row, from the status bar down to where the tabs pin.
    static let barRow: CGFloat = 50
    /// The tab strip's height, and the action bar's above the home indicator.
    /// Together with `barRow`, the room a panel has when the tabs are pinned.
    static let tabStrip: CGFloat = 50
    static let actionBar: CGFloat = 62
    /// Scroll id of the tab strip, for bringing a section to the top.
    static let tabsAnchor = "book-tabs"
    /// Scroll id of the series section, which the byline's link jumps to.
    static let seriesAnchor = "book-series"

    /// What the journal composer was opened for. `Identifiable` so the
    /// composer can be an item-driven sheet, which is what keeps a chosen
    /// entry attached to the presentation that carries it.
    enum ComposerTarget: Identifiable {
        case new
        case editing(JournalEntry)

        var id: String {
            switch self {
            case .new: "new"
            case .editing(let entry): entry.pathID
            }
        }

        /// The entry being edited, or `nil` when writing a new one.
        var entry: JournalEntry? {
            if case .editing(let entry) = self { return entry }
            return nil
        }
    }

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(AppState.self) private var app
    @Environment(AudioPlayer.self) private var player
    @Environment(\.bookZoomNamespace) private var bookZoom
    @State private var model = BookDetailModel()
    @State private var tab: BookTab = .overview
    /// Which side the next panel comes in from.
    @State private var turnFrom: CGFloat = 1
    /// Whether the cover has scrolled away, so the bar fills in behind the
    /// controls and takes over naming the book.
    @State private var scrolledPast = false
    @State private var showShelfPicker = false
    @State private var showAlignment = false
    @State private var showBookmarks = false
    @State private var showAudioFilePicker = false
    @State private var showCheckIn = false
    /// The chip row whose quick editor is up, when one is.
    @State private var chipEditing: ChipEditKind?
    /// What the review sheet is open on, when it is.
    @State private var reviewTarget: ReviewComposerTarget?
    /// The entry open in the journal drawer.
    @State private var openJournal: JournalEntry?
    /// The passage being turned into a card, driving the quote sheet.
    @State private var quoteTarget: QuoteRequest?
    /// The file chosen in the picker, opened from the sheet's `onDismiss` —
    /// presenting the full-screen player while the sheet is still up would
    /// be refused.
    @State private var pickedAudioFile: BookFileInfo?
    /// What the journal composer is open on, when it is. The entry rides
    /// with the presentation rather than in a payload `@State` beside a Bool:
    /// `.sheet(isPresented:)` captured its content before that payload landed,
    /// so Edit opened a blank "New entry".
    @State private var composing: ComposerTarget?
    /// Whether the screen has appeared before. The first `onAppear` belongs
    /// to `.task`'s load; every later one means a pushed screen — the
    /// metadata editor, a nested detail — was popped off, and whatever it
    /// wrote should show immediately.
    @State private var hasAppeared = false
    @State private var showExport = false
    /// The bookmark chosen in the sheet, opened from its `onDismiss`, for the
    /// same reason as `pickedAudioFile`.
    @State private var pickedBookmark: Bookmark?
    /// Admin: the merge and delete sheets, and the receipt a landed merge
    /// leaves behind — held until dismissed or undone, since the undo handle
    /// it carries is only good while something keeps it.
    @State private var showMerge = false
    @State private var showDelete = false
    @State private var mergeResult: MergeBooksResult?
    @State private var confirmWishlistRemove = false
    /// A one-line report for the toast, when something needs saying.
    @State private var toast: String?
    /// Bumped to flip the book mark on the primary action.
    @State private var leafTurns = 0
    /// Bumped to set the bars on the Listen button moving.
    @State private var listenPulses = 0

    private var downloads = DownloadManager.shared
    private var presentation = Presentation.shared
    private var connectivity = Connectivity.shared

    var body: some View {
        Group {
            if model.isLoading {
                LoadingView()
            } else if let book = model.book {
                content(book)
            } else if let error = model.error {
                ErrorStateView(message: error) { Task { await model.load(uuid: uuid) } }
            }
        }
        .background(ScreenBackground())
        // The screen carries its own chrome — glass discs over the art — so
        // the system bar goes away entirely rather than floating over it.
        // The tab bar needs hiding *here* too: `MainTabView` only suppresses
        // its custom bar, and with the safe-area inset empty the native
        // floating pill re-materializes on this screen without this.
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .navigationBarBackButtonHidden(true)
        // Hiding the bar kills the system's edge-swipe pop; bring it back.
        .keepsEdgeSwipeBack()
        .bookZoomDestination(uuid, in: bookZoom)
        .task { await model.load(uuid: uuid) }
        .refreshTask { await model.load(uuid: uuid) }
        // Refetch on the way back from a pushed screen (edited metadata, a
        // nested detail). Sheets reload through their own callbacks; the
        // reader and player are full-screen covers over the tab view, so
        // closing one never re-appears this view — that path is the
        // `progressToken` observation below.
        .onAppear {
            guard hasAppeared else {
                hasAppeared = true
                return
            }
            Task { await model.load(uuid: uuid) }
        }
        // Refetch once a reading or listening session has *persisted* its
        // final position — the position, status, highlights, and stats it
        // wrote should show the moment the reader or player closes. Keyed on
        // the token rather than the dismissal so the read never lands before
        // the write it is meant to pick up.
        .onChange(of: presentation.progressToken) { _, _ in
            Task { await model.load(uuid: uuid) }
        }
        // A review read that could not answer offline gets another go the
        // moment the connection is back, rather than waiting for a refresh.
        .onChange(of: connectivity.isOnline) { wasOnline, isOnline in
            guard DetailReviews.rereadsOnReconnect(
                wasOnline: wasOnline, isOnline: isOnline, known: model.reviews != nil
            ) else { return }
            Task { await model.loadReviews(uuid: uuid) }
        }
        .sheet(isPresented: $showAlignment) {
            if let book = model.book {
                AlignmentSheet(book: book) {
                    Task { await model.load(uuid: uuid) }
                }
            }
        }
        .sheet(item: $composing) { target in
            if let book = model.book {
                JournalComposer(book: book, editing: target.entry) {
                    Task { await model.load(uuid: uuid) }
                }
            }
        }
        .sheet(isPresented: $showShelfPicker) {
            if let book = model.book {
                ShelfPickerSheet(book: book)
            }
        }
        .sheet(isPresented: $showBookmarks, onDismiss: openPickedBookmark) {
            if let book = model.book {
                BookmarksSheet(book: book, isAudio: book.hasAudiobook, chapters: model.chapters) {
                    pickedBookmark = $0
                }
            }
        }
        .sheet(isPresented: $showExport) {
            if let book = model.book {
                BookExportSheet(book: book)
            }
        }
        .sheet(isPresented: $showAudioFilePicker, onDismiss: openPickedAudioFile) {
            if let book = model.book {
                AudioFilePickerSheet(book: book) { file in
                    pickedAudioFile = file
                }
            }
        }
        .sheet(isPresented: $showCheckIn) { CheckInView() }
        .sheet(isPresented: $showMerge) {
            if let book = model.book {
                MergeBookSheet(target: book) { result in
                    mergeResult = result
                    Task { await model.load(uuid: uuid) }
                }
            }
        }
        .sheet(isPresented: $showDelete) {
            if let book = model.book {
                DeleteBookSheet(book: book) { result in
                    // A total delete leaves this screen about a book that is
                    // gone; a partial one just changed the Files tab.
                    if result.bookDeleted {
                        dismiss()
                    } else {
                        withAnimation(Motion.settle) {
                            toast = DeleteSelectionCopy.doneToast(
                                files: result.deletedFileIds.count,
                                copies: result.deletedCopyIds.count
                            )
                        }
                        Task { await model.load(uuid: uuid) }
                    }
                }
            }
        }
        .sheet(item: $chipEditing) { kind in
            if let book = model.book {
                ChipEditSheet(book: book, kind: kind) { merged in
                    model.book = merged
                }
            }
        }
        .sheet(item: $reviewTarget) { target in
            if let book = model.book {
                // `latest` follows the model, so an answer that lands while the
                // sheet is open rebases it rather than going unseen.
                ReviewSheet(
                    book: book,
                    original: target.original,
                    latest: reviewState.review,
                    highlights: model.highlights,
                    chapters: model.chapters
                ) { patch in
                    model.reviewSaves += 1
                    Task { await model.patchReview(patch, uuid: uuid) }
                }
            }
        }
        .sheet(item: $quoteTarget) { request in
            if let book = model.book {
                QuoteCardSheet(quote: request.text, book: book)
            }
        }
        .sheet(item: $openJournal) { entry in
            JournalDrawer(
                entry: entry,
                isMine: DetailJournal.isOwn(entry, viewerId: app.user?.id)
            ) {
                openJournal = nil
                composing = .editing(entry)
            } onDelete: {
                openJournal = nil
                Task {
                    await UserDataService.deleteJournal(entry)
                    await model.load(uuid: uuid)
                }
            }
        }
        .confirmationDialog(
            "Remove from wishlist?", isPresented: $confirmWishlistRemove, titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) { removeFromWishlist() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(WishlistCopy.confirmMessage(hasFiles: model.hasFile))
        }
        // Outermost, so the page, its bars, and every sheet above all inherit
        // the book-toned accent.
        .environment(\.palette, bookPalette)
        .tint(bookPalette.accentColor)
    }

    /// The screen's palette: the theme re-keyed to this book's tone, resolved
    /// the same way the cover plate resolves it — so a coverless book's
    /// controls match the plate it is showing.
    private var bookPalette: Palette {
        guard let book = model.book else { return palette }
        return palette.accented(byCoverOf: book)
    }

    private var reviewState: ReviewCardState {
        .resolve(model.reviews, failure: model.reviewsFailure)
    }

    /// Open the review sheet. A target only exists once your review is known: a
    /// sheet seeded from an unknown one would send text over what the server holds.
    private func composeReview() {
        reviewTarget = ReviewComposerTarget.make(for: reviewState)
    }

    /// Open the quote-card sheet on a kept line's passage.
    private func quote(_ highlight: Highlight) {
        guard let text = KeptLineRow.quotable(highlight) else { return }
        quoteTarget = QuoteRequest(text: text)
    }

    /// Open the reader at a kept line.
    private func openInBook(_ highlight: Highlight, _ book: Book) {
        guard DetailRead.opensInBook(hasEpub: book.hasEpub, anchor: highlight.epubCFIRange),
              let cfi = highlight.epubCFIRange
        else { return }
        ReaderBridge.shared.pendingCFI = cfi
        read(book)
    }

    /// Open at the bookmark the sheet chose, once its sheet is gone: a position
    /// that reads as seconds is the audiobook's, anything else a place in the text.
    private func openPickedBookmark() {
        guard let bookmark = pickedBookmark, let book = model.book else { return }
        pickedBookmark = nil
        if let seconds = BookmarkCopy.listeningSeconds(bookmark) {
            guard DownloadManager.shared.canOpen(book, kind: .audio) else {
                Presentation.shared.openPlayer(book)
                return
            }
            // Opened after: the player loads on appearing, and two loads at once
            // tear each other down and lose the seek. This way it reuses this one.
            Task {
                await player.load(book: book)
                await player.seek(to: seconds)
                Presentation.shared.openPlayer(book)
            }
        } else {
            ReaderBridge.shared.pendingCFI = bookmark.position
            read(book)
        }
    }

    /// Open the player on the file the picker chose, once its sheet is gone.
    private func openPickedAudioFile() {
        guard let file = pickedAudioFile, let book = model.book else { return }
        pickedAudioFile = nil
        Presentation.shared.openPlayer(book, fileID: file.id)
    }

    // MARK: - Shell

    /// Whether this reader may write metadata overrides — the server's own
    /// gate on the save (`can_edit` or admin), so the "+" chips never open
    /// onto a request that can only be refused.
    private var canEditMetadata: Bool {
        app.user?.canEdit == true || app.user?.isAdmin == true
    }

    private func content(_ book: Book) -> some View {
        GeometryReader { geometry in
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    // Not a lazy stack with pinned views: it re-estimates the
                    // stage as that scrolls off, and on a page ending about
                    // there the scroll came to rest with the end under the bar.
                    VStack(alignment: .leading, spacing: 0) {
                        stage(book, proxy: proxy)
                        BookTabStrip(selected: tab) { pick($0) }
                            .visualEffect { content, strip in
                                let top = strip.frame(in: .scrollView(axis: .vertical)).minY
                                return content.offset(y: max(0, -top))
                            }
                            .zIndex(1)
                        panel(book)
                            // Tall enough that the tabs can stay pinned on the
                            // shortest panel: a tab change must not drop the
                            // page out from under the reader.
                            .frame(
                                maxWidth: .infinity,
                                minHeight: geometry.size.height - Self.barRow
                                    - Self.tabStrip - Self.actionBar + 4,
                                alignment: .top
                            )
                    }
                }
                .scrollIndicators(.hidden)
                .safeAreaInset(edge: .top, spacing: 0) {
                    Color.clear.frame(height: Self.barRow)
                }
                .safeAreaInset(edge: .bottom, spacing: 0) { actionBar(book) }
                .onScrollGeometryChange(for: Bool.self) { geometry in
                    let offset = geometry.contentOffset.y + geometry.contentInsets.top
                    return offset > StageCover.height + 30
                } action: { _, past in
                    withAnimation(Motion.snap) { scrolledPast = past }
                }
            }
            .overlay(alignment: .top) { topBar(book) }
            .overlay(alignment: .bottom) { toastLayer() }
        }
    }

    private func stage(_ book: Book, proxy: ScrollViewProxy) -> some View {
        BookStage(
            book: book,
            model: model,
            tab: tab,
            isOnline: connectivity.isOnline,
            holdsCopy: downloads.isDownloaded(book.uuid, kind: .ebook)
                || downloads.isDownloaded(book.uuid, kind: .audio),
            onReview: composeReview,
            onReviews: { jump(to: .reviews, proxy: proxy) },
            onSeries: { jumpToSeries(proxy: proxy) }
        )
        .padding(.top, 12)
        .background { StageBackdrop(book: book, tab: tab) }
        // Where a jump aims: the strip itself is pinned, and a pinned view
        // reports where it is pinned rather than where it belongs in the list.
        .background(alignment: .bottom) {
            Color.clear.frame(height: 1).id(Self.tabsAnchor)
        }
        // The book stands between the bar's two discs rather than under them.
        .padding(.top, -Self.barRow)
    }

    private func panel(_ book: Book) -> some View {
        Group {
            switch tab {
            case .overview:
                BookOverviewTab(
                    book: book,
                    model: model,
                    onEditChips: canEditMetadata ? { chipEditing = $0 } : nil,
                    chipEditsOnline: connectivity.isOnline,
                    jumpClearance: Self.tabStrip + 16
                )
            case .reviews:
                BookReviewsTab(book: book, model: model, onCompose: composeReview)
            case .highlights:
                BookHighlightsTab(
                    book: book,
                    model: model,
                    viewerId: app.user?.id,
                    onQuote: { quote($0) },
                    onOpenInBook: { openInBook($0, book) },
                    onWrite: { composing = .new },
                    onOpenEntry: { openJournal = $0 }
                )
            case .files:
                BookFilesTab(book: book, model: model) { showAlignment = true }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 46)
        .padding(.bottom, 32)
        .id(tab)
        .transition(.panelTurn(from: turnFrom, reduceMotion: reduceMotion))
    }

    private func pick(_ next: BookTab) {
        guard next != tab else { return }
        turnFrom = next.rawValue > tab.rawValue ? 1 : -1
        withAnimation(reduceMotion ? nil : Motion.settle) { tab = next }
    }

    /// Bring a tab to the top of the page, under the bar.
    private func jump(to next: BookTab, proxy: ScrollViewProxy) {
        pick(next)
        withAnimation(reduceMotion ? nil : Motion.settle) {
            proxy.scrollTo(Self.tabsAnchor, anchor: .top)
        }
    }

    /// The byline's series link. The section only exists once its panel has
    /// been laid out, so the page moves to Overview before going looking for it.
    private func jumpToSeries(proxy: ScrollViewProxy) {
        pick(.overview)
        Task {
            try? await Task.sleep(for: .milliseconds(60))
            withAnimation(reduceMotion ? nil : Motion.settle) {
                proxy.scrollTo(Self.seriesAnchor, anchor: .top)
            }
        }
    }

    // MARK: - Top bar

    /// Back and ⋯, as discs that read over the art, on a bar that fills in and
    /// names the book once the cover has scrolled away.
    private func topBar(_ book: Book) -> some View {
        HStack(spacing: 10) {
            Button {
                Haptics.tap()
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
            }
            .buttonStyle(DiscButtonStyle())
            .accessibilityLabel("Back")

            Text(book.displayTitle)
                .font(.display(21, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .opacity(scrolledPast ? 1 : 0)
                .accessibilityHidden(true)

            moreMenu(book)
        }
        .padding(.horizontal, 16)
        .padding(.top, 1)
        .frame(height: Self.barRow, alignment: .top)
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                palette.bg0Color.opacity(0.78)
            }
            .ignoresSafeArea(edges: .top)
            .opacity(scrolledPast ? 1 : 0)
            .allowsHitTesting(false)
        }
    }

    /// A native menu: its rows, thick separators and greyed states are the
    /// ones the design draws. Three groups — this book and you, what can be done
    /// to its record, and the two admin writes.
    private func moreMenu(_ book: Book) -> some View {
        let rows = menuRows(book)

        return Menu {
            Section {
                Button {
                    showShelfPicker = true
                } label: {
                    Label("Add to shelf", systemImage: "books.vertical")
                }
                if rows.bookmarks {
                    Button {
                        showBookmarks = true
                    } label: {
                        Label("Bookmarks", systemImage: "bookmark")
                    }
                }
            }
            Section {
                if rows.export {
                    Button {
                        showExport = true
                    } label: {
                        Label("Export\u{2026}", systemImage: "square.and.arrow.up")
                    }
                    .accessibilityIdentifier("export-open")
                }
                if rows.editMetadata {
                    NavigationLink(value: Destination.metadataEdit(uuid: book.uuid)) {
                        menuLabel("Edit metadata", systemImage: "pencil")
                    }
                    .disabled(!connectivity.isOnline)
                }
                if rows.removeFromWishlist {
                    Button {
                        confirmWishlistRemove = true
                    } label: {
                        menuLabel("Remove from wishlist", systemImage: "heart.slash")
                    }
                    // Direct, never queued: its add can't be (rule 08).
                    .disabled(!connectivity.isOnline)
                    .accessibilityIdentifier("wishlist-remove")
                }
            }
            if rows.merge || rows.delete {
                // Library-wide writes, never queued (rule 08 test 1), so both
                // grey out offline.
                Section {
                    if rows.merge {
                        Button {
                            showMerge = true
                        } label: {
                            menuLabel("Merge with\u{2026}", systemImage: "arrow.triangle.merge")
                        }
                        .disabled(!connectivity.isOnline)
                        .accessibilityIdentifier("merge-open")
                    }
                    if rows.delete {
                        Button(role: .destructive) {
                            showDelete = true
                        } label: {
                            menuLabel(
                                DeleteSelectionCopy.menuLabel(hasFiles: !book.formats.isEmpty),
                                systemImage: "trash"
                            )
                        }
                        .disabled(!connectivity.isOnline)
                        .accessibilityIdentifier("delete-open")
                    }
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 17, weight: .semibold))
        }
        .menuOrder(.fixed)
        .buttonStyle(DiscButtonStyle())
        .accessibilityLabel("More")
        .accessibilityIdentifier("book-more")
    }

    private func menuRows(_ book: Book) -> BookMenuRows {
        let gate = KindleService.gate(
            hasSendableFile: book.hasEpub || book.hasPDF,
            epubSizeBytes: book.epubSizeBytes,
            kindleEmail: app.user?.kindleEmail,
            isOnline: connectivity.isOnline
        )
        return BookMenuRows.resolve(
            // `formats` empty is a record with nothing on disk: a wishlist
            // entry or a paper-only book has no file to export or bookmark.
            hasFiles: !book.formats.isEmpty,
            canDownload: app.user?.canDownload == true,
            canSendToKindle: !gate.isHidden,
            canEdit: canEditMetadata,
            wishlisted: model.wishlistEntry != nil,
            isAdmin: app.user?.isAdmin == true
        )
    }

    /// A row that needs the server: its reason beneath it while there is none.
    /// Two `Text`s in a menu row render as title + subtitle.
    @ViewBuilder
    private func menuLabel(_ title: String, systemImage: String) -> some View {
        Text(title)
        if !connectivity.isOnline { Text("Needs a connection") }
        Image(systemName: systemImage)
    }

    private func removeFromWishlist() {
        guard let book = model.book else { return }
        Task {
            do {
                let bookDeleted = try await UserDataService.removeWishlistEntry(uuid: book.uuid)
                Haptics.success()
                withAnimation(Motion.settle) {
                    model.wishlistEntry = nil
                    toast = "Removed from your wishlist"
                }
                if DetailRead.leavesAfterWishlistRemoval(
                    bookDeleted: bookDeleted,
                    hasFile: model.hasFile,
                    hasPhysical: book.hasPhysical
                ) {
                    dismiss()
                }
            } catch {
                withAnimation(Motion.settle) {
                    toast = (error as? APIError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
    }

    // MARK: - Toast

    /// Whatever the page has to report, parked above the action bar.
    @ViewBuilder
    private func toastLayer() -> some View {
        Group {
            if let result = mergeResult {
                MergeUndoToast(result: result, target: uuid) {
                    mergeResult = nil
                    Task { await model.load(uuid: uuid) }
                } onDismiss: {
                    mergeResult = nil
                }
            } else if let toast {
                StageToast(text: toast) {
                    withAnimation(Motion.settle) { self.toast = nil }
                }
                .task(id: toast) {
                    try? await Task.sleep(for: .seconds(4))
                    guard !Task.isCancelled else { return }
                    withAnimation(Motion.settle) { self.toast = nil }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 82)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Action bar

    /// The persistent action row: the one thing to do next, and the other
    /// ways into the book beside it.
    private func actionBar(_ book: Book) -> some View {
        HStack(spacing: 10) {
            if model.isWishlistOnly {
                Button {
                    Haptics.tap()
                    StoreLink.open(book: book, with: openURL)
                } label: {
                    Text("Find a copy")
                }
                .buttonStyle(BarCTAStyle())

                Button {
                    Haptics.tap()
                    showCheckIn = true
                } label: {
                    Text("Check in")
                }
                .buttonStyle(CheckInPillStyle())
            } else if !book.hasEbook, !book.hasAudiobook {
                // A physical-only record (a check-in): there is nothing to
                // open, so the bar states that instead of routing into a
                // reader or player that would come up empty.
                Text(book.hasPhysical ? "On your shelf · physical copy" : "No readable copy")
                    .font(.ui(15, weight: .medium))
                    .foregroundStyle(palette.ink1Color)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(Capsule().fill(palette.quietFill))
            } else {
                readingActions(book)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                palette.bg0Color.opacity(0.74)
            }
            .overlay(alignment: .top) { Hairline() }
            .ignoresSafeArea(edges: .bottom)
        }
    }

    @ViewBuilder
    private func readingActions(_ book: Book) -> some View {
        // Label and destination stay in lockstep: an action speaking of
        // listening opens the player, not the reader at page one.
        let toPlayer = DetailRead.resumesIntoPlayer(
            hasEbook: book.hasEbook,
            hasAudiobook: book.hasAudiobook,
            epubStarted: model.epubProgress != nil,
            audioSeconds: model.audioProgress?.audioPositionSeconds
        )

        Button {
            Haptics.tap()
            if toPlayer {
                listen(book)
            } else {
                leafTurns += 1
                read(book)
            }
        } label: {
            HStack(spacing: 9) {
                if toPlayer {
                    AudioBarsMark()
                } else {
                    Image(systemName: "book")
                        .font(.system(size: 18, weight: .medium))
                        .keyframeAnimator(initialValue: 1.0, trigger: leafTurns) { view, scale in
                            view.scaleEffect(x: reduceMotion ? 1 : scale)
                        } keyframes: { _ in
                            KeyframeTrack {
                                CubicKeyframe(-1, duration: 0.32)
                                CubicKeyframe(1, duration: 0.32)
                            }
                        }
                }
                Text(DetailRead.actionLabel(
                    status: model.readStatus,
                    hasPosition: model.hasPosition,
                    toPlayer: toPlayer,
                    chapter: model.currentChapter
                ))
            }
        }
        .buttonStyle(BarCTAStyle(covered: covered))
        .accessibilityIdentifier("book-primary-action")

        if book.hasEbook, book.hasAudiobook {
            // The other format keeps a door: Listen beside a reading action,
            // Read beside a listening one.
            let needsConnection = !toPlayer && !downloads.canOpen(book, kind: .audio)

            Button {
                Haptics.tap()
                if toPlayer {
                    read(book)
                } else {
                    listenPulses += 1
                    listen(book)
                }
            } label: {
                if toPlayer {
                    Image(systemName: "book")
                        .font(.system(size: 18, weight: .medium))
                } else {
                    AudioBarsMark(levels: [0.3, 1, 0.55, 0.8], pulse: listenPulses)
                }
            }
            .buttonStyle(BarRoundStyle(washed: true))
            .disabled(needsConnection)
            .opacity(needsConnection ? 0.45 : 1)
            .accessibilityLabel(
                toPlayer ? "Read" : needsConnection ? "Listen. The audiobook needs a connection." : "Listen"
            )
            .accessibilityIdentifier("book-listen")

            Button {
                Haptics.tap()
                immersiveRead(book)
            } label: {
                ImmersiveReadMark()
            }
            .buttonStyle(BarRoundStyle())
            .accessibilityLabel("Immersive read")
            .accessibilityIdentifier("bar-immersive-read")
        }
    }

    /// How much of the primary action reads as covered: the distance through
    /// the book, so the button itself says how far along you are.
    private var covered: Double {
        switch model.readStatus {
        case .finished: 1
        case .reading: model.fraction ?? 0
        case .unread: 0
        }
    }

    private func read(_ book: Book) {
        Presentation.shared.openReader(book)
    }

    /// The immersive read: the reader with the audiobook running under it —
    /// the docked mini bar keeps playback controllable while reading. Audio
    /// loads in the background (it resolves the saved-position file itself,
    /// and re-opening the playing book is a no-op) while the reader opens.
    private func immersiveRead(_ book: Book) {
        Task { await player.load(book: book) }
        Presentation.shared.openReader(book)
    }

    /// A book with one audiobook file opens straight into the player; one
    /// with several asks which — they don't share a timeline, so "Listen"
    /// alone can't say where to put the needle. The player resolves the
    /// saved-position file on its own for the single-file case.
    private func listen(_ book: Book) {
        if book.audioFiles.count > 1 {
            showAudioFilePicker = true
        } else {
            Presentation.shared.openPlayer(book)
        }
    }
}

/// The wishlist's second action: a washed pill rather than a filled one.
private struct CheckInPillStyle: ButtonStyle {
    @Environment(\.palette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(16, weight: .semibold))
            .foregroundStyle(palette.ink0Color)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 18)
            .frame(height: 52)
            .background(Capsule().fill(palette.bookWash))
            .overlay(Capsule().strokeBorder(palette.bookRim, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Motion.lift, value: configuration.isPressed)
    }
}
