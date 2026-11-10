//  BookRequestFlow.swift
//  The request page's pure copy and gating, ported from the web's
//  `requestView.ts` (the phone branches only: iOS always reads as a phone) so
//  both clients word a request the same way.

import Foundation

/// A request state in Omnibus's words rather than the downloader's.
struct RequestStateView: Equatable {
    var heading: String
    /// Nil where the lane's own content says it.
    var note: String?
    /// Whether `note` is the error the server recorded, not a general line.
    var explicit = false
}

enum BookRequestFlow {
    /// A state's heading and the line under it; a stuck one prefers the server's recorded detail.
    static func stateView(
        _ state: RequestState, stuckReason: StuckReason? = nil, kind: RequestKind = .ebook,
        stuckDetail: String? = nil
    ) -> RequestStateView {
        switch state {
        case .looking: RequestStateView(heading: "Looking", note: "Searching for versions of this book.")
        case .choose: RequestStateView(heading: "Choose a version", note: nil)
        case .chosen: RequestStateView(heading: "Version chosen", note: "We\u{2019}ll fetch it next.")
        case .onItsWay:
            RequestStateView(heading: "On its way", note: "Downloading, then adding it to the library.")
        case .ready:
            RequestStateView(
                heading: kind == .audiobook ? "Ready to listen" : "Ready to read", note: "It\u{2019}s in the library.")
        case .stuck: stuckView(stuckReason, stuckDetail)
        case .cancelled: RequestStateView(heading: "Cancelled", note: "This request was cancelled.")
        }
    }

    private static func stuckView(_ reason: StuckReason?, _ detail: String?) -> RequestStateView {
        let recorded = detail.flatMap(\.nilIfBlank).map(capitalised)
        let explicit = recorded != nil
        switch reason {
        case .stoppedMoving:
            return RequestStateView(
                heading: "Stopped moving", note: recorded ?? "The download stopped making progress.", explicit: explicit)
        case .couldntAdd:
            return RequestStateView(
                heading: "Couldn\u{2019}t add it",
                note: recorded ?? "It downloaded but couldn\u{2019}t be added to the library.", explicit: explicit)
        case .notFound, .searchFailed, nil:
            return RequestStateView(
                heading: "Couldn\u{2019}t find it", note: recorded ?? "Nothing worth showing turned up.",
                explicit: explicit)
        }
    }

    /// Text opening a sentence; a lower-case word with a capital after it, like "qBittorrent", is a name and stays.
    private static func capitalised(_ text: String) -> String {
        let letters = Array(text.prefix(2))
        if letters.count == 2, letters[0].isLowercase, letters[0].isASCII, letters[1].isUppercase, letters[1].isASCII {
            return text
        }
        return text.prefix(1).uppercased() + text.dropFirst()
    }

    /// Whether a request is moving without the reader: searching, picked or downloading.
    static func isMoving(_ state: RequestState) -> Bool {
        state == .looking || state == .chosen || state == .onItsWay
    }

    /// Whether a request is still going for its reader.
    static func isLive(_ state: RequestState) -> Bool {
        state == .choose || isMoving(state)
    }

    /// Whether a request's picked version is still downloading.
    static func isDownloading(_ request: BookRequest) -> Bool {
        request.state == .onItsWay && (request.progress ?? 0) < 1
    }

    /// A download's progress as a whole percent, rounded down and held under 100 until done.
    static func progressPercent(_ progress: Double?) -> Int {
        // Rounded to a hundredth of a percent first, so 0.29 * 100 = 28.999… still reads 29.
        let percent = Int(((progress ?? 0) * 1e4).rounded() / 100)
        if let progress, progress < 1 { return min(percent, 99) }
        return percent
    }

    /// The percent a download shows while it runs; nil before the client reports or once it is complete.
    static func downloadPercent(_ request: BookRequest) -> Int? {
        guard isDownloading(request), let progress = request.progress else { return nil }
        return progressPercent(progress)
    }

    /// What a request's format is called.
    static func kindLabel(_ kind: RequestKind) -> String {
        kind == .ebook ? "Ebook" : "Audiobook"
    }

    // MARK: - Stepper and download

    /// One step of a lane's stepper.
    struct Step: Equatable {
        enum Status: Equatable { case done, current, todo }
        var label: String
        var status: Status
        /// The download's percent, on the On its way step while it runs.
        var percent: Int?
    }

    /// The step each state is on; ready has passed them all.
    private static func stepIndex(_ state: RequestState) -> Int {
        switch state {
        case .looking: 0
        case .choose: 1
        case .chosen, .onItsWay: 2
        case .ready, .stuck, .cancelled: 4
        }
    }

    /// Looking, Choose a version, On its way, Ready; nil for a stuck or cancelled request, which says so in words.
    static func steps(_ request: BookRequest) -> [Step]? {
        guard request.state != .stuck, request.state != .cancelled else { return nil }
        let at = stepIndex(request.state)
        func status(_ step: Int) -> Step.Status { step < at ? .done : step == at ? .current : .todo }
        let found = request.versions.count
        return [
            Step(label: at > 0 && found > 0 ? "Looking \u{b7} \(found) found" : "Looking", status: status(0)),
            Step(label: at > 1 ? "Chose a version" : "Choose a version", status: status(1)),
            Step(label: "On its way", status: status(2), percent: downloadPercent(request)),
            Step(label: "Ready", status: status(3)),
        ]
    }

    /// How long a download has left, roughly; nil when the client can't tell, the time has come, or it is complete.
    static func timeLeft(_ request: BookRequest, now: Date) -> String? {
        guard let expected = request.expectedDoneAt, (request.progress ?? 0) < 1 else { return nil }
        let secs = Double(expected) - now.timeIntervalSince1970
        if secs <= 0 { return nil }
        if secs < 60 { return "less than a minute left" }
        let minutes = Int((secs / 60).rounded())
        if minutes < 60 { return "about \(minutes) min left" }
        let hours = Int((secs / 3600).rounded())
        return "about \(hours) hour\(hours == 1 ? "" : "s") left"
    }

    /// How long ago, in the web's words: "just now", "12m ago", "yesterday", "5d ago".
    static func recency(since then: Int64, now: Date) -> String {
        let secs = max(0, Int64(now.timeIntervalSince1970) - then)
        if secs < 90 { return "just now" }
        if secs < 3600 { return "\(secs / 60)m ago" }
        if secs < 86_400 { return "\(secs / 3600)h ago" }
        return secs < 172_800 ? "yesterday" : "\(secs / 86_400)d ago"
    }

    // MARK: - Versions

    /// Joins the parts of a line; non-breaking before the dot, so a line never starts with a separator.
    static let sep = "\u{a0}\u{b7} "

    private static func join(_ parts: [String?]) -> String { parts.compactMap { $0 }.joined(separator: sep) }

    /// A size in decimal units kept on one line; nil when the source did not say.
    static func versionSize(_ bytes: Int64?) -> String? {
        guard let bytes, bytes > 0 else { return nil }
        let size: String
        switch Double(bytes) {
        case 1e9...: size = String(format: "%.1f GB", Double(bytes) / 1e9)
        case 1e6...: size = String(format: "%.1f MB", Double(bytes) / 1e6)
        case 1e3...: size = String(format: "%.1f KB", Double(bytes) / 1e3)
        default: size = "\(bytes) B"
        }
        return size.replacingOccurrences(of: " ", with: "\u{a0}")
    }

    private static func seeds(_ count: Int64) -> String {
        let formatted = count.formatted(.number.locale(Locale(identifier: "en_US")))
        return "\(formatted)\u{a0}seed\(count == 1 ? "" : "s")"
    }

    /// How a version is shared: Usenet, its seeds, or nil for a torrent whose seeds are unknown.
    private static func sharing(_ version: RequestVersion) -> String? {
        if version.protocol == .usenet { return "Usenet" }
        return version.seeders.map(seeds)
    }

    /// "MyAnonamouse · EPUB · 1.8 MB · 142 seeds"; a missing source or seed count drops out.
    static func versionSource(_ version: RequestVersion) -> String {
        join([
            version.indexer, version.format ?? "Format unknown", versionSize(version.sizeBytes) ?? "Size unknown",
            sharing(version),
        ])
    }

    /// Whether adding the version converts it to EPUB first.
    static func convertsToEpub(_ version: RequestVersion) -> Bool {
        version.format == "AZW3" || version.format == "MOBI"
    }

    /// The line under a picked version's name: its size and source, each left out when unknown.
    static func pickedMeta(_ version: RequestVersion) -> String {
        join([versionSize(version.sizeBytes), version.indexer])
    }

    /// The heading a picked version gets: its format and size, each left out when unknown.
    static func pickedHeading(_ version: RequestVersion) -> String {
        join([version.format, versionSize(version.sizeBytes)])
    }

    static func pickedVersion(_ request: BookRequest) -> RequestVersion? {
        request.versions.first { $0.id == request.chosenResultID }
    }

    /// How many choosable versions show before Show more.
    private static let shownAtFirst = 4

    /// The caption over the versions: how many can be chosen, and that the best match leads when one does.
    static func versionsFound(_ versions: [RequestVersion]) -> String {
        let choosable = versions.filter { !$0.rejected }
        let count = "\(choosable.count) version\(choosable.count == 1 ? "" : "s") found"
        return choosable.contains { $0.bestMatch } ? "\(count) \u{b7} Best match first" : count
    }

    /// The first four versions that can be chosen, and every one that was tried.
    static func firstShown(_ versions: [RequestVersion]) -> [RequestVersion] {
        let offerable = Set(versions.filter { !$0.rejected }.prefix(shownAtFirst).map(\.id))
        return versions.filter { $0.rejected || offerable.contains($0.id) }
    }

    /// The cover offer's sizes in pixels, with a non-breaking space either side of each "×".
    static func coverSizesLine(_ offer: CoverOffer) -> String {
        let times = "\u{a0}\u{d7}\u{a0}"
        return "Its cover is \(offer.width)\(times)\(offer.height). "
            + "The existing one is \(offer.currentWidth)\(times)\(offer.currentHeight)."
    }

    // MARK: - Failures

    /// Why starting a request failed, as a sentence for a toast.
    static func startFailure(_ error: Error) -> String {
        guard case let .http(status, _) = error as? APIError else { return "Couldn\u{2019}t start the request." }
        switch status {
        case 429: return "You have a lot of requests going. Try again in a few minutes."
        case 403: return "Your account can\u{2019}t make requests."
        case 404: return "That book is no longer in the library."
        default: return "Couldn\u{2019}t start the request."
        }
    }

    /// The writes a lane makes after it has started.
    enum Action: Equatable {
        case choose, cancel, undo, swap, retry, takeCover, keepCover

        fileprivate var failurePrefix: String {
            switch self {
            case .choose: "Couldn\u{2019}t choose that version"
            case .cancel: "Couldn\u{2019}t cancel"
            case .undo: "Couldn\u{2019}t undo"
            case .swap: "Couldn\u{2019}t choose another"
            case .retry: "Couldn\u{2019}t try again"
            case .takeCover: "Couldn\u{2019}t use that cover"
            case .keepCover: "Couldn\u{2019}t keep this one"
            }
        }
    }

    /// A toast for a failed write: the action, then the server's message.
    static func actionFailure(_ action: Action, error: Error) -> String {
        let message = (error as? APIError)?.errorDescription ?? "Something went wrong."
        return "\(action.failurePrefix): \(message)"
    }

    // MARK: - Gating

    /// How long the Undo toast stays: until a second and a half before the server's `cancel_at`. Nil without one.
    static func undoDelay(cancelAt: Int64?, now: Date) -> Duration? {
        guard let cancelAt else { return nil }
        return .seconds(max(0, Double(cancelAt) - now.timeIntervalSince1970 - 1.5))
    }

    /// Whether Cancel is offered: any request still going, until its download is complete.
    static func isCancellable(_ request: BookRequest) -> Bool {
        request.state == .onItsWay ? isDownloading(request) : isLive(request.state)
    }

    /// Whether the viewer may cancel `request`: anyone who can pick versions, or the reader who made it.
    static func canCancel(viewer: RequestViewer, request: BookRequest) -> Bool {
        viewer.canChoose || viewer.id == request.userID
    }

    /// Whether Request again is offered: a cancelled request whose undo has run out, to a reader who may
    /// request and has no request of that format going for the book already.
    static func offersRequestAgain(
        _ request: BookRequest, viewer: RequestViewer, bookRequests: [BookRequest], now: Date
    ) -> Bool {
        let undoOpen = request.cancelAt.map { now.timeIntervalSince1970 < Double($0) } ?? false
        let alreadyGoing = bookRequests.contains {
            $0.userID == viewer.id && $0.kind == request.kind && isLive($0.state)
        }
        return request.state == .cancelled && viewer.canStart && !undoOpen && !alreadyGoing
    }

    private static let searchSlowAfter = 20.0
    private static let searchStaleAfter = 150.0

    /// Whether a search that began at `updatedAt` has run long enough to say it is still going.
    static func isSearchSlow(updatedAt: Int64, now: Date) -> Bool {
        now.timeIntervalSince1970 - Double(updatedAt) >= searchSlowAfter
    }

    /// Whether a search that began at `updatedAt` has run past its timeout.
    static func isSearchStale(updatedAt: Int64, now: Date) -> Bool {
        now.timeIntervalSince1970 - Double(updatedAt) >= searchStaleAfter
    }

    /// What the Looking card says while a search runs.
    static func lookingLabel(_ request: BookRequest, now: Date) -> String {
        isSearchSlow(updatedAt: request.updatedAt, now: now)
            ? "Still searching for versions\u{2026}" : "Looking for versions\u{2026}"
    }

    /// The note over Try again on a search past its timeout.
    static let stillLooking = "Still looking\u{2026}"

    /// Whether a stale search offers Try again, which only a reader who can pick versions may press.
    static func offersLookingRetry(_ request: BookRequest, viewer: RequestViewer, now: Date) -> Bool {
        viewer.canChoose && isSearchStale(updatedAt: request.updatedAt, now: now)
    }

    private static let audioFormats: Set<String> = ["M4B", "M4A", "MP3"]

    /// Whether `formats` include one of `kind`: print never counts, audio is M4B, M4A or MP3, and any other format is an ebook.
    static func holds(kind: RequestKind, formats: [String]) -> Bool {
        let upper = formats.map { $0.uppercased() }
        switch kind {
        case .ebook: return upper.contains { $0 != "PRINT" && !audioFormats.contains($0) }
        case .audiobook: return upper.contains { audioFormats.contains($0) }
        }
    }

    /// The Request rows on a book's Files tab: each kind the library lacks, when the server has requests on and the reader may start one.
    static func requestSlots(formats: [String], requestsOn: Bool, canStart: Bool) -> [RequestKind] {
        guard requestsOn, canStart else { return [] }
        return RequestKind.allCases.filter { !holds(kind: $0, formats: formats) }
    }

    /// The kinds the viewer may start that the library lacks and no request, in any state, covers.
    static func unrequestedKinds(formats: [String], listings: [RequestListing], viewer: RequestViewer) -> [RequestKind] {
        guard viewer.canStart else { return [] }
        return RequestKind.allCases.filter { kind in
            !holds(kind: kind, formats: formats) && !listings.contains { $0.request.kind == kind }
        }
    }

    /// How often the page reads again: every two seconds while any lane is moving.
    static func detailPollInterval(_ requests: [BookRequest]) -> Duration? {
        requests.contains { isMoving($0.state) } ? .seconds(2) : nil
    }

    // MARK: - A book's requests

    /// The request the list files the book under: the one a lane opens on.
    static func mainRequest(_ listings: [RequestListing], viewer: RequestViewer) -> RequestListing? {
        RequestsFlow.groups(listings, viewer: viewer).first?.items.first
    }

    /// A book's requests besides the one on screen: those going or stuck get a lane; the history keeps the
    /// cancelled ones and any that swapped a version.
    static func splitBookRequests(
        _ listings: [RequestListing], shown: Int64
    ) -> (lanes: [RequestListing], history: [RequestListing]) {
        let others = listings.filter { $0.request.id != shown }
        return (
            others.filter { isLive($0.request.state) || $0.request.state == .stuck },
            others.filter {
                $0.request.state == .cancelled
                    || ($0.request.state != .stuck && $0.request.versions.contains { $0.rejected })
            }
        )
    }

    // MARK: - History

    private static func versionFacts(_ version: RequestVersion) -> [String] {
        [version.format ?? "Unknown"] + (versionSize(version.sizeBytes).map { [$0] } ?? [])
    }

    /// A history row's day, "Oct 12", on `timeZone`'s calendar.
    static func historyDay(_ unixSecs: Int64, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = timeZone
        formatter.dateFormat = "MMM d"
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(unixSecs)))
    }

    /// What happened to a request: "Ebook cancelled by you · Oct 12".
    static func historyLine(_ listing: RequestListing, viewer: Int64, timeZone: TimeZone = .current) -> String {
        let request = listing.request
        var head: String
        if request.state == .cancelled {
            let canceller = request.cancelledBy == viewer ? "you" : listing.cancelledByName
            head = canceller.map { "Cancelled by \($0)" } ?? "Cancelled"
        } else {
            head = stateView(request.state, stuckReason: request.stuckReason, kind: request.kind).heading
        }
        head = head.prefix(1).lowercased() + head.dropFirst()
        return "\(kindLabel(request.kind)) \(head)\(sep)\(historyDay(request.updatedAt, timeZone: timeZone))"
    }

    /// The version and how far it got: "EPUB · 2.4 MB · stopped at 40%"; nil when neither is known.
    static func historyDetails(_ listing: RequestListing) -> String? {
        let request = listing.request
        var details = pickedVersion(request).map(versionFacts) ?? []
        let ended = request.state == .cancelled || request.state == .stuck
        if ended, let progress = request.progress, progress < 1 {
            details.append("stopped at \(progressPercent(progress))%")
        }
        return details.isEmpty ? nil : details.joined(separator: sep)
    }

    struct SwapFact: Equatable {
        var id: Int64
        var text: String
    }

    /// One line per version the request gave up for another.
    static func swapFacts(_ listing: RequestListing) -> [SwapFact] {
        listing.request.versions.filter(\.rejected).map {
            SwapFact(id: $0.id, text: (["Swapped for another version"] + versionFacts($0)).joined(separator: " \u{b7} "))
        }
    }

    // MARK: - Wording

    /// Who wants the book, "On Jordan’s and your wishlists"; nil when nobody does.
    static func wishersLine(_ wanters: [WishlistWanter], viewer: Int64) -> String? {
        var owners = wanters.map { $0.id == viewer ? "your" : "\($0.name)\u{2019}s" }
        guard let last = owners.popLast() else { return nil }
        return owners.isEmpty ? "On \(last) wishlist" : "On \(owners.joined(separator: ", ")) and \(last) wishlists"
    }

    /// The file format a request's chip names.
    static func kindChip(_ kind: RequestKind) -> String {
        kind == .ebook ? "EPUB" : "M4B"
    }

    /// Who made a request and how long ago: "You · just now".
    static func askedBy(_ listing: RequestListing, viewer: Int64, now: Date) -> String {
        let name = listing.request.userID == viewer ? "You" : listing.requesterName
        return "\(name) \u{b7} \(recency(since: listing.request.createdAt, now: now))"
    }
}
