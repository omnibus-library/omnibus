//  PlayerArrangement.swift
//  Where the player puts its artwork and its controls for the space it has:
//  stacked on a tall screen, side by side on a wide one, and either side of
//  the hinge on a partly folded iPhone Duo. Pure geometry, so the decision is
//  testable without a screen of every shape.

import CoreGraphics

/// The artwork's region and the controls' region within the player's bounds.
struct PlayerArrangement: Equatable {
    enum Kind: Equatable {
        /// Artwork above controls, the portrait-phone player.
        case stacked
        /// Artwork leading, controls trailing.
        case sideBySide
        /// Artwork above the hinge, controls below it.
        case aboveFold
    }

    var kind: Kind
    var artwork: CGRect
    var controls: CGRect

    /// Narrowest a side-by-side controls column can be and still fit the five-slot transport.
    static let minControlsWidth: CGFloat = 300
    /// Share of a wide, unfolded player the artwork side takes.
    static let artworkShare: CGFloat = 0.46

    static func resolve(in bounds: CGRect, fold: Fold?) -> PlayerArrangement {
        if let fold, fold.divides(bounds) {
            let (first, second) = fold.halves(of: bounds)
            if fold.isVertical, second.width >= minControlsWidth {
                return PlayerArrangement(kind: .sideBySide, artwork: first, controls: second)
            }
            if !fold.isVertical {
                return PlayerArrangement(kind: .aboveFold, artwork: first, controls: second)
            }
        }
        let artworkWidth = (bounds.width * artworkShare).rounded()
        if bounds.width > bounds.height, bounds.width - artworkWidth >= minControlsWidth {
            let (artwork, controls) = bounds.divided(atDistance: artworkWidth, from: .minXEdge)
            return PlayerArrangement(kind: .sideBySide, artwork: artwork, controls: controls)
        }
        return PlayerArrangement(kind: .stacked, artwork: bounds, controls: bounds)
    }
}
