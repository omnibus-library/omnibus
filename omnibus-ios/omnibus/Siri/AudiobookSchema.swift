//  AudiobookSchema.swift
//  Audiobooks in Apple's audio schema, so AI Siri can play one by name.
//
//  iOS 27 only. The schema's playback group is the entity, an
//  `IntentValueQuery` over `AudioSearch`, and a `playAudio` intent; Apple
//  requires all three before AI Siri will route a request here.

import AppIntents
import Foundation
import MediaIntents

@available(iOS 27.0, *)
@AppEntity(schema: .audio.audiobook)
struct AudiobookEntity {
    static let defaultQuery = AudiobookEntityQuery()

    let id: String

    var title: String?
    var author: String?
    var genre: String?
    var narrator: String?
    var publisher: String?
    var seriesTitle: String?
    var releaseDate: Date?
    var purchaseDate: Date?

    init(_ book: Book) {
        id = book.uuid
        title = book.displayTitle
        author = book.authorDisplay
        genre = book.genres.first
        publisher = book.publisher?.nilIfBlank
        seriesTitle = book.series?.nilIfBlank
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title ?? "Audiobook")", subtitle: "\(author ?? "")")
    }
}

@available(iOS 27.0, *)
struct AudiobookEntityQuery: EntityQuery {
    /// How many audiobooks a spoken request resolves to.
    static let matchLimit = 10

    func entities(for identifiers: [AudiobookEntity.ID]) async throws -> [AudiobookEntity] {
        var found: [AudiobookEntity] = []
        for uuid in identifiers {
            if let book = await SiriLibrary.book(uuid: uuid), book.hasAudiobook {
                found.append(AudiobookEntity(book))
            }
        }
        return found
    }
}

@available(iOS 27.0, *)
extension AudiobookEntityQuery: IntentValueQuery {
    func values(for audioSearch: AudioSearch) async throws -> [AudiobookEntity] {
        guard await SiriLibrary.readiness() == .ready else { return [] }
        switch audioSearch.criteria {
        case let .searchQuery(query):
            return await SiriLibrary.search(spoken: query, limit: Self.matchLimit * 3)
                .filter(\.hasAudiobook)
                .prefix(Self.matchLimit)
                .map(AudiobookEntity.init)
        case .unspecified:
            // "Play an audiobook": the one listened to last.
            return await UserDataService.settledRecentAudio().prefix(1).map { AudiobookEntity($0.book) }
        case .url:
            return []
        @unknown default:
            return []
        }
    }
}

@available(iOS 27.0, *)
@UnionValue
enum OmnibusAudioItem {
    case audiobook(AudiobookEntity)
}

@available(iOS 27.0, *)
@AppIntent(schema: .audio.playAudio)
struct PlayAudioIntent: AudioPlaybackIntent {
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    var audioEntity: OmnibusAudioItem
    var playbackAttributes: Set<PlaybackAttributes>
    var warmupAudioQueueResult: WarmupAudioQueueResult?
    var queueLocation: QueueInsertionLocation?

    @MainActor
    func perform() async throws -> some IntentResult {
        guard case let .audiobook(entity) = audioEntity else { return .result() }
        try await SiriLibrary.requireReady()
        guard let found = await SiriLibrary.book(uuid: entity.id) else { throw SiriError.bookNotFound }
        guard DownloadManager.shared.canOpen(found, kind: .audio) else {
            throw SiriError.notPlayable(title: found.displayTitle)
        }
        await AudioPlayer.shared.load(book: found)
        return .result()
    }
}

// The schema's supporting types. An audiobook has no shuffle, repeat or queue,
// so `perform` ignores them; they exist because the schema requires them.

@available(iOS 27.0, *)
@AppEnum(schema: .audio.playbackAttributes)
enum PlaybackAttributes: String {
    case shuffle
    case `repeat`

    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .shuffle: "Shuffle",
        .repeat: "Repeat",
    ]
}

@available(iOS 27.0, *)
@AppEnum(schema: .audio.queueInsertionLocation)
enum QueueInsertionLocation: String {
    case next
    case tail

    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .next: "Next",
        .tail: "Tail",
    ]
}

@available(iOS 27.0, *)
@AppEntity(schema: .audio.warmupAudioQueueResult)
struct WarmupAudioQueueResult {
    static let defaultQuery = WarmupAudioQueueResultQuery()

    let id: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "Audiobook")
    }

    /// Nothing is ever warmed up ahead of a play, so there is no result to find.
    struct WarmupAudioQueueResultQuery: EntityStringQuery {
        func entities(for identifiers: [WarmupAudioQueueResult.ID]) async throws -> [WarmupAudioQueueResult] {
            []
        }

        func entities(matching string: String) async throws -> [WarmupAudioQueueResult] {
            []
        }
    }
}
