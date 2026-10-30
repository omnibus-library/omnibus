//  CarPlayController.swift
//  The car's two tabs — Continue and Library — and the sign-in gate in front of them.
//
//  Reads go through the same local-first services the phone uses, so a car
//  with no signal still lists what this device holds. Lists are rebuilt when a
//  tab appears, the loaded book changes or the connection flips, never per
//  position tick: the rail is rewritten twice a second while playing, and an
//  updated CarPlay list jumps back to its top. Now Playing and the Chapters
//  list live in `CarPlayNowPlaying`.

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
    private var continuePoints: [ResumePoint] = []
    /// The Library rows on screen; `nil` until the first answer, so the empty
    /// message never stands in for a list still loading.
    private var libraryBooks: [Book]?
    private var covers: [String: UIImage] = [:]
    /// A tab's read while it runs; cleared once it finishes.
    private var continueRead: Task<Void, Never>?
    private var libraryRead: Task<Void, Never>?
    private var continueCovers: Task<Void, Never>?
    private var libraryCovers: Task<Void, Never>?
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
        for task in [continueRead, libraryRead, continueCovers, libraryCovers] { task?.cancel() }
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
        Task {
            // The car may be what launched the process.
            await Startup.prepare()
            let signedIn = ServerURLStore.load() != nil ? await APIClient.shared.hasToken() : false
            guard !isStopped else { return }
            guard signedIn else {
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
            // `templateWillAppear` leaves a read already running alone.
            reloadContinue()
            reloadLibrary()
            if connecting {
                await setRoot(CPTabBarTemplate(templates: [continueList, libraryList]), signedIn: true)
            }
        }
    }

    /// Replace the root, then let Now Playing raise again what it took down.
    private func setRoot(_ root: CPTemplate, signedIn: Bool) async {
        _ = try? await interface.setRootTemplate(root, animated: false)
        guard !isStopped else { return }
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
        cancelReads()
        abandonOpening()
        continuePoints = []
        libraryBooks = nil
        covers = [:]
        continueList.updateSections([])
        libraryList.updateSections([])
    }

    private func apply(_ message: CarPlayContent.Message, to list: CPListTemplate) {
        list.emptyViewTitleVariants = [message.title]
        list.emptyViewSubtitleVariants = [message.detail]
    }

    // MARK: - Continue

    private func reloadContinue() {
        replace(\.continueRead) { [weak self] in
            for await points in UserDataService.recentAudio().values() {
                guard let self, !Task.isCancelled else { return }
                self.continuePoints = Array(
                    points.filter(\.isAudio).prefix(UserDataService.recentAudioLimit)
                )
                self.renderContinue()
            }
        }
    }

    private func renderContinue() {
        let items = continuePoints.map { point in
            // The record names the file the listen was in, which may not be
            // the book's default narration.
            row(
                for: point.book, detail: CarPlayContent.continueDetail(point),
                progress: point.fraction, known: point.record
            )
        }
        apply(CarPlayContent.nothingInProgress, to: continueList)
        continueList.updateSections(items.isEmpty ? [] : [CPListSection(items: items)])
        continueCovers?.cancel()
        continueCovers = loadCovers(continuePoints.map(\.book), into: items)
    }

    // MARK: - Library

    private func reloadLibrary() {
        replace(\.libraryRead) { [weak self] in await self?.readLibrary() }
    }

    /// Every audiobook, newest added first, page by page up to what CarPlay
    /// lets a list hold. A list already on screen stays until this pass has
    /// as many rows or reaches the end: a reload never shrinks it mid-scroll.
    private func readLibrary() async {
        let cap = CPListTemplate.maximumItemCount
        var books: [Book] = []
        var cursor: String?
        var isWhole = false
        repeat {
            var page: LibraryPageResult?
            for await answer in LibraryService.page(
                sort: .newestAdded, direction: .desc,
                filter: LibraryCategory.audiobooks.filter, cursor: cursor
            ).values() {
                guard !Task.isCancelled else { return }
                page = answer
                // The first page paints from the replica before the server answers.
                if cursor == nil { showLibrary(Array(answer.books.prefix(cap)), isWhole: false) }
            }
            guard let page else { break }
            if cursor != nil {
                let before = books.count
                books = CarPlayContent.appending(page.books, to: books)
                // Nothing new: the mirror's fallback repeating its start.
                guard books.count > before else { break }
                showLibrary(Array(books.prefix(cap)), isWhole: false)
            } else {
                books = page.books
            }
            cursor = page.nextCursor
            isWhole = cursor == nil || books.count >= cap
        } while !isWhole && !Task.isCancelled
        guard isWhole, !Task.isCancelled else { return }
        showLibrary(Array(books.prefix(cap)), isWhole: true)
    }

    /// Put this pass's `books` on screen when `CarPlayContent.libraryUpdate` says so.
    private func showLibrary(_ books: [Book], isWhole: Bool) {
        guard let next = CarPlayContent.libraryUpdate(
            shown: libraryBooks, fresh: books, isWhole: isWhole
        ) else { return }
        libraryBooks = next
        renderLibrary()
    }

    private func renderLibrary() {
        // Nothing answered yet: the empty message would claim there are no audiobooks.
        guard let libraryBooks else { return }
        let items = libraryBooks.map {
            row(for: $0, detail: $0.authorDisplay, progress: nil, known: nil)
        }
        apply(CarPlayContent.noAudiobooks, to: libraryList)
        libraryList.updateSections(items.isEmpty ? [] : [CPListSection(items: items)])
        libraryCovers?.cancel()
        libraryCovers = loadCovers(libraryBooks, into: items)
    }

    // MARK: - Rows

    /// One book's row. Greyed out when it can't play here — offline and not
    /// downloaded — by the same rule the phone applies before opening it.
    private func row(
        for book: Book, detail: String?, progress: Double?, known: ProgressRecord?
    ) -> CPListItem {
        let canPlay = DownloadManager.shared.canOpen(book, kind: .audio)
        let item = CPListItem(
            text: book.displayTitle,
            detailText: canPlay ? detail : CarPlayContent.notDownloaded,
            image: covers[book.uuid]
        )
        item.isEnabled = canPlay
        if let progress { item.playbackProgress = CGFloat(progress) }
        item.isPlaying = player.book?.uuid == book.uuid
        item.playingIndicatorLocation = .trailing
        item.handler = { [weak self] _, completion in
            MainActor.assumeIsolated {
                guard let self else { return completion() }
                self.play(book, known: known, then: completion)
            }
        }
        return item
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

    /// Covers for `items`, one at a time off the disk cache, fetched when
    /// missing. CarPlay doesn't load list images lazily, so they arrive after
    /// the rows rather than holding them back.
    private func loadCovers(_ books: [Book], into items: [CPListItem]) -> Task<Void, Never> {
        Task {
            let scale = interface.carTraitCollection.displayScale
            for (book, item) in zip(books, items) where covers[book.uuid] == nil {
                guard !Task.isCancelled else { return }
                let art = book.coverURL == nil ? nil : await Self.art(for: book)
                // Square: the shape of the row's image slot, and of most audiobook art.
                guard !Task.isCancelled,
                      let tile = CoverBitmap.render(
                          CoverIdentity(book), art: art, size: CPListItem.maximumImageSize,
                          cornerRadius: 4, scale: scale
                      )
                else { continue }
                item.setImage(tile)
                // A cover that didn't load shows its plate for now and is tried
                // again on the next render.
                if art != nil || book.coverURL == nil { covers[book.uuid] = tile }
            }
        }
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

    /// Redraw the rows when what they show changes underneath them: a
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
                if self.showsTabs {
                    self.renderContinue()
                    self.renderLibrary()
                }
                self.observeRowState()
            }
        }
    }

    func templateWillAppear(_ aTemplate: CPTemplate, animated: Bool) {
        guard showsTabs else { return }
        // Both re-read: listening elsewhere reorders Continue, and audiobooks
        // the replica didn't hold at connect reach Library once online. A read
        // still running is left to finish — it is already this fresh.
        if aTemplate === continueList, continueRead == nil {
            reloadContinue()
        } else if aTemplate === libraryList, libraryRead == nil {
            reloadLibrary()
        }
    }
}
#endif
