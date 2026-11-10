//  RequestsFlow.swift
//  The Requests list's pure decisions, ported from the web's `requestGroups.ts`:
//  which group a book files under, what each row says, and the counts line.

import Foundation

/// What the signed-in reader may do with requests.
struct RequestViewer: Equatable, Sendable {
    var id: Int64
    var canStart: Bool
    var canChoose: Bool
}

extension RequestViewer {
    init(_ user: UserSummary) {
        self.init(id: user.id, canStart: user.canStartRequests, canChoose: user.canChooseRequestVersions)
    }
}

/// Where a book stands on the list, most urgent first.
enum RequestGroupKey: String, CaseIterable, Sendable {
    case needsYou = "needs_you"
    case onItsWay = "on_its_way"
    case looking, stuck, ready, cancelled

    var label: String {
        switch self {
        case .needsYou: "Needs you"
        case .onItsWay: "On its way"
        case .looking: "Looking"
        case .stuck: "Stuck"
        case .ready: "Ready"
        case .cancelled: "Cancelled"
        }
    }

    /// The colour of a row's status dot.
    var tone: RequestTone {
        switch self {
        case .needsYou: .accent
        case .stuck: .bad
        case .ready: .ok
        case .cancelled: .ink3
        case .onItsWay, .looking: .ink1
        }
    }
}

/// A palette colour, named so the decision stays testable.
enum RequestTone: Equatable, Sendable {
    case accent, bad, ok, ink1, ink3
}

/// One group of the list: its books, each by the request it is filed under.
struct RequestGroup: Equatable {
    var key: RequestGroupKey
    var items: [RequestListing]
}

enum RequestsFlow {
    /// How often the list is read again while anything is moving.
    static let pollInterval = Duration.seconds(10)

    /// Only Cancelled starts folded.
    static let defaultFolds: [RequestGroupKey: Bool] = [.cancelled: true]

    static func groupKey(of request: BookRequest, viewer: RequestViewer) -> RequestGroupKey {
        switch request.state {
        case .choose: viewer.canChoose ? .needsYou : .looking
        case .looking: .looking
        case .chosen, .onItsWay: .onItsWay
        case .stuck: .stuck
        case .ready: .ready
        case .cancelled: .cancelled
        }
    }

    /// One item per book, filed under its most urgent request (the newest of equals; the last
    /// cancelled among cancelled ones), in group order with empty groups left out. A book keeps the
    /// slot where its newest request appeared.
    static func groups(_ listings: [RequestListing], viewer: RequestViewer) -> [RequestGroup] {
        var filed: [String: (rank: Int, key: RequestGroupKey, listing: RequestListing, slot: Int)] = [:]
        for (index, listing) in listings.enumerated() {
            let key = groupKey(of: listing.request, viewer: viewer)
            let rank = RequestGroupKey.allCases.firstIndex(of: key) ?? 0
            let held = filed[listing.book.uuid]
            if let held {
                let lastCancelled = key == .cancelled && rank == held.rank
                    && listing.request.updatedAt > held.listing.request.updatedAt
                guard rank < held.rank || lastCancelled else { continue }
            }
            filed[listing.book.uuid] = (rank, key, listing, held?.slot ?? index)
        }
        return RequestGroupKey.allCases.compactMap { key in
            let items = filed.values.filter { $0.key == key }.sorted { $0.slot < $1.slot }.map(\.listing)
            return items.isEmpty ? nil : RequestGroup(key: key, items: items)
        }
    }

    /// A row's second line: its format, then where it stands ("Ebook · 62%").
    static func itemLine(_ listing: RequestListing, group: RequestGroupKey) -> String {
        "\(BookRequestFlow.kindLabel(listing.request.kind)) \u{b7} \(whereItStands(listing.request, group: group))"
    }

    private static func whereItStands(_ request: BookRequest, group: RequestGroupKey) -> String {
        switch request.state {
        case .choose: group == .needsYou ? "choose a version" : "choosing a version"
        case .looking: "looking for a version"
        case .chosen: "on its way"
        case .onItsWay: BookRequestFlow.downloadPercent(request).map { "\($0)%" } ?? "on its way"
        case .stuck:
            BookRequestFlow.stateView(.stuck, stuckReason: request.stuckReason).heading.lowercased()
        case .ready: request.kind == .audiobook ? "ready to listen" : "ready to read"
        case .cancelled: "cancelled"
        }
    }

    /// "7 books · 1 needs you", the second half only when one does; cancelled books aren't counted.
    static func countsLine(_ groups: [RequestGroup]) -> String {
        let books = groups.filter { $0.key != .cancelled }.reduce(0) { $0 + $1.items.count }
        let needs = groups.first { $0.key == .needsYou }?.items.count ?? 0
        let waiting = needs == 0 ? "" : " \u{b7} \(needs) \(needs == 1 ? "needs" : "need") you"
        return "\(StatsFormat.counted(Int64(books), "book"))\(waiting)"
    }

    /// How many books wait on the viewer to pick a version.
    static func needsYouCount(_ listings: [RequestListing], viewer: RequestViewer) -> Int {
        groups(listings, viewer: viewer).first { $0.key == .needsYou }?.items.count ?? 0
    }

    /// The You tab's pill: nil when nothing needs the viewer.
    static func needsYouPill(_ count: Int) -> String? {
        count == 0 ? nil : "\(count) \(count == 1 ? "needs" : "need") you"
    }

    /// How long until the list is read again; nil when nothing is moving.
    static func listPollInterval(_ listings: [RequestListing]?) -> Duration? {
        listings?.contains { BookRequestFlow.isMoving($0.request.state) } == true ? pollInterval : nil
    }

    // MARK: - The Request a book sheet

    /// What a library book calls for on the Add sheet.
    enum AddAction: Equatable {
        /// Its request is going: open it.
        case open
        /// The library already has an ebook: nothing to request.
        case held
        case start
    }

    /// Each book with an ebook request still going (finished and cancelled ones don't count), by uuid.
    static func requestedBooks(_ listings: [RequestListing]) -> Set<String> {
        Set(
            listings.filter {
                let request = $0.request
                return request.kind == .ebook && request.state != .ready && request.state != .cancelled
            }.map(\.book.uuid))
    }

    /// Open its request, say its ebook is here, or start one. A lookup by ISBN sends no `formats`, so any file counts as an ebook.
    static func addAction(uuid: String, formats: [String]?, hasFiles: Bool, requested: Set<String>) -> AddAction {
        if requested.contains(uuid) { return .open }
        let holdsEbook = formats.map { BookRequestFlow.holds(kind: .ebook, formats: $0) } ?? hasFiles
        return holdsEbook ? .held : .start
    }
}
