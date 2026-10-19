//  DebugScreenLink.swift
//  DEBUG-only `omnibus://debug/screen/…` links that open any tab at any
//  screen, so a scripted screenshot tour reaches a page without tapping its
//  way there. The tab comes first, then the screens to push, in order:
//  `…/screen/you`, `…/screen/library/shelves/shelf/3`, `…/screen/search/author/12`.
//  Consumed in `RootView` before the deep-link router, like `DebugOffline`,
//  and applied by `MainTabView` once it is on screen.

#if DEBUG
import Foundation
import Observation

/// One tab and the stack to push on it.
struct ScreenRoute: Equatable {
    var tab: AppTab
    var path: [Destination]
}

@Observable
@MainActor
final class DebugScreenLink {
    static let shared = DebugScreenLink()

    /// The route waiting for `MainTabView`, which clears it once applied.
    var pending: ScreenRoute?

    static let screenPath = "screen"

    /// Handle `url` if it is a screen link. Answers whether it was consumed;
    /// one that names no route is consumed too, and logged.
    @discardableResult
    static func handle(_ url: URL) -> Bool {
        guard let segments = screenSegments(url) else { return false }
        if let route = route(from: segments) {
            shared.pending = route
        } else {
            print("omnibus.debug.screen: no route for \(url)")
        }
        return true
    }

    /// The path after `screen/`, or nil when `url` is not a screen link.
    nonisolated static func screenSegments(_ url: URL) -> [String]? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == DeepLink.scheme,
              components.host?.lowercased() == DebugOffline.urlHost
        else { return nil }
        // Split the *encoded* path, as `DeepLink` does, so a `%2F` in a tag or
        // query stays inside its segment instead of becoming another word.
        let segments = components.percentEncodedPath.split(separator: "/")
            .map { String($0).removingPercentEncoding ?? String($0) }
        guard segments.first?.lowercased() == screenPath else { return nil }
        return Array(segments.dropFirst())
    }

    /// A tab name, then one destination per word, each with its argument.
    nonisolated static func route(from segments: [String]) -> ScreenRoute? {
        guard let first = segments.first, let tab = tab(named: first) else { return nil }
        var path: [Destination] = []
        var rest = segments.dropFirst()[...]
        while let word = rest.popFirst() {
            guard let destination = destination(word.lowercased(), rest: &rest) else { return nil }
            path.append(destination)
        }
        return ScreenRoute(tab: tab, path: path)
    }

    nonisolated static func tab(named name: String) -> AppTab? {
        AppTab.allCases.first { $0.label.lowercased() == name.lowercased() }
    }

    private nonisolated static func destination(
        _ word: String, rest: inout ArraySlice<String>
    ) -> Destination? {
        switch word {
        case "shelves": return .shelves
        case "authors": return .authorsIndex
        case "tags": return .tags
        case "genres": return .genres
        case "settings": return .settings
        case "goals": return .readingGoals
        case "downloads": return .downloads
        // A bare `series` is the index; `series/<id>` one series.
        case "series":
            guard let id = rest.first.flatMap(Int64.init) else { return .seriesIndex }
            rest.removeFirst()
            return .series(id: id)
        case "book": return rest.popFirst().map { .book(uuid: $0) }
        case "edit": return rest.popFirst().map { .metadataEdit(uuid: $0) }
        case "author": return rest.popFirst().flatMap(Int64.init).map { .author(id: $0) }
        case "shelf": return rest.popFirst().flatMap(Int64.init).map { .shelf(id: $0) }
        case "tag": return rest.popFirst().map { .tag(name: $0) }
        case "genre": return rest.popFirst().map { .genre(name: $0) }
        case "results": return rest.popFirst().map { .searchResults(query: $0) }
        default: return nil
        }
    }
}
#endif
