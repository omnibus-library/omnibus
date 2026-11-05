//  SpreadFit.swift
//  Where the reader's Two Pages choice can lay out two columns, from the
//  window the reader is on. `ReaderSettingsSheet` offers the choice from it.
//  The same window decides how far `#stage` is inset, which is usually the
//  safe area and on an iPhone Duo can take back the side bar's column.

import UIKit

/// The window the reader is on, from which the glue's `#stage` is cut.
struct ReaderScreen: Equatable {
    /// Window bounds, safe areas included.
    var size: CGSize
    /// The window's safe-area insets.
    var insets: UIEdgeInsets
    /// What `#stage` is cut from where that differs from the safe area: an
    /// iPhone Duo's side column, taken back by `reclaimingSideColumn`.
    var stageInsets: UIEdgeInsets? = nil
}

extension ReaderScreen {
    /// `#stage`'s inset from the safe area on each side, as `reader.html` sets it.
    static let stageGutter: CGFloat = 10

    /// `#stage`'s band above and below the prose, as `reader.html` sets it.
    static let stageBand: CGFloat = 58
    /// Furthest a sensor may dip into the prose's top before the side inset is
    /// kept for it rather than the stage dropping below it.
    static let sensorNudge: CGFloat = 24
    /// Room kept between a sensor and the prose beside or below it.
    static let sensorClearance: CGFloat = 6

    /// How far the stage's centre sits from the safe area's, rightward:
    /// nonzero only once a side column is taken back.
    var stageCentreShift: CGFloat {
        guard let stage = stageInsets else { return 0 }
        return ((insets.right - stage.right) - (insets.left - stage.left)) / 2
    }

    /// The width epub.js lays columns across right now.
    var stageWidth: CGFloat {
        let stage = stageInsets ?? insets
        return size.width - stage.left - stage.right - 2 * Self.stageGutter
    }

    /// The safe area with the side bar's column on `edge` given back, clearing
    /// only the sensors among `occlusions` (window coordinates): below one that
    /// dips into its top, or beside the prose. The reader hides its status bar
    /// while it takes the column, but a sheet over it may show the bar; the
    /// reclaim holds then too, so the page keeps its width behind the sheet.
    static func reclaimingSideColumn(
        _ edge: UIRectEdge, safe: UIEdgeInsets, size: CGSize, occlusions: [CGRect]
    ) -> UIEdgeInsets {
        let sensors = occlusions.sensorsOnly
        var insets = safe
        let column: CGRect
        switch edge {
        case .right:
            column = CGRect(x: size.width - safe.right, y: 0, width: safe.right, height: size.height)
            insets.right = 0
        case .left:
            column = CGRect(x: 0, y: 0, width: safe.left, height: size.height)
            insets.left = 0
        default:
            return safe
        }
        guard !column.isEmpty else { return safe }
        for sensor in sensors where sensor.intersects(column) {
            let proseTop = insets.top + stageBand
            let proseBottom = size.height - insets.bottom - stageBand
            guard sensor.maxY > proseTop, sensor.minY < proseBottom else { continue }
            if sensor.maxY - proseTop <= sensorNudge {
                insets.top = sensor.maxY + sensorClearance - stageBand
            } else if edge == .right {
                insets.right = max(insets.right, size.width - sensor.minX + sensorClearance - stageGutter)
            } else {
                insets.left = max(insets.left, sensor.maxX + sensorClearance - stageGutter)
            }
        }
        return insets
    }

    /// The width once the phone is on its side, whichever way it is held now.
    ///
    /// Already sideways, that is the width now. Upright, the sensor's inset is
    /// `top` and lands on both `left` and `right` sideways, so the widest of the
    /// three is lost at each end; with the side column taken back, only the
    /// sensor's clearance is lost, at its one end.
    var landscapeStageWidth: CGFloat {
        if size.width >= size.height { return stageWidth }
        let long = size.height
        if let stage = stageInsets {
            return long - max(stage.top, stage.left, stage.right) - 2 * Self.stageGutter
        }
        let sensor = max(insets.top, insets.left, insets.right)
        return long - 2 * sensor - 2 * Self.stageGutter
    }
}

/// Where Two Pages can lay out two columns on the screen in use.
enum SpreadFit: Equatable {
    case never, inLandscape, whenUnfolded, now

    /// Fits now beats fits sideways, which beats fits once unfolded.
    init(screen: ReaderScreen, folded: Bool = false) {
        let needed = ReaderSpread.minSpreadWidth
        if screen.stageWidth >= needed {
            self = .now
        } else if screen.landscapeStageWidth >= needed {
            self = .inLandscape
        } else if folded {
            self = .whenUnfolded
        } else {
            self = .never
        }
    }

    /// What the settings sheet says under the choice, when there is something to say.
    var note: String? {
        switch self {
        case .inLandscape: "Two pages appear in landscape."
        case .whenUnfolded: "Two pages appear when the phone is unfolded."
        case .never, .now: nil
        }
    }
}
