//  DebugLink.swift
//  The path parser every DEBUG-only `omnibus://debug/<word>/…` link shares, so
//  the screen and orientation links read their words the same way.

#if DEBUG
import Foundation

enum DebugLink {
    /// The words after `<word>/`, or nil when `url` is not a `debug/<word>` link.
    nonisolated static func segments(_ url: URL, after word: String) -> [String]? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == DeepLink.scheme,
              components.host?.lowercased() == DebugOffline.urlHost
        else { return nil }
        // Split the *encoded* path, as `DeepLink` does, so a `%2F` in a tag or
        // query stays inside its segment instead of becoming another word.
        let segments = components.percentEncodedPath.split(separator: "/")
            .map { String($0).removingPercentEncoding ?? String($0) }
        guard segments.first?.lowercased() == word.lowercased() else { return nil }
        return Array(segments.dropFirst())
    }
}
#endif
