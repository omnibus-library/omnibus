//  ResumeRecentTests.swift
//  Which book a play command resumes when nothing is loaded.
//
//  A car sends play on connect, and so does its play button; with nothing
//  loaded that used to do nothing. It now resumes the most recent audiobook —
//  and only that one, so the car never starts a book the listener didn't expect.

import Testing

@testable import omnibus

private func point(_ uuid: String, format: ProgressFormat = .audio) -> ResumePoint {
    ResumePoint(
        record: ProgressRecord(
            bookUUID: uuid, format: format, epubCFI: nil, audioPositionSeconds: 120,
            updatedAt: 1_700_000_000, clientUpdatedAt: 1_700_000_000
        ),
        book: Book(id: 1, filename: "\(uuid).m4b", title: uuid, uniqueIdentifier: uuid, formats: ["m4b"]),
        audioPart: nil, audioPartCount: nil
    )
}

struct ResumeRecentTests {
    @Test func resumesTheMostRecentAudiobook() {
        let candidate = AudioPlayer.resumeCandidate(
            in: [point("newest"), point("older")], canPlay: { _ in true }
        )
        #expect(candidate?.book.uuid == "newest")
    }

    @Test func nothingInProgressResumesNothing() {
        #expect(AudioPlayer.resumeCandidate(in: [], canPlay: { _ in true }) == nil)
    }

    @Test func aMostRecentBookThatCantPlayIsNotSwappedForAnOlderOne() {
        // Offline and not downloaded: silence beats starting a different book.
        let candidate = AudioPlayer.resumeCandidate(
            in: [point("streamed"), point("downloaded")],
            canPlay: { $0.uuid == "downloaded" }
        )
        #expect(candidate == nil)
    }

    @Test func aReadingCardIsNeverResumedAsAudio() {
        let candidate = AudioPlayer.resumeCandidate(
            in: [point("ebook", format: .epub), point("audiobook")], canPlay: { _ in true }
        )
        #expect(candidate?.book.uuid == "audiobook")
    }
}
