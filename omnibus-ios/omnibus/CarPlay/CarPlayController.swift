//  CarPlayController.swift
//  The car's two tabs — Continue and Library — and the sign-in gate in front of them.
//
//  Reads go through the same local-first services the phone uses, so a car
//  with no signal still lists what this device holds. Lists are rebuilt when a
//  tab appears and when the loaded book changes, never per position tick: the
//  rail is rewritten twice a second while playing, and an updated CarPlay list
//  jumps back to its top. Now Playing and the Chapters list live in
//  `CarPlayNowPlaying`.

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
        observeLoadedBook()
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
            MainActor.assumeIsolated { self?.play(book) }
            completion()
        }
        return item
    }

    private func play(_ book: Book) {
        nowPlaying.show()
        // No file named: `load` resumes the file the saved position was
        // taken in, else the book's default.
        Task { await player.load(book: book) }
    }

    /// Covers for `items`, one at a time off the disk cache, fetched when
    /// missing. CarPlay doesn't load list images lazily, so they arrive after
    /// the rows rather than holding them back.
    private func loadCovers(_ books: [Book], into items: [CPListItem]) -> Task<Void, Never> {
        Task {
            for (book, item) in zip(books, items) where covers[book.uuid] == nil {
                guard !Task.isCancelled else { return }
                guard book.coverURL != nil else { continue }
                let key = "/api/thumbs/\(book.uuid)/\(ThumbSize.sm.rawValue)"
                var image = await ImageCache.shared.image(for: key)
                if image == nil {
                    await ImageCache.shared.prefetch(key)
                    image = await ImageCache.shared.image(for: key)
                }
                guard let image, !Task.isCancelled else { continue }
                let sized = Self.fitted(image, to: CPListItem.maximumImageSize)
                covers[book.uuid] = sized
                item.setImage(sized)
            }
        }
    }

    private static func fitted(_ image: UIImage, to bounds: CGSize) -> UIImage {
        let scale = min(bounds.width / image.size.width, bounds.height / image.size.height, 1)
        guard scale < 1 else { return image }
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return UIGraphicsImageRenderer(size: size).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    // MARK: - Updates

    /// Re-mark the playing row whenever a different book loads — from the car,
    /// the phone, or a play command.
    private func observeLoadedBook() {
        withObservationTracking {
            _ = player.book?.uuid
        } onChange: { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                guard !self.isStopped else { return }
                if self.showsTabs {
                    self.renderContinue()
                    self.renderLibrary()
                }
                self.observeLoadedBook()
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
