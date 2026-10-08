//  SpreadFit.swift
//  Where the reader's Two Pages choice can lay out two columns, from the
//  window the reader is on. `ReaderSettingsSheet` offers the choice from it.

import UIKit

/// The window the reader is on, from which the glue's `#stage` is cut.
struct ReaderScreen: Equatable {
    /// Window bounds, safe areas included.
    var size: CGSize
    /// The window's safe-area insets.
    var insets: UIEdgeInsets
}

extension ReaderScreen {
    /// `#stage`'s inset from the safe area on each side, as `reader.html` sets it.
    static let stageGutter: CGFloat = 10

    /// The width epub.js lays columns across right now.
    var stageWidth: CGFloat {
        size.width - insets.left - insets.right - 2 * Self.stageGutter
    }

    /// The width once the phone is on its side, whichever way it is held now.
    ///
    /// The sensor's inset is `top` upright and lands on both `left` and `right`
    /// sideways, so the widest of the three is what is lost at each end.
    var landscapeStageWidth: CGFloat {
        let sensor = max(insets.top, insets.left, insets.right)
        return max(size.width, size.height) - 2 * sensor - 2 * Self.stageGutter
    }
}

/// Where Two Pages can lay out two columns on the screen in use.
enum SpreadFit: Equatable {
    case never, inLandscape, now

    init(screen: ReaderScreen) {
        let needed = ReaderSpread.minSpreadWidth
        if screen.stageWidth >= needed {
            self = .now
        } else if screen.landscapeStageWidth >= needed {
            self = .inLandscape
        } else {
            self = .never
        }
    }

    /// What the settings sheet says under the choice, when there is something to say.
    var note: String? {
        switch self {
        case .inLandscape: "Two pages appear in landscape."
        case .never, .now: nil
        }
    }
}
