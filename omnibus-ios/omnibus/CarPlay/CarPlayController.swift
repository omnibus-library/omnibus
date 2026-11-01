//  CarPlayController.swift
//  The car's two tabs — Continue and Library — and the sign-in gate in front of them.
//
//  Reads go through the same local-first services the phone uses, so a car
//  with no signal still lists what this device holds. Continue re-reads each
//  time it appears and when the connection returns; Library only when it can
//  have changed — a sign-in, an empty list, the connection back, a pass the
//  server cut short — since a re-read pages through all of it.
//  Rows are kept, not rebuilt: an updated CarPlay list jumps back to its top,
//  and a row that leaves it takes its spinner along. So each book keeps its
//  `CPListItem`, updated in place when a tab appears, the loaded book changes
//  or the connection flips — never per position tick, as the rail is rewritten
//  twice a second while playing — and a list updates only when which rows it
//  holds, or their order, changes.
//  Now Playing and the Chapters list live in `CarPlayNowPlaying`.

#if canImport(CarPlay)
import CarPlay
import Observation

@MainActor
final class CarPlayController: NSObject, CPInterfaceControllerDelegate {
    private let interface: CPInterfaceController
    private let player = AudioPlayer.shared
    private let nowPlaying: CarPlayNowPlaying
    private let continueList: CPListTemplate
    private let libraryList: CPListTemplate

    private var showsTabs = false
    private var isStopped = false
    /// Bumped by each `showRoot`; only the latest acts on what it found.
    private var rootRequest = 0
    /// The root last asked for; only its `setRoot` tells Now Playing.
    private var wantedRoot: CPTemplate?
    /// The account the lists were read for.
    private var account: CarPlayContent.Account?
    /// The connection as the rows last saw it, to tell a return online.
    private var wasOnline = true
    /// The rows on screen; `nil` until the first answer, and after a read that
    /// failed, so the empty message never stands in for what isn't known.
    private var continuePoints: [ResumePoint]?
    private var libraryBooks: [Book]?
    /// The last Library pass ended without the server reaching the end of the
    /// list, so the rows may be short or stale.
    private var libraryPassCutShort = false
    /// One per list: a `CPListItem` can't be shared across the two tabs.
    private var continueRows = ListedRows()
    private var libraryRows = ListedRows()
    private var covers: [String: UIImage] = [:]
    /// A tab's read while it runs; cleared once it finishes.
    private var continueRead: Task<Void, Never>?
    private var libraryRead: Task<Void, Never>?
    private var coverLoad: Task<Void, Never>?
    /// A render found a cover pass running, so one more follows it.
    private var coverPassWanted = false
    /// A connect's read, until the first template appears: reading Continue
    /// again for that appear would only repeat it.
    private var connectReadStands = false
    /// The book a row tap is opening, until it plays.
    private var opening: Opening?
    private var sessionObservers: [NSObjectProtocol] = []

    init(interface: CPInterfaceController) {
        self.interface = interface
        nowPlaying = CarPlayNowPlaying(interface: interface)
        continueList = Self.tab("Continue", symbol: "play.circle")
        libraryList = Self.tab("Library", symbol: "books.vertical")
        super.init()
    }

    func start() {
        interface.delegate = self
        nowPlaying.start()
        // A sign-in on the phone, a sign-out, or a session the server revoked.
        for name in [Notification.Name.omnibusSessionChanged, .omnibusUnauthorized] {
            sessionObservers.append(
                NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) {
                    [weak self] _ in
                    MainActor.assumeIsolated { self?.showRoot() }
                }
            )
        }
        wasOnline = Connectivity.shared.isOnline
        observeRowState()
        showRoot()
    }

    func stop() {
        isStopped = true
        nowPlaying.stop()
        sessionObservers.forEach(NotificationCenter.default.removeObserver)
        sessionObservers = []
        cancelReads()
        abandonOpening()
    }

    private func cancelReads() {
        for task in [continueRead, libraryRead, coverLoad] { task?.cancel() }
        coverLoad = nil
        coverPassWanted = false
    }

    // MARK: - Root

    private static func tab(_ title: String, symbol: String) -> CPListTemplate {
        let list = CPListTemplate(title: title, sections: [])
        list.tabTitle = title
        list.tabImage = UIImage(systemName: symbol)
        return list
    }

    /// The tabs when signed in, otherwise a message sending the driver to the
    /// phone — there is no sign-in in the car.
    private func showRoot() {
        rootRequest += 1
        let request = rootRequest
        Task {
            // The car may be what launched the process.
            await Startup.prepare()
            let signedIn = await Self.signedInAccount()
            // A sign-out and a sign-in in quick succession: the later look decides.
            guard !isStopped, request == rootRequest else { return }
            guard let signedIn else {
                showsTabs = false
                forgetAccount()
                let message = CPListTemplate(title: "Omnibus", sections: [])
                apply(CarPlayContent.signedOut, to: message)
                await setRoot(message, signedIn: false)
                return
            }
            let connecting = !showsTabs
            showsTabs = true
            // Read before the root goes up: setting it makes a tab appear, and
            // neither tab starts over a read already running for it.
            if let same = CarPlayContent.sameAccount(held: account, signedIn: signedIn) {
                account = same
                // The launch shows the root twice; reading again would only repeat the first pass.
                if CarPlayContent.rereads(shown: continuePoints, isReading: continueRead != nil) {
                    reloadContinue()
                }
                if libraryRereads {
                    reloadLibrary()
                }
            } else {
                forgetAccount()
                account = signedIn
                reloadContinue()
                reloadLibrary()
            }
            if connecting {
                connectReadStands = true
                await setRoot(CPTabBarTemplate(templates: [continueList, libraryList]), signedIn: true)
            }
        }
    }

    /// The account signed in on the phone, or `nil` when no one is.
    private static func signedInAccount() async -> CarPlayContent.Account? {
        guard let server = ServerURLStore.load(), let session = await APIClient.shared.sessionID() else {
            return nil
        }
        return CarPlayContent.Account(
            server: server, userID: await AuthService.localMe()?.id, session: session
        )
    }

    /// Replace the root, then let Now Playing raise again what it took down.
    private func setRoot(_ root: CPTemplate, signedIn: Bool) async {
        wantedRoot = root
        _ = try? await interface.setRootTemplate(root, animated: false)
        // Roots set in quick succession can finish in any order; the last one asked for is the car's.
        guard !isStopped, wantedRoot === root else { return }
        nowPlaying.rootDidChange(signedIn: signedIn)
    }

    /// Run `read` in `slot`, in place of the read there, and empty the slot
    /// once it finishes — an empty slot is a tab with nothing loading.
    private func replace(
        _ slot: ReferenceWritableKeyPath<CarPlayController, Task<Void, Never>?>,
        with read: @escaping @MainActor () async -> Void
    ) {
        self[keyPath: slot]?.cancel()
        let task = Task { await read() }
        self[keyPath: slot] = task
        Task {
            await task.value
            if self[keyPath: slot] == task { self[keyPath: slot] = nil }
        }
    }

    /// Drop everything the signed-out account's lists held, so the next
    /// sign-in — another account, or another server — never shows its titles.
    private func forgetAccount() {
        account = nil
        cancelReads()
        abandonOpening()
        continuePoints = nil
        libraryBooks = nil
        libraryPassCutShort = false
        covers = [:]
        continueRows = ListedRows()
        libraryRows = ListedRows()
        for list in [continueList, libraryList] {
            list.emptyViewTitleVariants = []
            list.emptyViewSubtitleVariants = []
            list.updateSections([])
        }
    }

    /// Set what `list` says with no rows; `true` if that's new.
    @discardableResult
    private func apply(_ message: CarPlayContent.Message, to list: CPListTemplate) -> Bool {
        guard list.emptyViewTitleVariants != [message.title] else { return false }
        list.emptyViewTitleVariants = [message.title]
        list.emptyViewSubtitleVariants = [message.detail]
        return true
    }

    // MARK: - Continue

    private func reloadContinue() {
        replace(\.continueRead) { [weak self] in await self?.readContinue() }
    }

    private func readContinue() async {
        var answered = false
        do {
            for try await answer in UserDataService.recentAudio() {
                guard !Task.isCancelled else { return }
                answered = true
                continuePoints = Array(
                    answer.value.filter(\.isAudio).prefix(UserDataService.recentAudioLimit)
                )
                renderContinue()
            }
            // A save queued during the fetch ends the read with no replica to offer.
            if answered { return }
        } catch {
            // Handled below, as no answer is.
        }
        // Rows on screen stay; an empty list would claim nothing is in progress.
        guard !Task.isCancelled, CarPlayContent.showsReadFailure(shown: continuePoints) else { return }
        continuePoints = nil
        show([], whenEmpty: CarPlayContent.readFailed, on: continueList, listed: \.continueRows)
    }

    private func renderContinue() {
        // Nothing answered yet: the empty message would claim nothing is in progress.
        guard let continuePoints else { return }
        let rows = continuePoints.map { point in
            // The record names the file the listen was in, which may not be
            // the book's default narration.
            Row(
                book: point.book, detail: CarPlayContent.continueDetail(point),
                progress: point.fraction, known: point.record
            )
        }
        show(rows, whenEmpty: CarPlayContent.nothingInProgress, on: continueList, listed: \.continueRows)
    }

    // MARK: - Library

    private func reloadLibrary() {
        replace(\.libraryRead) { [weak self] in await self?.readLibrary() }
    }

    /// Whether Library reads again for a session change or its tab appearing.
    private var libraryRereads: Bool {
        CarPlayContent.rereads(
            shown: libraryBooks, isReading: libraryRead != nil, cutShort: libraryPassCutShort
        )
    }

    /// Every audiobook, newest added first, page by page up to what CarPlay
    /// lets a list hold. A pass the server answered to the end drops the rows
    /// it didn't find; one cut short leaves them, and is remembered for a re-read.
    private func readLibrary() async {
        let cap = CPListTemplate.maximumItemCount
        var books: [Book] = []
        var cursor: String?
        while let page = await readLibraryPage(at: cursor, after: books, cap: cap) {
            let step = CarPlayContent.libraryPassStep(
                cursor: cursor, isFresh: page.isFresh, gained: page.books.count > books.count,
                next: page.next, isFull: page.books.count >= cap
            )
            books = page.books
            switch step {
            case let .read(next):
                cursor = next
            case .finished:
                libraryPassCutShort = false
                libraryBooks = Array(books.prefix(cap))
                renderLibrary()
                return
            case .cutShort:
                libraryPassCutShort = true
                return
            }
        }
        // A cancelled pass has left all this to whatever replaced it.
        if !Task.isCancelled { libraryPassCutShort = true }
    }

    /// The page at `cursor` added to `read`, by its last answer. Each answer
    /// shows as it lands — the replica's before the server's — save the one
    /// `CarPlayContent.showsAtOnce` holds back, shown only if nothing follows it.
    private func readLibraryPage(
        at cursor: String?, after read: [Book], cap: Int
    ) async -> (books: [Book], next: String?, isFresh: Bool)? {
        var last: (books: [Book], next: String?, isFresh: Bool)?
        var heldBack = false
        do {
            for try await answer in LibraryService.page(
                sort: .newestAdded, direction: .desc,
                filter: LibraryCategory.audiobooks.filter, cursor: cursor
            ) {
                guard !Task.isCancelled else { return nil }
                let books = CarPlayContent.appending(answer.value.books, to: read)
                last = (books, answer.value.nextCursor, answer.isFresh)
                heldBack = !CarPlayContent.showsAtOnce(books, isFresh: answer.isFresh)
                if !heldBack {
                    let keepingPlaces = CarPlayContent.isFallback(cursor: cursor, isFresh: answer.isFresh)
                    showLibrary(books, keepingPlaces: keepingPlaces, cap: cap)
                }
            }
        } catch {
            // An empty replica the failure stands behind answered nothing;
            // no answer, however the read ended, is handled below.
            if heldBack { last = nil }
        }
        guard !Task.isCancelled else { return nil }
        guard let last else {
            // Rows on screen stay; an empty list would claim there are no audiobooks.
            if CarPlayContent.showsReadFailure(shown: libraryBooks) {
                libraryBooks = nil
                show([], whenEmpty: CarPlayContent.readFailed, on: libraryList, listed: \.libraryRows)
            }
            return nil
        }
        if heldBack { showLibrary(last.books, cap: cap) }
        return last
    }

    /// What a pass has read so far, ahead of the rows it hasn't reached.
    private func showLibrary(_ read: [Book], keepingPlaces: Bool = false, cap: Int) {
        let rows = CarPlayContent.libraryRows(read: read, shown: libraryBooks, keepingPlaces: keepingPlaces)
        libraryBooks = Array(rows.prefix(cap))
        renderLibrary()
    }

    private func renderLibrary() {
        // Nothing answered yet: the empty message would claim there are no audiobooks.
        guard let libraryBooks else { return }
        let rows = libraryBooks.map {
            Row(book: $0, detail: $0.authorDisplay, progress: nil, known: nil)
        }
        show(rows, whenEmpty: CarPlayContent.noAudiobooks, on: libraryList, listed: \.libraryRows)
    }

    // MARK: - Rows

    /// What one row shows, and what tapping it opens.
    private struct Row {
        var book: Book
        var detail: String?
        var progress: Double?
        var known: ProgressRecord?
    }

    /// A list's items by book uuid, and the uuids in the order it holds them.
    private struct ListedRows {
        var items: [String: CPListItem] = [:]
        var order: [String] = []
    }

    /// Bring `list` up to `rows`: a book already listed keeps its item.
    private func show(
        _ rows: [Row], whenEmpty message: CarPlayContent.Message, on list: CPListTemplate,
        listed slot: ReferenceWritableKeyPath<CarPlayController, ListedRows>
    ) {
        let listed = self[keyPath: slot]
        let items = rows.map { row in
            let item = listed.items[row.book.uuid] ?? newItem(for: row)
            update(item, to: row)
            return item
        }
        let order = rows.map(\.book.uuid)
        self[keyPath: slot] = ListedRows(
            items: Dictionary(zip(order, items), uniquingKeysWith: { first, _ in first }), order: order
        )
        let isNewMessage = apply(message, to: list)
        if CarPlayContent.updatesSections(shown: listed.order, next: order, isNewMessage: isNewMessage) {
            list.updateSections(items.isEmpty ? [] : [CPListSection(items: items)])
        }
        loadCovers()
    }

    private func newItem(for row: Row) -> CPListItem {
        let item = CPListItem(
            text: row.book.displayTitle, detailText: nil, image: covers[row.book.uuid]
        )
        item.playingIndicatorLocation = .trailing
        return item
    }

    /// Set what changed on `item`. Greyed out when it can't play here — offline
    /// and not downloaded — by the same rule the phone applies before opening it.
    private func update(_ item: CPListItem, to row: Row) {
        let book = row.book
        let canPlay = DownloadManager.shared.canOpen(book, kind: .audio)
        let detail = canPlay ? row.detail : CarPlayContent.notDownloaded
        let progress = CGFloat(row.progress ?? 0)
        let isPlaying = player.book?.uuid == book.uuid
        if item.text != book.displayTitle { item.setText(book.displayTitle) }
        if item.detailText != detail { item.setDetailText(detail) }
        if item.isEnabled != canPlay { item.isEnabled = canPlay }
        if item.playbackProgress != progress { item.playbackProgress = progress }
        if item.isPlaying != isPlaying { item.isPlaying = isPlaying }
        // Always: `known` moves with each Continue read.
        let known = row.known
        item.handler = { [weak self] _, completion in
            MainActor.assumeIsolated {
                guard let self else { return completion() }
                self.play(book, known: known, then: completion)
            }
        }
    }

    /// A row tap in flight: its book, its task, and the row's spinner.
    private struct Opening {
        var uuid: String
        var task: Task<Void, Never>
        var spinner: RowSpinner
    }

    /// A row's completion handler, run at most once — by the tap's own task,
    /// or sooner when another tap or a disconnect abandons it.
    private final class RowSpinner {
        private var done: (() -> Void)?
        init(_ done: @escaping () -> Void) { self.done = done }
        func stop() {
            done?()
            done = nil
        }
    }

    /// Start `book`, then show Now Playing. The row spins until the book is
    /// playing, so Now Playing opens on it rather than on the book before.
    private func play(_ book: Book, known: ProgressRecord?, then done: @escaping () -> Void) {
        // CarPlay keeps a spinning row tappable, and each tap started another
        // load. Another book's row takes over: a load that hangs mustn't
        // hold every row, and `load` lets a newer load supersede it.
        if opening?.uuid == book.uuid { return done() }
        abandonOpening()
        let spinner = RowSpinner(done)
        let task = Task {
            defer { spinner.stop() }
            guard !Task.isCancelled, !isStopped else { return }
            // No file named: `load` resumes the file `known` or the saved
            // position was taken in, else the book's default.
            await player.load(book: book, known: known)
            guard !Task.isCancelled, !isStopped, player.book?.uuid == book.uuid else { return }
            // A failed load keeps the list, and says why rather than opening
            // Now Playing on nothing — or on the book before.
            if let error = player.error {
                nowPlaying.showLoadFailure(error)
            } else {
                nowPlaying.show()
            }
        }
        opening = Opening(uuid: book.uuid, task: task, spinner: spinner)
        Task {
            await task.value
            if opening?.task == task { opening = nil }
        }
    }

    /// Give up on the tap in flight: it shows nothing when its load lands.
    private func abandonOpening() {
        opening?.task.cancel()
        opening?.spinner.stop()
        opening = nil
    }

    /// Covers for what the lists hold, one at a time off the disk cache, fetched
    /// when missing. CarPlay doesn't load list images lazily, so they arrive
    /// after the rows rather than holding them back. One pass runs at a time and
    /// looks at the lists afresh each step, so a render never restarts it. What
    /// the pass has already tried it won't try again, so a render during one asks
    /// for one more after it: bounded, as a pass triggers no render of its own.
    private func loadCovers() {
        guard coverLoad == nil else {
            coverPassWanted = true
            return
        }
        coverLoad = Task {
            let scale = interface.carTraitCollection.displayScale
            var tried: Set<String> = []
            while !Task.isCancelled, let book = nextCover(skipping: tried) {
                tried.insert(book.uuid)
                await loadCover(of: book, scale: scale)
            }
            // A cancelled pass has left the slot to whatever replaced it.
            guard !Task.isCancelled else { return }
            coverLoad = nil
            if coverPassWanted {
                coverPassWanted = false
                loadCovers()
            }
        }
    }

    private func nextCover(skipping tried: Set<String>) -> Book? {
        let isMissing = { [covers] (book: Book) in covers[book.uuid] == nil && !tried.contains(book.uuid) }
        return continuePoints?.lazy.map(\.book).first(where: isMissing)
            ?? libraryBooks?.first(where: isMissing)
    }

    private func loadCover(of book: Book, scale: CGFloat) async {
        let art = book.coverURL == nil ? nil : await Self.art(for: book)
        guard !Task.isCancelled else { return }
        // A cover that didn't load shows its plate for now and is tried again
        // on the next pass.
        let isFinal = art != nil || book.coverURL == nil
        let rows = [continueRows.items[book.uuid], libraryRows.items[book.uuid]]
            .compactMap { $0 }
            .filter { isFinal || $0.image == nil }
        // Square: the shape of the row's image slot, and of most audiobook art.
        guard CarPlayContent.drawsCover(isFinal: isFinal, rowsWanting: rows.count),
              let tile = CoverBitmap.render(
                  CoverIdentity(book), art: art, size: CPListItem.maximumImageSize,
                  cornerRadius: 4, scale: scale
              )
        else { return }
        if isFinal { covers[book.uuid] = tile }
        for item in rows { item.setImage(tile) }
    }

    private static func art(for book: Book) async -> UIImage? {
        let key = "/api/thumbs/\(book.uuid)/\(ThumbSize.sm.rawValue)"
        if let image = await ImageCache.shared.image(for: key) { return image }
        // `prefetch` has no reachability guard: offline, each missing cover
        // would wait out a request timeout, one by one, on every render.
        guard Connectivity.shared.isOnline else { return nil }
        await ImageCache.shared.prefetch(key)
        return await ImageCache.shared.image(for: key)
    }

    // MARK: - Updates

    /// Update the rows when what they show changes underneath them: a
    /// different book loads — from the car, the phone, or a play command —
    /// or the connection comes or goes, which decides their greying.
    private func observeRowState() {
        withObservationTracking {
            _ = player.book?.uuid
            _ = Connectivity.shared.isOnline
        } onChange: { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                guard !self.isStopped else { return }
                let online = Connectivity.shared.isOnline
                let cameOnline = online && !self.wasOnline
                self.wasOnline = online
                if self.showsTabs {
                    self.renderContinue()
                    self.renderLibrary()
                    // What the replica didn't hold reaches the lists once the server answers.
                    if cameOnline {
                        self.reloadContinue()
                        self.reloadLibrary()
                    }
                }
                self.observeRowState()
            }
        }
    }

    func templateWillAppear(_ aTemplate: CPTemplate, animated: Bool) {
        // The tab bar appearing says nothing about its tabs.
        guard showsTabs, aTemplate !== wantedRoot else { return }
        let isFirstAppear = connectReadStands
        connectReadStands = false
        if aTemplate === continueList {
            // Always afresh: a read begun before the listening just done answers
            // with the progress from before it. Save a connect's, just begun.
            if !isFirstAppear { reloadContinue() }
        } else if aTemplate === libraryList {
            if libraryRereads {
                reloadLibrary()
            } else {
                // Greying and covers can change while away; the rows only on a re-read.
                renderLibrary()
            }
        }
    }
}
#endif
