//  PDFReaderView.swift
//  The native PDF reader: a PDFKit page-view-controller stage inside the
//  reader's chrome contract — bare on open, close button and a page slider
//  one centre tap away, the same indicator labels above and below the page
//  — with the passage menu over a text selection.
//
//  Lifecycle is the comic pager's: positions ride the Epub-format progress
//  row as a `pdf-page:N` anchor plus the cross-surface percent, read status
//  moves through `ReadStatusAuto`, reading sessions checkpoint and close the
//  same way. Highlights and bookmarks take the web reader's anchors
//  (`pdf:{page}:{quads}`, `pdf-page:N`) so a passage saved here paints there.

import PDFKit
import SwiftUI
import Translation

struct PDFReaderView: View {
    let book: Book

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @Environment(AudioPlayer.self) private var audio

    @State private var stage = PDFStageController()
    /// The document, once resolved. Doubles as the LifecycleSync registration
    /// token.
    @State private var document: PDFDocument?
    @State private var failureMessage: String?
    @State private var page = 0
    @State private var chromeVisible = false
    @State private var openedProgress: ProgressRecord?
    /// A further page another device reached, waiting on the reader to
    /// accept it. Never applied on its own.
    @State private var syncOfferPage: Int?
    @State private var sessionStart: Date?
    @State private var pushThrottle = PositionPushThrottle(interval: 4)
    @State private var showPlayer = false
    @State private var autoStatus: ReadStatusAuto?
    @State private var highlights: [Highlight] = []
    @State private var bookmarkCount = 0
    @State private var showContents = false
    @State private var contentsTab: PDFContentsSheet.Tab = .contents
    @State private var justBookmarked = false
    @State private var noteTarget: Highlight?
    @State private var quoteTarget: QuoteRequest?
    @State private var translateText = ""
    @State private var showTranslate = false

    private static let sessionCheckpointInterval: TimeInterval = 300

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let document {
                PDFStage(document: document, controller: stage, startPage: page, onTap: handleTap)
                    .ignoresSafeArea()
            } else if failureMessage == nil {
                LoadingView(label: "Opening \(book.displayTitle)")
            }

            if let failureMessage {
                ErrorStateView(message: failureMessage) { dismiss() }
            }

            indicators
            passageMenu

            if let offered = syncOfferPage {
                SyncOfferBanner(
                    onGo: {
                        page = offered
                        dismissSyncOffer()
                    },
                    onDismiss: dismissSyncOffer
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            chrome
        }
        .statusBarHidden(!chromeVisible)
        .persistentSystemOverlays(chromeVisible ? .automatic : .hidden)
        // The stage is black whatever the app theme, so the status bar and
        // any glass chrome have to resolve against a dark page.
        .preferredColorScheme(.dark)
        .task { await prepare() }
        .onChange(of: page) { _, newPage in
            stage.go(to: newPage)
            Task {
                await persist(force: false)
                let count = stage.pageCount
                if count > 0 {
                    await autoStatus?.positionChanged(atEnd: newPage == count - 1)
                }
            }
        }
        .onChange(of: stage.page) { _, turned in
            if page != turned { page = turned }
        }
        .onChange(of: highlights) { _, list in stage.paint(list) }
        .onChange(of: audio.isActive) { _, active in
            if !active { showPlayer = false }
        }
        .onDisappear {
            Task { await finish() }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                if audio.isActive {
                    MiniPlayerBar(onExpand: { showPlayer = true })
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(Motion.glide, value: audio.isActive)
        }
        .sheet(isPresented: $showContents) {
            PDFContentsSheet(
                book: book,
                outline: document.map(PDFOutlineItem.flatten) ?? [],
                currentPage: page,
                pageCount: stage.pageCount,
                highlights: highlights,
                initialTab: contentsTab,
                onJump: { target in page = target },
                onRemoveHighlight: { highlight in Task { await removeHighlight(highlight) } },
                onBookmarkCountChanged: { bookmarkCount = $0 }
            )
            .preferredColorScheme(appScheme)
        }
        .sheet(item: $noteTarget) { highlight in
            NoteComposer(quote: highlight.text, existing: highlight.note) { note in
                Task { await saveNote(note, on: highlight) }
            }
            .preferredColorScheme(appScheme)
        }
        .sheet(item: $quoteTarget) { request in
            QuoteCardSheet(quote: request.text, book: book)
                .preferredColorScheme(appScheme)
        }
        .translationPresentation(isPresented: $showTranslate, text: translateText)
        .fullScreenCover(isPresented: $showPlayer) {
            if let audioBook = audio.book {
                PlayerView(book: audioBook, fileID: audio.fileID)
                    .preferredColorScheme(appScheme)
            }
        }
    }

    private var appScheme: ColorScheme { appState.theme.colorScheme }

    // MARK: - Taps

    private func handleTap(_ zone: PDFTapZone) {
        switch zone {
        case .previous:
            guard page > 0 else { return }
            page -= 1
        case .next:
            guard page < stage.pageCount - 1 else { return }
            page += 1
        case .toggle:
            withAnimation(Motion.settle) { chromeVisible.toggle() }
        }
    }

    // MARK: - Chrome

    private var indicators: some View {
        VStack(spacing: 0) {
            indicatorLabel(document == nil ? nil : book.displayTitle)
                .padding(.top, Spacing.xs)
            Spacer(minLength: 0)
            indicatorLabel(pageLabel)
                .padding(.bottom, Spacing.xs)
        }
        .allowsHitTesting(false)
    }

    private var pageLabel: String? {
        let count = stage.pageCount
        guard document != nil, count > 0 else { return nil }
        return chromeVisible ? "\(page + 1) of \(count)" : "\(page + 1)"
    }

    @ViewBuilder
    private func indicatorLabel(_ text: String?) -> some View {
        if let text {
            Text(text)
                .font(.ui(12.5))
                .foregroundStyle(.white.opacity(0.5))
                .lineLimit(1)
                .frame(height: ReaderMenu.buttonSize)
                .padding(.horizontal, 72)
        }
    }

    @ViewBuilder
    private var chrome: some View {
        if chromeVisible {
            VStack {
                HStack {
                    Spacer()
                    ReaderGlassButton(
                        icon: "xmark",
                        label: "Close book",
                        ink: .white,
                        diameter: ReaderMenu.buttonSize
                    ) {
                        dismiss()
                    }
                }
                .padding(.horizontal, ReaderMenu.inset)
                .padding(.top, Spacing.xs)

                Spacer()

                VStack(alignment: .trailing, spacing: ReaderMenu.spacing) {
                    ReaderMenuRow(
                        title: "Contents",
                        icon: "list.bullet",
                        ink: .white
                    ) {
                        contentsTab = .contents
                        showContents = true
                    }
                    ReaderMenuRow(
                        title: "Bookmarks & Highlights",
                        count: bookmarkCount + highlights.count,
                        ink: .white
                    ) {
                        contentsTab = .bookmarks
                        showContents = true
                    }
                    HStack(spacing: ReaderMenu.spacing) {
                        Spacer()
                        ReaderGlassButton(
                            icon: justBookmarked ? "bookmark.fill" : "bookmark",
                            label: "Add bookmark",
                            ink: .white,
                            diameter: ReaderMenu.buttonSize
                        ) {
                            Task { await addBookmark() }
                        }
                    }
                    if stage.pageCount > 1 {
                        pageSlider(count: stage.pageCount)
                    }
                }
                .padding(.horizontal, ReaderMenu.inset)
                .padding(.top, 48)
                .padding(.bottom, 34)
                .frame(maxWidth: .infinity, alignment: .trailing)
                // The controls sit over the page as often as over the black
                // stage below it, and white ink on glass over white paper is
                // invisible — a scrim gives them one ground whatever page
                // shape is behind them.
                .background(
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.78)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .ignoresSafeArea()
                )
            }
            .transition(.opacity)
            .environment(\.colorScheme, .dark)
        }
    }

    /// The whole-book scrubber: one slider row, page-stepped. Exact from the
    /// first paint — a PDF's page count is the document's, not a locations
    /// pass.
    private func pageSlider(count: Int) -> some View {
        Slider(
            value: Binding(
                get: { Double(page) },
                set: { page = Int($0.rounded()) }
            ),
            in: 0...Double(count - 1),
            step: 1
        )
        .tint(.white.opacity(0.85))
        .padding(.horizontal, 18)
        .frame(width: ReaderMenu.width, height: ReaderMenu.rowHeight)
        .glassEffect(.regular, in: .capsule)
        .accessibilityLabel("Page")
        .accessibilityValue("Page \(page + 1) of \(count)")
    }

    private func dismissSyncOffer() {
        withAnimation(Motion.settle) { syncOfferPage = nil }
    }

    // MARK: - Passage menu

    /// What the menu is over: a live selection or a tapped stored highlight.
    private enum Passage: Equatable {
        case selection(PDFSelectionData)
        case highlight(Highlight, [PageRect])

        var rects: [PageRect] {
            switch self {
            case let .selection(data): data.rects
            case let .highlight(_, rects): rects
            }
        }

        var id: String {
            switch self {
            case let .selection(data): "selection:\(data.anchor)"
            case let .highlight(highlight, _): "highlight:\(highlight.pathID)"
            }
        }
    }

    private var passage: Passage? {
        if let tapped = stage.tappedHighlight {
            return .highlight(tapped.highlight, tapped.rects)
        }
        if let selection = stage.selection {
            return .selection(selection)
        }
        return nil
    }

    private func storedHighlight(_ passage: Passage) -> Highlight? {
        guard case let .highlight(highlight, _) = passage else { return nil }
        return highlights.first { $0.id == highlight.id } ?? highlight
    }

    private func passageText(_ passage: Passage) -> String {
        switch passage {
        case let .selection(data): data.text
        case let .highlight(highlight, _): highlight.text ?? ""
        }
    }

    @ViewBuilder
    private var passageMenu: some View {
        if let passage {
            // A tapped highlight has no stage-side state to dismiss it, so the
            // scrim is what closes it. A live selection needs none: the stage
            // clears it on the next tap.
            if case .highlight = passage {
                Color.clear
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .onTapGesture { dismissPassage() }
            }

            PassageAnchor(
                rects: passage.rects,
                width: AnnotationMenu.width,
                height: AnnotationMenu.height
            ) { tail in
                let stored = storedHighlight(passage)
                AnnotationMenu(
                    current: stored?.color,
                    hasNote: stored?.note?.nilIfBlank != nil,
                    theme: "black",
                    onColor: { color in Task { await apply(color, to: passage) } },
                    onAction: { action in Task { await run(action, on: passage) } },
                    canRemove: stored != nil,
                    tail: tail
                )
            }
            .id(passage.id)
            .transition(.opacity.combined(with: .scale(scale: 0.94)))
        }
    }

    private func dismissPassage() {
        withAnimation(Motion.snap) { stage.tappedHighlight = nil }
        if stage.selection != nil { stage.clearSelection() }
    }

    private func apply(_ color: HighlightColor, to passage: Passage) async {
        if let stored = storedHighlight(passage) {
            await recolor(stored, to: color)
            return
        }
        guard case let .selection(selection) = passage else { return }
        await createHighlight(selection, color: color)
    }

    private func run(_ action: PassageAction, on passage: Passage) async {
        let text = passageText(passage)
        switch action {
        case .note:
            if let stored = storedHighlight(passage) {
                dismissPassage()
                noteTarget = stored
            } else if case let .selection(selection) = passage,
                      let created = await createHighlight(selection, color: .amber)
            {
                noteTarget = created
            }
        case .quote:
            dismissPassage()
            quoteTarget = QuoteRequest(text: text)
        case .copy:
            UIPasteboard.general.string = text
            Haptics.success()
            dismissPassage()
        case .lookUp:
            dismissPassage()
            DictionaryLookup.present(text)
        case .translate:
            dismissPassage()
            translateText = text
            showTranslate = true
        case .share:
            dismissPassage()
            ShareSheet.present(items: [text])
        case .remove:
            guard let stored = storedHighlight(passage) else { return }
            await removeHighlight(stored)
        }
    }

    // MARK: - Annotations

    @discardableResult
    private func createHighlight(_ selection: PDFSelectionData, color: HighlightColor) async -> Highlight? {
        stage.clearSelection()
        Haptics.success()
        let created = await UserDataService.createHighlight(
            CreateHighlight(
                bookUUID: book.uuid,
                epubCFIRange: selection.anchor,
                color: color,
                text: selection.text
            )
        )
        if let created { highlights.append(created) }
        return created
    }

    private func recolor(_ highlight: Highlight, to color: HighlightColor) async {
        stage.tappedHighlight = nil
        update(highlight) { $0.color = color }
        await UserDataService.setHighlightColor(highlight, color: color)
    }

    private func saveNote(_ note: String?, on highlight: Highlight) async {
        update(highlight) { $0.note = note }
        Haptics.success()
        await UserDataService.setHighlightNote(highlight, note: note)
    }

    private func removeHighlight(_ highlight: Highlight) async {
        stage.tappedHighlight = nil
        highlights.removeAll { $0.id == highlight.id }
        Haptics.warning()
        await UserDataService.deleteHighlight(highlight)
    }

    private func update(_ highlight: Highlight, _ change: (inout Highlight) -> Void) {
        guard let index = highlights.firstIndex(where: { $0.id == highlight.id }) else { return }
        change(&highlights[index])
    }

    private func addBookmark() async {
        Haptics.success()
        withAnimation(Motion.snap) { justBookmarked = true }
        bookmarkCount += 1
        await UserDataService.createBookmark(
            CreateBookmark(
                bookUUID: book.uuid,
                position: PDFPosition.anchor(page: page),
                title: "Page \(page + 1)"
            )
        )
        try? await Task.sleep(for: .seconds(1.2))
        withAnimation(Motion.snap) { justBookmarked = false }
    }

    // MARK: - Lifecycle

    private func prepare() async {
        guard document == nil, failureMessage == nil else { return }

        // Open from what this device already knows, with no network in the
        // path — a downloaded PDF must open with the server gone.
        let local = await UserDataService.localProgress(uuid: book.uuid, format: .epub)
        openedProgress = local

        let opened = await PDFDocumentSource.open(book: book)
        let source: PDFDocument
        switch opened {
        case let .success(doc): source = doc
        case let .failure(failure):
            failureMessage = failure.message
            return
        }
        guard source.pageCount > 0 else {
            failureMessage = "This PDF has no pages."
            return
        }

        var start = PDFPosition.startPage(
            anchor: local?.epubCFI,
            percent: local?.progressPercent,
            count: source.pageCount
        )
        let remote = Task { @MainActor in
            await PositionSync.newerRemote(uuid: book.uuid, format: .epub, than: local)
        }
        if let settled = await firstResult(of: remote, within: PositionSync.openDeadline) {
            start = resumePage(of: settled, count: source.pageCount)
        }

        page = start
        stage.page = start
        document = source
        sessionStart = Date()

        let tracker = ReadStatusAuto(uuid: book.uuid)
        autoStatus = tracker
        let openedAtEnd = start == source.pageCount - 1
        Task {
            await tracker.positionChanged(atEnd: openedAtEnd)
            await tracker.bookOpened()
        }

        LifecycleSync.shared.register(source) {
            await persist(force: true)
            await checkpointSession()
        } resume: {
            if sessionStart == nil { sessionStart = Date() }
        }
        LifecycleSync.shared.didOpenBook()

        await reconcileWithServer(remote: remote, count: source.pageCount)
    }

    /// Fold in what the server has: annotations merge silently, a further
    /// position becomes an offer rather than a jump.
    private func reconcileWithServer(remote: Task<ProgressRecord?, Never>, count: Int) async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in
                for await items in UserDataService.highlights(uuid: book.uuid).values() {
                    highlights = items
                }
            }
            group.addTask { @MainActor in
                for await items in UserDataService.bookmarks(uuid: book.uuid).values() {
                    bookmarkCount = items.count
                }
            }
            group.addTask { @MainActor in
                guard let record = await remote.value else { return }
                let offered = resumePage(of: record, count: count)
                if offered != page {
                    withAnimation(Motion.settle) { syncOfferPage = offered }
                }
            }
        }
    }

    private func resumePage(of record: ProgressRecord, count: Int) -> Int {
        PDFPosition.startPage(
            anchor: record.epubCFI,
            percent: record.progressPercent,
            count: count
        )
    }

    /// Record where the reader is — the replica and the outbox on every
    /// turn, the network at most once every four seconds unless forced.
    private func persist(force: Bool) async {
        let count = stage.pageCount
        guard document != nil, count > 0 else { return }
        let clamped = min(max(page, 0), count - 1)
        await UserDataService.saveProgress(
            ProgressUpdate(
                bookUUID: book.uuid,
                format: .epub,
                epubCFI: PDFPosition.anchor(page: clamped),
                audioPositionSeconds: nil,
                progressPercent: PDFPosition.percent(page: clamped, count: count)
            ),
            push: pushThrottle.shouldPush(force: force)
        )
        await checkpointSessionIfStale()
    }

    private func checkpointSessionIfStale() async {
        guard let start = sessionStart,
              Date().timeIntervalSince(start) >= Self.sessionCheckpointInterval
        else { return }
        await checkpointSession(restarting: true)
    }

    private func checkpointSession(restarting: Bool = false) async {
        guard let start = sessionStart else { return }
        let end = Date()
        sessionStart = restarting ? end : nil
        let elapsed = Int64(end.timeIntervalSince(start))
        guard elapsed >= 5 else {
            if restarting { sessionStart = start }
            return
        }
        await UserDataService.reportSessions([
            SessionReport(
                bookUUID: book.uuid,
                format: .epub,
                startedAt: Int64(start.timeIntervalSince1970),
                endedAt: Int64(end.timeIntervalSince1970),
                progressUnits: elapsed,
                deviceId: nil
            )
        ])
    }

    private func finish() async {
        if let document { LifecycleSync.shared.unregister(document) }
        await persist(force: true)
        await checkpointSession()
        Presentation.shared.noteProgressPersisted()
        LifecycleSync.shared.didCloseBook()
    }
}
