//  CarPlayContent.swift
//  What the CarPlay screens say and offer, as plain values the templates are built from.
//
//  A CarPlay template can't be inspected from a test, so every decision about
//  what the car shows — a row's text, whether a list redraws, which chapters
//  the list holds, the speed the button steps to, which buttons Now Playing
//  gets, the copy of an offer — lives here as a pure function. The files that import CarPlay only translate
//  these into templates.

import Foundation

enum CarPlayContent {
    /// The speeds the car's speed button steps through. Shorter than the
    /// phone's presets: in a car every tap is a glance away from the road.
    static let rates: [Double] = [1.0, 1.2, 1.5, 1.8, 2.0]

    /// The speed after `rate`: the first step above it, wrapping to the first.
    static func nextRate(after rate: Double) -> Double {
        rates.first { $0 > rate + 0.001 } ?? rates[0]
    }

    /// The chapters the Chapters list holds: the one before `current`, then
    /// through the end, as Audible's does. CarPlay can't open a list scrolled
    /// to a row, so this is what keeps the current chapter on screen.
    static func chapterWindow(count: Int, current: Int?) -> Range<Int> {
        let start = min(max(0, (current ?? 0) - 1), count)
        return start..<count
    }

    /// A Continue row's second line: where you are, and how long is left at
    /// your speed — "Chapter 12 · 3h 20m left".
    static func continueDetail(_ point: ResumePoint) -> String? {
        var parts: [String] = []
        switch point.structuralPosition {
        case let .chapter(ordinal, _): parts.append("Chapter \(ordinal)")
        // The container's marks, not chapters — see `ContinueHero`.
        case let .part(ordinal, _): parts.append("Part \(ordinal)")
        case nil: break
        }
        if let left = WidgetSnapshotWriter.secondsRemaining(for: point, format: .audio) {
            parts.append(Format.humanDuration(Int64(left)) + " left")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The Library list after a later page lands. A page the server fails
    /// falls back to the mirror from its start, so it can repeat books already
    /// listed — and every repeat spends a row of the car's item cap.
    static func appending(_ page: [Book], to books: [Book]) -> [Book] {
        var listed = Set(books.map(\.uuid))
        return books + page.filter { listed.insert($0.uuid).inserted }
    }

    /// Whether a first-page answer goes on screen as it lands. An empty one
    /// from the replica waits for the server: on a fresh sign-in the replica
    /// has nothing yet, and an empty list's message mustn't stand in for a page loading.
    static func showsAtOnce<Row>(_ rows: [Row], isFresh: Bool) -> Bool {
        isFresh || !rows.isEmpty
    }

    /// The Library list while a pass reads: what it has so far, then the rows
    /// it hasn't reached. Without them a re-read would shrink a long list to
    /// one page and grow it back, an update each way, for nothing that changed.
    /// `keepingPlaces` is for an answer the server didn't give: rows on screen
    /// stay where they are, and only what they lack goes on, after them.
    static func libraryRows(read: [Book], shown: [Book]?, keepingPlaces: Bool = false) -> [Book] {
        keepingPlaces ? appending(read, to: shown ?? []) : appending(shown ?? [], to: read)
    }

    /// Where a Library pass goes after a page.
    enum LibraryPassStep: Equatable {
        /// On to the page at this cursor.
        case read(String)
        /// The server answered through to the end: what it didn't name is gone.
        case finished
        /// The server didn't get it there: the rows on screen stay, and the
        /// list reads again the next time it could.
        case cutShort
    }

    /// `allFresh` is whether the server answered every page so far, this one
    /// included; `gained`, whether this page added a book; `isFull`, whether the
    /// list has reached the car's cap. A page with nothing new and a cursor only
    /// repeats itself, while a fresh one with no cursor is how the server ends a
    /// list that shrank. The mirror's pages read on, but can't finish a pass.
    static func libraryPassStep(
        allFresh: Bool, gained: Bool, next: String?, isFull: Bool
    ) -> LibraryPassStep {
        if let next, gained, !isFull { return .read(next) }
        return allFresh && (next == nil || gained) ? .finished : .cutShort
    }

    /// Whether a failed read says so: only with no rows to keep, as an empty
    /// list would claim there is nothing to list.
    static func showsReadFailure<Row>(shown: [Row]?) -> Bool {
        shown?.isEmpty ?? true
    }

    /// Whether a list reads again with nothing new to prompt it, rather than
    /// keeping the rows it holds: only one with nothing on it, or whose last
    /// pass was cut short, and nothing loading.
    static func rereads<Row>(shown: [Row]?, isReading: Bool, cutShort: Bool = false) -> Bool {
        !isReading && (cutShort || showsReadFailure(shown: shown))
    }

    /// Whether a list takes an `updateSections`, which sends it back to its top
    /// and can cost a tapped row its spinner: when which rows it holds, or
    /// their order, changed, or when an empty list has a new message to draw.
    static func updatesSections(shown: [String], next: [String], isNewMessage: Bool) -> Bool {
        shown != next || (next.isEmpty && isNewMessage)
    }

    /// Who the car's lists belong to. Another account, or the same id on
    /// another server, never sees the rows read for this one.
    struct Account: Equatable {
        var server: String
        /// `nil` while no `me` is cached: a token can outlive it.
        var userID: Int64?
        /// `APIClient.sessionGeneration()`: who it is while the id isn't known.
        var session: Int
    }

    /// `held` with what `signedIn` adds to it, or `nil` when `signedIn` is
    /// someone else and the lists have to be forgotten. An id not known yet
    /// isn't a different one within a session: forgetting then would blank the
    /// lists and kill a tapped load, for a session that only just learned who
    /// it is. Across sessions an unknown id says nothing, so the lists go.
    static func sameAccount(held: Account?, signedIn: Account) -> Account? {
        guard let held, held.server == signedIn.server else { return nil }
        if let known = held.userID, let id = signedIn.userID {
            guard known == id else { return nil }
        } else if held.session != signedIn.session {
            return nil
        }
        return Account(
            server: held.server, userID: signedIn.userID ?? held.userID, session: signedIn.session
        )
    }

    /// The second line of a row that can't play — offline, not downloaded.
    static let notDownloaded = "Not downloaded"

    enum NowPlayingButton: Equatable {
        case rate
        case bookmark
        case previousChapter
        case nextChapter
    }

    /// Now Playing's button row, left to right. The chapter buttons are the
    /// car's only one-tap way to change chapter — its hardware buttons seek.
    static func nowPlayingButtons(hasChapters: Bool) -> [NowPlayingButton] {
        hasChapters ? [.rate, .bookmark, .previousChapter, .nextChapter] : [.rate, .bookmark]
    }

    /// A newer position on offer, as the car asks about it.
    struct Offer: Equatable {
        var title: String
        var jump: String
        static let stay = "Keep listening here"
    }

    /// Another device listened further.
    static func syncOffer(at seconds: Double) -> Offer {
        Offer(title: "Listened further elsewhere", jump: "Jump to \(Format.duration(seconds))")
    }

    /// The ebook's position maps somewhere else in the audiobook.
    static func crossFormatOffer(at seconds: Double, ahead: Bool) -> Offer {
        Offer(
            title: ahead ? "Read further in the ebook" : "Re-reading earlier in the ebook",
            jump: "Jump to \(Format.duration(seconds))"
        )
    }

    /// The alert for a book that couldn't be opened, longest wording first:
    /// a CarPlay alert has a title and nothing else, and the car picks the
    /// variant that fits.
    static func loadFailed(_ reason: String) -> [String] {
        ["Couldn't play this book. \(reason)", "Couldn't play this book"]
    }

    static let ok = "OK"

    struct Message: Equatable {
        var title: String
        var detail: String
    }

    static let signedOut = Message(
        title: "Not signed in", detail: "Open Omnibus on your iPhone to sign in."
    )
    static let nothingInProgress = Message(
        title: "Nothing in progress", detail: "Pick a book in Library."
    )
    static let noAudiobooks = Message(
        title: "No audiobooks", detail: "Audiobooks in your library appear here."
    )
    /// A read that failed with no rows to keep. Not an empty list's message:
    /// nothing has said the list is empty.
    static let readFailed = Message(
        title: "Couldn't load your books", detail: "They'll be here once your server can be reached."
    )
}
