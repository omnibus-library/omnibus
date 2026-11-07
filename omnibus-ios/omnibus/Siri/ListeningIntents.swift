//  ListeningIntents.swift
//  Siri actions that start an audiobook: resume the latest, or play one by name.
//
//  `AudioPlaybackIntent` tells the system the action starts audio, so Siri
//  doesn't talk over it and the app may start playing from the background.
//  Both run with the iPhone locked: that's how they're used in the car.

import AppIntents
import Foundation

struct ResumeAudiobookIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Resume Audiobook"
    static let description = IntentDescription(
        "Resumes the audiobook you were listening to most recently, if it can play right now."
    )
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
    static let supportedModes: IntentModes = .background

    @MainActor
    func perform() async throws -> some IntentResult {
        guard await SiriLibrary.readiness() != .signedOut else { throw SiriError.signedOut }
        if await AudioPlayer.shared.resumeLatest() != nil { return .result() }
        // Why nothing started: the latest audiobook can't play here, or there is none.
        let latest = await UserDataService.settledRecentAudio().first(where: \.isAudio)
        throw latest.map { SiriError.notPlayable(title: $0.book.displayTitle) } ?? SiriError.nothingToResume
    }
}

struct PlayAudiobookIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Play Audiobook"
    static let description = IntentDescription("Plays an audiobook from where you left off.")
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
    static let supportedModes: IntentModes = .background

    @Parameter(title: "Audiobook")
    var book: BookEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Play \(\.$book)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        try await SiriLibrary.requireReady()
        guard let found = await SiriLibrary.book(uuid: book.id) else { throw SiriError.bookNotFound }
        guard found.hasAudiobook else { throw SiriError.noAudiobook(title: found.displayTitle) }
        guard DownloadManager.shared.canOpen(found, kind: .audio) else {
            throw SiriError.notPlayable(title: found.displayTitle)
        }
        await AudioPlayer.shared.load(book: found)
        return .result()
    }
}
