//  BookDetailModel.swift
//  Everything the book page reads and writes. Each section is its own live
//  read, so it paints from the replica at once and updates independently if
//  the server disagrees — a slow endpoint can never hold the page.

import SwiftUI

@Observable
@MainActor
final class BookDetailModel {
    var book: Book?
    /// Yours, everyone else's, and the household summary; `nil` until the
    /// first read answers — unknown, which is not the same as "no review".
    var reviews: BookReviews?
    /// Why the last reviews read settled with nothing to show, if it did —
    /// so the card says so instead of loading on. Cleared when a read starts.
    var reviewsFailure: ReviewsReadFailure?
    var readStatus: ReadStatus = .unread
    /// Whether `readStatus` is an answer rather than the unread it starts on.
    var readStatusKnown = false
    /// When the book became finished. `nil` for a status set before the server
    /// kept the date, which the page says nothing about rather than guessing.
    var finishedAt: Int64?
    var journals: [JournalEntry] = []
    /// Whether `journals` being empty means anything yet.
    var journalsAnswer = ReadAnswer.waiting
    var highlights: [Highlight] = []
    var bookmarks: [Bookmark] = []
    var wishlistEntry: WishlistEntry?
    /// Cross-format sync state for the Files tab; `nil` while unknown
    /// (offline, or the fetch hasn't landed). Network-only read.
    var syncState: CrossFormatResumeState?
    /// Saved positions, one per format. What the progress bar and the primary
    /// action are drawn from.
    var epubProgress: ProgressRecord?
    var audioProgress: ProgressRecord?
    /// Whole-book audio length from the manifest, for turning an audio
    /// position into a fraction. `nil` until fetched, and for HLS manifests.
    var audioDuration: Double?
    /// The audiobook's chapter marks, which divide the bar for a book with no
    /// ebook to take its chapters from.
    var audioChapters: [ChapterInfo] = []
    /// The ebook's chapters, with where each starts in the book — the bar's
    /// divisions, and how a kept line finds its chapter.
    var chapters: [AlignmentEbookChapter] = []
    /// This reader's sittings of this book, newest first.
    var sessions: [SessionLogEntry] = []
    /// Whether `sessions` being empty means anything yet.
    var sessionsAnswer = ReadAnswer.waiting
    /// The rest of the series, in reading order, when the book belongs to one.
    var seriesBooks: [Book] = []
    /// Other books by the same first author.
    var authorBooks: [Book] = []
    /// `nil` until the first read answers, and when it can't be asked at all.
    var suggestions: BookSuggestions?
    /// Other readers who share their stats and have spent time in this book.
    var household: [BookHouseholdReader] = []
    /// Where the reader stands in the rest of the series, read once the book is
    /// finished: what the finish card points at next.
    var seriesStates: [String: SeriesMemberState] = [:]
    /// Whether those reads have all answered, or given up. The card says nothing
    /// until then, rather than point somewhere and move.
    var seriesStatesSettled = false
    /// Bumped when the book becomes finished with the page up, which is what
    /// the burst around the cover goes off for.
    var celebrations = 0
    /// Bumped when the review sheet saves, for the stage's stars to answer.
    var reviewSaves = 0
    var isLoading = true
    var error: String?

    /// Counts review writes, so only the newest one's answer is painted — an
    /// earlier write finishing late would otherwise put back what a later
    /// tap had already replaced.
    private var reviewWrites = 0

    /// Guards the related fetches (series, author, manifest) against running
    /// concurrently; a fetch that came back empty is retried on the next book
    /// emission or refresh rather than skipped forever.
    private var relatedInFlight = false
    /// What the related lists were last fetched for.
    private var relatedSeriesId: Int64?
    private var relatedAuthorId: Int64?
    private var relatedAudioFile: Int64?

    /// Asks again while the server is still fetching suggestions in the
    /// background. Outside `load`, so a pull's spinner never waits on it.
    private var suggestionsRetry: Task<Void, Never>?

    private var seriesStatesInFlight = false

    /// Set once the first read of the status has run its course, cache then
    /// server. Until then a change is the page catching up, not a finish.
    private var readStatusSettled = false

    func load(uuid: String) async {
        isLoading = book == nil

        await withTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in
                do {
                    for try await read in LibraryService.book(uuid: uuid) {
                        self.book = read.value
                        self.error = nil
                        self.isLoading = false
                        self.loadRelated(read.value)
                    }
                } catch {
                    if self.book == nil {
                        self.error = (error as? APIError)?.errorDescription
                            ?? error.localizedDescription
                    }
                }
                self.isLoading = false
            }
            group.addTask { @MainActor in
                self.syncState =
                    (try? await UserDataService.crossFormatResume(uuid: uuid, target: .audio))?
                        .state
            }
            group.addTask { @MainActor in
                for await record in UserDataService.progress(uuid: uuid, format: .epub).values() {
                    self.epubProgress = record
                }
            }
            group.addTask { @MainActor in
                for await record in UserDataService.progress(uuid: uuid, format: .audio).values() {
                    self.audioProgress = record
                    if let book = self.book { self.loadRelated(book) }
                }
            }
            group.addTask { @MainActor in
                await self.loadSessions(uuid: uuid)
            }
            group.addTask { @MainActor in
                await self.loadReviews(uuid: uuid)
            }
            group.addTask { @MainActor in
                for await record in UserDataService.readStatus(uuid: uuid).values() {
                    // Closing the reader on its last page lands here.
                    if FinishCopy.celebrates(
                        settled: self.readStatusSettled, was: self.readStatus, now: record.status
                    ) {
                        self.celebrations += 1
                    }
                    self.readStatus = record.status
                    self.finishedAt = record.finishedAt
                    self.readStatusKnown = true
                    self.loadSeriesStates()
                }
                self.readStatusSettled = true
            }
            group.addTask { @MainActor in
                if self.journalsAnswer == .failed { self.journalsAnswer = .waiting }
                for await entries in UserDataService.journals(uuid: uuid).values() {
                    self.journals = entries
                    self.journalsAnswer = .known
                }
                if self.journalsAnswer != .known, !Task.isCancelled { self.journalsAnswer = .failed }
            }
            group.addTask { @MainActor in
                for await items in UserDataService.highlights(uuid: uuid).values() {
                    // Sorted once at ingestion: the tab redraws with the page,
                    // so a per-render sort is a cost a long list pays constantly.
                    self.highlights = items.sorted { $0.createdAt > $1.createdAt }
                }
            }
            group.addTask { @MainActor in
                for await items in UserDataService.bookmarks(uuid: uuid).values() {
                    self.bookmarks = items
                }
            }
            group.addTask { @MainActor in
                for await entry in UserDataService.wishlistEntry(uuid: uuid).values() {
                    self.wishlistEntry = entry
                }
            }
            group.addTask { @MainActor in
                await self.loadSuggestions(uuid: uuid)
            }
            group.addTask { @MainActor in
                for await readers in LibraryService.household(uuid: uuid).values() {
                    self.household = readers
                }
            }
            group.addTask { @MainActor in
                for await marks in LibraryService.chapters(uuid: uuid).values() {
                    self.chapters = marks
                }
            }
        }
    }

    /// Read the suggestions, and keep asking while the server says it is still
    /// fetching them: the answer is otherwise only seen on the next visit.
    private func loadSuggestions(uuid: String) async {
        suggestionsRetry?.cancel()
        for await answer in LibraryService.suggestions(uuid: uuid).values() {
            suggestions = answer
        }
        guard suggestions == .pending else { return }
        suggestionsRetry = Task { @MainActor in
            for _ in 0..<5 {
                try? await Task.sleep(for: .seconds(4))
                guard !Task.isCancelled else { return }
                for await answer in LibraryService.suggestions(uuid: uuid).values() {
                    suggestions = answer
                }
                guard suggestions == .pending else { return }
            }
            // Still fetching after that long reads the same as a failed
            // lookup: nothing is coming while this page is up.
            suggestions = .unavailable
        }
    }

    /// Read the book's reviews, replica first. A read that ends with nothing
    /// says why — offline or failed — unless it was only cancelled, which says
    /// nothing about the server.
    func loadReviews(uuid: String) async {
        reviewsFailure = nil
        var answered = false
        var failure: Error?
        do {
            for try await read in UserDataService.reviews(uuid: uuid) {
                reviews = read.value
                answered = true
            }
        } catch {
            failure = error
        }
        guard reviews == nil else { return }
        reviewsFailure = ReviewsReadFailure.classify(
            failure, answered: answered, cancelled: Task.isCancelled
        )
    }

    /// Fetches keyed on facts only the book record carries — the series, the
    /// first author, whether there is audio to measure. Each leg runs only
    /// while its answer is still missing, so a transient failure is retried
    /// on the next book emission or pull-to-refresh instead of being skipped
    /// for the life of the model.
    private func loadRelated(_ book: Book) {
        // The editor lives on this page, so any of these can change under it,
        // and a saved position can name a narration other than the first.
        let firstAuthor = book.creators.first?.id
        let audioFile = audioProgress?.bookFileID
        if book.seriesId != relatedSeriesId {
            relatedSeriesId = book.seriesId
            seriesBooks = []
            seriesStates = [:]
            seriesStatesSettled = false
            relatedInFlight = false
        }
        if firstAuthor != relatedAuthorId {
            relatedAuthorId = firstAuthor
            authorBooks = []
            relatedInFlight = false
        }
        if audioFile != relatedAudioFile {
            relatedAudioFile = audioFile
            audioDuration = nil
            audioChapters = []
            relatedInFlight = false
        }
        guard !relatedInFlight else { return }

        let seriesId = seriesBooks.isEmpty ? book.seriesId : nil
        let authorId = authorBooks.isEmpty ? firstAuthor : nil
        let wantsDuration = book.hasAudiobook && audioDuration == nil
        guard seriesId != nil || authorId != nil || wantsDuration else { return }

        relatedInFlight = true
        Task { @MainActor in
            defer { relatedInFlight = false }
            await withTaskGroup(of: Void.self) { group in
                if let seriesId {
                    group.addTask { @MainActor in
                        for await detail in LibraryService.series(id: seriesId).values() {
                            guard self.relatedSeriesId == seriesId else { return }
                            self.seriesBooks = detail.books
                        }
                        self.loadSeriesStates()
                    }
                }
                if let authorId {
                    group.addTask { @MainActor in
                        for await detail in LibraryService.author(id: authorId).values() {
                            guard self.relatedAuthorId == authorId else { return }
                            self.authorBooks = detail.books.filter { $0.id != book.id }
                        }
                    }
                }
                if wantsDuration {
                    group.addTask { @MainActor in
                        let manifest = try? await LibraryService.audiobookManifest(
                            uuid: book.uuid, fileID: audioFile
                        )
                        guard self.relatedAudioFile == audioFile else { return }
                        self.audioDuration = manifest?.totalDuration
                        self.audioChapters = manifest?.chapters ?? []
                    }
                }
            }
        }
    }

    /// Read where the reader stands in the rest of the series. Only for a
    /// finished book, the one case that asks: a read per member, and a series is
    /// a small number of books.
    private func loadSeriesStates() {
        guard readStatus == .finished, let current = book, seriesBooks.count > 1,
              !seriesStatesInFlight
        else { return }
        seriesStatesInFlight = true
        let others = seriesBooks.filter { $0.id != current.id }
        Task { @MainActor in
            // Committed whole: answers landing one at a time would have the card
            // point at a book and then move.
            var answers: [String: SeriesMemberState] = [:]
            await withTaskGroup(of: (String, SeriesMemberState).self) { group in
                for member in others {
                    group.addTask { @MainActor in
                        (member.uuid, await Self.seriesMemberState(member))
                    }
                }
                for await (uuid, state) in group { answers[uuid] = state }
            }
            seriesStatesInFlight = false
            // The series changed under the read, so its answers are for another.
            guard book?.seriesId == current.seriesId else {
                loadSeriesStates()
                return
            }
            seriesStates = answers
            seriesStatesSettled = true
        }
    }

    /// One member's status and place. Both formats are read, since a dual-format
    /// book's place may only exist in the one you listened to.
    private static func seriesMemberState(_ member: Book) async -> SeriesMemberState {
        var state = SeriesMemberState()
        func percent(_ format: ProgressFormat) async -> Int64? {
            var found: Int64?
            for await record in UserDataService.progress(uuid: member.uuid, format: format).values() {
                found = record?.progressPercent ?? record?.resolved?.percentThroughBook
            }
            return found
        }
        let reading = member.hasEbook ? await percent(.epub) : nil
        let listening = member.hasAudiobook ? await percent(.audio) : nil
        state.percent = reading ?? listening
        for await record in UserDataService.readStatus(uuid: member.uuid).values() {
            state.status = record.status
        }
        return state
    }

    /// Read the whole per-book session log, replica first.
    private func loadSessions(uuid: String) async {
        if sessionsAnswer == .failed { sessionsAnswer = .waiting }
        for await entries in UserDataService.bookSessions(uuid: uuid).values() {
            sessions = entries
            sessionsAnswer = .known
        }
        if sessionsAnswer != .known, !Task.isCancelled { sessionsAnswer = .failed }
    }

    /// Patch your review: on screen at once, then whatever the replica holds
    /// once the write is made — the server's rendering when it landed, what it
    /// kept when it refused, the optimistic row while it is queued.
    func patchReview(_ patch: ReviewPatch, uuid: String) async {
        // Against an unknown review a patch would be computed from nothing,
        // and its text would replace whatever the server holds.
        guard !patch.isEmpty, reviews != nil else { return }
        let now = Int64(Date().timeIntervalSince1970)
        reviews = reviews?.applying(patch, uuid: uuid, now: now)
        await settleReviewWrite { await UserDataService.patchReview(uuid: uuid, patch) }
    }

    /// Delete your stars, text and notes, with the same settle as a patch.
    func deleteReview(uuid: String) async {
        guard let known = reviews else { return }
        reviews = known.deletingMine()
        await settleReviewWrite { await UserDataService.deleteReview(uuid: uuid) }
    }

    private func settleReviewWrite(_ write: () async -> BookReviews?) async {
        reviewWrites += 1
        let ticket = reviewWrites
        let settled = await write()
        guard ticket == reviewWrites, let settled else { return }
        reviews = settled
    }

    func setStatus(_ status: ReadStatus, uuid: String) async {
        // The server stamps a book that becomes finished; say the same here
        // until its answer lands, and keep the date of one that already was.
        if status != .finished {
            finishedAt = nil
        } else if readStatus != .finished {
            finishedAt = Int64(Date().timeIntervalSince1970)
            celebrations += 1
        }
        readStatus = status
        readStatusKnown = true
        loadSeriesStates()
        await UserDataService.setReadStatus(uuid: uuid, status: status)
    }

    /// Whether this reader has a saved position in either format.
    var hasPosition: Bool {
        epubProgress != nil || audioProgress != nil
    }

    /// Whether the library holds anything this book can be opened in.
    var hasFile: Bool {
        guard let book else { return false }
        return book.hasEbook || book.hasAudiobook
    }

    /// A wishlisted book the library holds no files for. The bar and the
    /// reading actions drop out; the page offers Find a copy · Check in.
    var isWishlistOnly: Bool {
        book != nil && wishlistEntry != nil && !hasFile
    }

    /// The whole-book fraction the bar draws, when an honest one exists.
    var fraction: Double? {
        DetailRead.fraction(
            epubStarted: epubProgress != nil,
            epubPercent: epubProgress?.progressPercent,
            audioSeconds: audioProgress?.audioPositionSeconds,
            audioDuration: audioProgress?.totalDurationSeconds ?? audioDuration
        )
    }

    /// Whether the bar is reading the listening position rather than a percent.
    var fractionIsAudio: Bool {
        epubProgress?.progressPercent == nil && audioProgress?.audioPositionSeconds != nil
    }

    /// The chapter the reader is in, 1-based, once the server has placed it.
    var currentChapter: Int64? {
        // The same precedence as `fraction`: an EPUB record speaks for the book
        // even with no percent, because that's what the primary action opens.
        (epubProgress ?? audioProgress)?.resolved?.chapterOrdinal
    }
}
