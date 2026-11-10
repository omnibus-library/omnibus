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
}
