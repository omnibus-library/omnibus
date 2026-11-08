//  ReadingIntents.swift
//  Siri actions over reading state: what's in progress, how far along, open a
//  book, and your review as text.
//
//  Reading activity is personal, so each needs the iPhone unlocked; only
//  audiobook playback (`ListeningIntents.swift`) runs locked.

import AppIntents
import Foundation

struct CurrentlyReadingIntent: AppIntent {
    static let title: LocalizedStringResource = "What Am I Reading"
    static let description = IntentDescription("Lists the books you have in progress in Omnibus.")
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
    static let supportedModes: IntentModes = .background

    func perform() async throws -> some IntentResult & ReturnsValue<[BookEntity]> & ProvidesDialog {
        try await SiriLibrary.requireReady()
        guard let points = await SiriLibrary.currentlyReading() else { throw SiriError.unavailable }
        return .result(
            value: points.map { BookEntity($0.book) },
            dialog: IntentDialog(stringLiteral: SiriAnswers.currentlyReading(points))
        )
    }
}

struct BookProgressIntent: AppIntent {
    static let title: LocalizedStringResource = "Book Progress"
    static let description = IntentDescription("Says how far along you are in a book.")
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
    static let supportedModes: IntentModes = .background

    @Parameter(title: "Book")
    var book: BookEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Get my progress in \(\.$book)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        try await SiriLibrary.requireReady()
        guard let found = await SiriLibrary.book(uuid: book.id) else { throw SiriError.bookNotFound }
        let (point, finished) = await SiriLibrary.progress(in: found)
        let answer = SiriAnswers.progress(title: found.displayTitle, point: point, finished: finished)
        return .result(value: answer, dialog: IntentDialog(stringLiteral: answer))
    }
}

struct OpenBookIntent: OpenIntent {
    static let title: LocalizedStringResource = "Open Book"
    static let description = IntentDescription("Opens a book in the reader, or an audiobook in the player.")

    @Parameter(title: "Book")
    var target: BookEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        try await SiriLibrary.requireReady()
        // The router holds the link until the app is ready, as for a widget tap.
        if let url = DeepLink.book(uuid: target.id, format: nil, fileID: nil).url {
            DeepLinkRouter.shared.receive(url)
        }
        return .result()
    }
}

struct LatestReviewIntent: AppIntent {
    static let title: LocalizedStringResource = "Get My Review"
    static let description = IntentDescription(
        "Gets your review of a book as text, or the one you wrote most recently. Private notes aren't included."
    )
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
    static let supportedModes: IntentModes = .background

    @Parameter(title: "Book", description: "Leave empty for the review you wrote most recently.")
    var book: BookEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Get my review of \(\.$book)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        try await SiriLibrary.requireReady()
        let lookup = if let book {
            await SiriLibrary.review(of: book.id)
        } else {
            await SiriLibrary.latestReview()
        }
        switch lookup {
        case .unknown:
            throw SiriError.unavailable
        case .none:
            throw SiriError.noReview(title: book?.title)
        case let .found(review):
            let reviewed = await SiriLibrary.book(uuid: review.bookUUID)
            let text = SiriAnswers.reviewText(review, book: reviewed)
            return .result(value: text, dialog: IntentDialog(stringLiteral: text))
        }
    }
}
