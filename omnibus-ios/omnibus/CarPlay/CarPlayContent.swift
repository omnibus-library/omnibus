//  CarPlayContent.swift
//  What the CarPlay screens say and offer, as plain values the templates are built from.
//
//  A CarPlay template can't be inspected from a test, so every decision about
//  what the car shows — a row's text, which chapters the list holds, the speed
//  the button steps to, which buttons Now Playing gets, the copy of an offer —
//  lives here as a pure function. The files that import CarPlay only translate
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
    /// has nothing yet, and "No audiobooks" mustn't stand in for a page loading.
    static func showsAtOnce(_ books: [Book], isFresh: Bool) -> Bool {
        isFresh || !books.isEmpty
    }

    /// Whether the Library tab re-reads as it appears, rather than repainting
    /// the rows it holds: only a list with nothing on it, and nothing loading.
    static func rereadsLibrary(shown: [Book]?, isReading: Bool) -> Bool {
        !isReading && (shown?.isEmpty ?? true)
    }

    /// Who the car's lists belong to. Another account, or the same id on
    /// another server, never sees the rows read for this one.
    struct Account: Equatable {
        var server: String
        var userID: Int64?
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
}
