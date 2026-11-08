//  DuoLayout.swift
//  What a foldable iPhone asks of a layout, behind one seam: which side the
//  system runs its bars down, and where a partly open hinge divides a view.
//  Both are iOS 27.1 SDK APIs; built with an older SDK, or run on a phone
//  without a hinge, every answer is "none" and each layout stays as it was.

import SwiftUI
import UIKit

/// A hinge dividing a view, in that view's own coordinates.
struct Fold: Equatable {
    var frame: CGRect

    /// Runs top to bottom, so the halves sit side by side like an open book.
    var isVertical: Bool { frame.height >= frame.width }

    /// Whether the fold falls strictly inside `bounds`, leaving a part on each side.
    func divides(_ bounds: CGRect) -> Bool {
        isVertical
            ? frame.minX > bounds.minX && frame.maxX < bounds.maxX
            : frame.minY > bounds.minY && frame.maxY < bounds.maxY
    }

    /// The parts of `bounds` either side of the fold: leading then trailing, or top then bottom.
    func halves(of bounds: CGRect) -> (CGRect, CGRect) {
        if isVertical {
            let first = CGRect(x: bounds.minX, y: bounds.minY, width: max(0, frame.minX - bounds.minX), height: bounds.height)
            let second = CGRect(x: frame.maxX, y: bounds.minY, width: max(0, bounds.maxX - frame.maxX), height: bounds.height)
            return (first, second)
        }
        let first = CGRect(x: bounds.minX, y: bounds.minY, width: bounds.width, height: max(0, frame.minY - bounds.minY))
        let second = CGRect(x: bounds.minX, y: frame.maxY, width: bounds.width, height: max(0, bounds.maxY - frame.maxY))
        return (first, second)
    }
}

/// A row centred on a vertical fold: the insets that put the fold at its
/// middle, the wider side giving up its excess, and the fold's own width.
struct FoldSpan: Equatable {
    var leading: CGFloat
    var trailing: CGFloat
    var gap: CGFloat

    /// The width either side of the fold, once centred.
    func side(of width: CGFloat) -> CGFloat {
        max(0, (width - leading - trailing - gap) / 2)
    }

    /// Nil unless `fold` runs top to bottom strictly inside a row `width` wide.
    static func resolve(width: CGFloat, fold: Fold) -> FoldSpan? {
        let row = CGRect(x: 0, y: fold.frame.minY, width: width, height: fold.frame.height)
        guard fold.isVertical, fold.divides(row) else { return nil }
        let side = min(fold.frame.minX, width - fold.frame.maxX)
        return FoldSpan(
            leading: fold.frame.minX - side,
            trailing: width - fold.frame.maxX - side,
            gap: fold.frame.width
        )
    }
}

extension View {
    /// Clips to this view's own left and right edges, leaving shadows above and below.
    func clipsSideways() -> some View {
        mask { Rectangle().padding(.vertical, -120) }
    }

    /// Fades a sideways-scrolling row out where the iPhone Duo's bar column
    /// begins; rails get it from `SideRail` rather than calling this. A scroll
    /// view draws into the side safe area, which there is the column, so a rail
    /// ran on beneath the toolbar. Only an edge that meets the column fades;
    /// elsewhere rails run edge to edge.
    func endsAtSideBar() -> some View {
        modifier(SideBarRailEnd())
    }

    /// Reports the `FoldSpan` a vertical fold makes across this view, or nil.
    func onFoldSpanChange(_ action: @escaping (FoldSpan?) -> Void) -> some View {
        onGeometryChange(for: FoldSpan?.self) { proxy in
            proxy.activeFold.flatMap { FoldSpan.resolve(width: proxy.size.width, fold: $0) }
        } action: { action($0) }
    }

    /// Lets a full-screen surface, one the tab bar never shows on, run into the
    /// iPhone Duo's side bar column while `active`; its parts near the status
    /// bar and camera keep clear of them with `clearsOcclusions()`.
    func reclaimsSideColumn(_ active: Bool = true) -> some View {
        modifier(SideColumnReclaim(active: active))
    }

    /// Pads this view in from the side bar's edge by however far the system's
    /// status bar or camera reaches into it; `sensorsOnly` where the status
    /// bar is hidden, leaving just the camera inside its housing to clear.
    func clearsOcclusions(sensorsOnly: Bool = false) -> some View {
        modifier(OcclusionClearance(sensorsOnly: sensorsOnly))
    }
}

private struct SideColumnReclaim: ViewModifier {
    let active: Bool
    @Environment(\.sideBarEdge) private var sideBarEdge

    func body(content: Content) -> some View {
        content.ignoresSafeArea(.container, edges: active ? sideBarEdge.map(\.edges) ?? [] : [])
    }
}

private struct OcclusionClearance: ViewModifier {
    let sensorsOnly: Bool
    @Environment(\.sideBarEdge) private var sideBarEdge
    @State private var clearance: CGFloat = 0

    func body(content: Content) -> some View {
        if let edge = sideBarEdge {
            content
                .padding(edge.edges, clearance)
                // Measured outside the padding, so applying it can't move what it measured.
                .onGeometryChange(for: CGFloat.self) {
                    $0.occludedDepth(from: edge, sensorsOnly: sensorsOnly)
                } action: { clearance = $0 }
        } else {
            content
        }
    }
}

/// The mask behind `endsAtSideBar()`: open on every edge but the bar's, and on
/// that one too unless the row reaches the column.
struct SideBarRailEnd: ViewModifier {
    @Environment(\.sideBarEdge) private var sideBarEdge
    /// Whether the row's bar-side edge meets the column, rather than stopping short of it.
    /// Starts true so a row's first frame fades, not flashes under the bar until measured.
    @State private var meetsColumn = true

    /// Long enough to read as a dissolve rather than a cut, short enough not to dim a resting chip.
    static let fade: CGFloat = 14
    /// How far the mask reaches past the row: room for shadows and the open edge.
    static let overhang: CGFloat = 400

    /// The end of a rail that fades: the bar's, once the rail reaches its column.
    static func fadingEnd(sideBar: HorizontalEdge?, meetsColumn: Bool) -> HorizontalEdge? {
        meetsColumn ? sideBar : nil
    }

    func body(content: Content) -> some View {
        if let edge = sideBarEdge {
            let end = Self.fadingEnd(sideBar: edge, meetsColumn: meetsColumn)
            content
                .mask {
                    HStack(spacing: 0) {
                        if end == .leading { ramp(from: .clear, to: .black) }
                        Rectangle()
                        if end == .trailing { ramp(from: .black, to: .clear) }
                    }
                    .padding(.vertical, -Self.overhang)
                    .padding(edge.opposite.edges, -Self.overhang)
                    .padding(edge.edges, end == nil ? -Self.overhang : 0)
                }
                .background {
                    // Stretches into the column only from an edge that touches
                    // it, as a chip row's after its label or a pane's at the hinge does not.
                    Color.clear
                        .ignoresSafeArea(.container, edges: edge.edges)
                        .onGeometryChange(for: Bool.self) { proxy in
                            edge.inset(of: proxy.safeAreaInsets) > 0
                        } action: { meetsColumn = $0 }
                }
        } else {
            content
        }
    }

    private func ramp(from start: Color, to end: Color) -> some View {
        LinearGradient(colors: [start, end], startPoint: .leading, endPoint: .trailing)
            .frame(width: Self.fade)
    }
}

/// Two panes side by side: either side of a vertical fold, or a share of a
/// view wide enough to hold both.
struct PaneSplit: Equatable {
    var leading: CGFloat
    var gap: CGFloat
    var trailing: CGFloat

    /// Nil when the view is better as one column: tall, narrow, or folded across.
    static func resolve(size: CGSize, fold: Fold?, share: CGFloat, minimumWidth: CGFloat) -> PaneSplit? {
        let bounds = CGRect(origin: .zero, size: size)
        if let fold, fold.isVertical, fold.divides(bounds) {
            let (first, second) = fold.halves(of: bounds)
            return PaneSplit(leading: first.width, gap: fold.frame.width, trailing: second.width)
        }
        guard size.width > size.height, size.width >= minimumWidth else { return nil }
        let leading = (size.width * share).rounded()
        return PaneSplit(leading: leading, gap: 0, trailing: size.width - leading)
    }

    /// Narrowest unfolded screen a page of sections spreads across two pages
    /// on: the iPhone Duo opened flat on its side, or an iPad.
    static let spreadWidth: CGFloat = 800

    /// Two even pages for a long page of sections, or nil while it is better as one column.
    static func spread(size: CGSize, fold: Fold?) -> PaneSplit? {
        resolve(size: size, fold: fold, share: 0.5, minimumWidth: spreadWidth)
    }
}

extension GeometryProxy {
    /// How far in from `edge` the system's active occlusions overlapping this
    /// view reach; with `sensorsOnly`, a region holding another (the status
    /// bar's housing round the camera) gives way to what it holds.
    func occludedDepth(from edge: HorizontalEdge, sensorsOnly: Bool = false) -> CGFloat {
        #if canImport(UIKit, _version: 9127.0.85)
        if #available(iOS 27.1, *) {
            let bounds = CGRect(origin: .zero, size: size)
            let active = reservedRegions(kind: .occlusion).filter(\.isActive).map(\.frame)
            let regions = sensorsOnly ? active.sensorsOnly : active
            let depths = regions
                .filter { $0.intersects(bounds) }
                .map { edge.depth(of: $0, into: bounds) }
            return max(0, depths.max() ?? 0)
        }
        #endif
        return 0
    }

    /// The fold crossing this view while the hinge is partly open; nil when flat, closed or hingeless.
    var activeFold: Fold? {
        #if canImport(UIKit, _version: 9127.0.85)
        if #available(iOS 27.1, *) {
            return reservedRegions(kind: .division)
                .first { $0.isActive && !$0.frame.isEmpty }
                .map { Fold(frame: $0.frame) }
        }
        #endif
        return nil
    }
}

extension Array where Element == CGRect {
    /// The occlusions that are sensors: a region holding another is the status
    /// bar's housing round the camera, and gives way to what it holds.
    var sensorsOnly: [CGRect] {
        filter { outer in !contains { $0 != outer && outer.contains($0) } }
    }
}

extension HorizontalEdge {
    /// This edge as the set padding and safe-area modifiers take.
    var edges: Edge.Set { self == .trailing ? .trailing : .leading }

    /// The edge across from this one.
    var opposite: HorizontalEdge { self == .trailing ? .leading : .trailing }

    /// The inset on this edge.
    func inset(of insets: EdgeInsets) -> CGFloat { self == .trailing ? insets.trailing : insets.leading }

    /// How far in from this edge of `bounds` the region reaches.
    func depth(of region: CGRect, into bounds: CGRect) -> CGFloat {
        self == .trailing ? bounds.maxX - region.minX : region.maxX - bounds.minX
    }

    /// This edge as the screen edge UIKit names it, under `direction`.
    func rectEdge(in direction: LayoutDirection) -> UIRectEdge {
        (self == .trailing) == (direction == .leftToRight) ? .right : .left
    }
}

extension EnvironmentValues {
    /// The edge the system runs its bars down, or nil where they lie across the top and bottom.
    var sideBarEdge: HorizontalEdge? {
        #if canImport(UIKit, _version: 9127.0.85)
        if #available(iOS 27.1, *) {
            return toolbarVerticalEdge
        }
        #endif
        return nil
    }
}
