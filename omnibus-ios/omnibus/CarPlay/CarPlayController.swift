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
    private var libraryBooks: [Book] = []
    private var covers: [String: UIImage] = [:]
    private var continueRead: Task<Void, Never>?
    private var libraryRead: Task<Void, Never>?
    private var continueCovers: Task<Void, Never>?
    private var libraryCovers: Task<Void, Never>?
    /// The book a row tap is opening, until it plays.
    private var opening: Task<Void, Never>?
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
                let message = CPListTemplate(title: "Omnibus", sections: [])
                apply(CarPlayContent.signedOut, to: message)
                interface.setRootTemplate(message, animated: false, completion: nil)
                return
            }
            if !showsTabs {
                showsTabs = true
                let tabs = CPTabBarTemplate(templates: [continueList, libraryList])
                interface.setRootTemplate(tabs, animated: false, completion: nil)
            }
            reloadContinue()
            reloadLibrary()
        }
    }

    private func apply(_ message: CarPlayContent.Message, to list: CPListTemplate) {
        list.emptyViewTitleVariants = [message.title]
        list.emptyViewSubtitleVariants = [message.detail]
    }

    // MARK: - Continue

    private func reloadContinue() {
        continueRead?.cancel()
        continueRead = Task {
            for await points in UserDataService.recentAudio().values() {
                guard !Task.isCancelled else { return }
                continuePoints = Array(points.filter(\.isAudio).prefix(UserDataService.recentAudioLimit))
                renderContinue()
            }
        }
    }

    private func renderContinue() {
        let items = continuePoints.map { point in
            row(for: point.book, detail: CarPlayContent.continueDetail(point), progress: point.fraction)
        }
        apply(CarPlayContent.nothingInProgress, to: continueList)
        continueList.updateSections(items.isEmpty ? [] : [CPListSection(items: items)])
        continueCovers?.cancel()
        continueCovers = loadCovers(continuePoints.map(\.book), into: items)
    }

    // MARK: - Library

    /// Every audiobook, newest added first, page by page up to what CarPlay
    /// lets a list hold.
    private func reloadLibrary() {
        libraryRead?.cancel()
        libraryRead = Task {
            let cap = CPListTemplate.maximumItemCount
            var books: [Book] = []
            var cursor: String?
            repeat {
                var page: LibraryPageResult?
                for await answer in LibraryService.page(
                    sort: .newestAdded, direction: .desc,
                    filter: LibraryCategory.audiobooks.filter, cursor: cursor
                ).values() {
                    guard !Task.isCancelled else { return }
                    page = answer
                    // The first page paints from the replica before the server answers.
                    if cursor == nil {
                        libraryBooks = Array(answer.books.prefix(cap))
                        renderLibrary()
                    }
                }
                guard let page else { break }
                if cursor != nil {
                    books += page.books
                    libraryBooks = Array(books.prefix(cap))
                    renderLibrary()
                } else {
                    books = page.books
                }
                cursor = page.nextCursor
            } while cursor != nil && books.count < cap && !Task.isCancelled
        }
    }

    private func renderLibrary() {
        let items = libraryBooks.map { row(for: $0, detail: $0.authorDisplay, progress: nil) }
        apply(CarPlayContent.noAudiobooks, to: libraryList)
        libraryList.updateSections(items.isEmpty ? [] : [CPListSection(items: items)])
        libraryCovers?.cancel()
        libraryCovers = loadCovers(libraryBooks, into: items)
    }

    // MARK: - Rows

    /// One book's row. Greyed out when it can't play here — offline and not
    /// downloaded — by the same rule the phone applies before opening it.
    private func row(for book: Book, detail: String?, progress: Double?) -> CPListItem {
        let canPlay = Presentation.canOpen(book, kind: .audio)
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
                self.play(book, then: completion)
            }
        }
        return item
    }

    /// Start `book`, then show Now Playing. The row spins until the book is
    /// playing, so Now Playing opens on it rather than on the book before.
    private func play(_ book: Book, then done: @escaping () -> Void) {
        // CarPlay keeps a spinning row tappable, and each tap started another load.
        guard opening == nil else { return done() }
        opening = Task {
            // No file named: `load` resumes the file the saved position was
            // taken in, else the book's default.
            await player.load(book: await Self.withFiles(book))
            nowPlaying.show()
            opening = nil
            done()
        }
    }

    /// `book` with its files. A library page lists books without them, and
    /// the player reads them to pick the file to open and to match an offer
    /// from the ebook to it — opened bare, that offer never came.
    private static func withFiles(_ book: Book) async -> Book {
        guard book.bookFiles.isEmpty else { return book }
        for await full in LibraryService.book(uuid: book.uuid).values() { return full }
        return book
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
        // Continue re-reads: listening elsewhere reorders it. Library only
        // re-renders, so a row's greying follows the connection.
        if aTemplate === continueList {
            reloadContinue()
        } else if aTemplate === libraryList {
            renderLibrary()
        }
    }
}
#endif
