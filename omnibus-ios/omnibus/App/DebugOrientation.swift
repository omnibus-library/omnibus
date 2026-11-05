//  DebugOrientation.swift
//  DEBUG-only `omnibus://debug/orientation/<portrait|landscape>` links that ask
//  every window scene to rotate its interface, so a screenshot tour can shoot
//  landscape on a simulator whose rotation XCUITest can't drive (iPhone Duo).
//  Consumed in `RootView` beside the other debug links.

#if DEBUG
import UIKit

enum DebugOrientation {
    static let orientationPath = "orientation"

    /// Handle `url` if it is an orientation link. Answers whether it was consumed;
    /// one that names no orientation is consumed too, and logged.
    @MainActor
    @discardableResult
    static func handle(_ url: URL) -> Bool {
        guard let segments = orientationSegments(url) else { return false }
        guard let mask = mask(from: segments) else {
            print("omnibus.debug.orientation: no orientation for \(url)")
            return true
        }
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { error in
                print("omnibus.debug.orientation: \(error.localizedDescription)")
            }
        }
        return true
    }

    /// The words after `orientation/`, or nil when `url` is not an orientation link.
    nonisolated static func orientationSegments(_ url: URL) -> [String]? {
        DebugLink.segments(url, after: orientationPath)?.map { $0.lowercased() }
    }

    /// The mask a link's words name: exactly one orientation, else nil.
    nonisolated static func mask(from segments: [String]) -> UIInterfaceOrientationMask? {
        guard segments.count == 1 else { return nil }
        return mask(named: segments[0])
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
