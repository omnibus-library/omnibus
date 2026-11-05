//  DebugOrientation.swift
//  DEBUG-only `omnibus://debug/orientation/<portrait|landscape>` links that ask
//  every window scene to rotate its interface, so a screenshot tour can shoot
//  landscape on a simulator whose rotation XCUITest can't drive (iPhone Duo).
//  Consumed in `RootView` beside the other debug links.

#if DEBUG
import UIKit

enum DebugOrientation {
    static let orientationPath = "orientation"

    /// Handle `url` if it is an orientation link. Answers whether it was consumed.
    @MainActor
    @discardableResult
    static func handle(_ url: URL) -> Bool {
        guard let word = orientation(url) else { return false }
        guard let mask = mask(named: word) else {
            print("omnibus.debug.orientation: no orientation named \(word)")
            return true
        }
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { error in
                print("omnibus.debug.orientation: \(error.localizedDescription)")
            }
        }
        return true
    }

    /// The word after `orientation/`, or nil when `url` is not an orientation link.
    nonisolated static func orientation(_ url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == DeepLink.scheme,
              components.host?.lowercased() == DebugOffline.urlHost
        else { return nil }
        let segments = components.path.split(separator: "/").map { $0.lowercased() }
        guard segments.count == 2, segments[0] == orientationPath else { return nil }
        return segments[1]
    }

    nonisolated static func mask(named word: String) -> UIInterfaceOrientationMask? {
        switch word {
        case "portrait": .portrait
        case "landscape", "landscapeleft": .landscapeLeft
        case "landscaperight": .landscapeRight
        default: nil
        }
    }
}
#endif
