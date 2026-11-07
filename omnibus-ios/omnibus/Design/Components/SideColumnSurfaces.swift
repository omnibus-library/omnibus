//  SideColumnSurfaces.swift
//  The two shapes that must reach an iPhone Duo's side bar column without a
//  screen asking: a full-bleed slab or wash, and a row that scrolls sideways.
//  Each screen used to opt in by hand, so a new slab written the usual way
//  left the column a black strip and a new rail ran on beneath the bar. Build
//  them from `fullBleed` / `slabBackground` and `SideRail` and both come free.

import SwiftUI

/// Where a full-bleed surface runs past the safe area.
enum Bleed {
    /// The edges for a surface reaching out on `outward`: always both sides as
    /// well, which on the Duo is the side column and elsewhere a sensor inset.
    static func edges(_ outward: Edge.Set) -> Edge.Set {
        outward.union(.horizontal)
    }
}

extension View {
    /// Runs this slab or wash past the safe area on `outward` and on both
    /// sides, under an iPhone Duo's side column too.
    func fullBleed(_ outward: Edge.Set = []) -> some View {
        ignoresSafeArea(edges: Bleed.edges(outward))
    }

    /// Draws `slab` behind this view as a full-bleed band, out to the screen
    /// on `outward` and across both sides.
    func slabBackground<Slab: View>(
        bleeding outward: Edge.Set = [],
        @ViewBuilder _ slab: () -> Slab
    ) -> some View {
        background { slab().fullBleed(outward) }
    }
}

/// A row that scrolls sideways, fading out where an iPhone Duo's side bar
/// column begins rather than running on beneath the bar.
struct SideRail<Content: View>: View {
    /// The sides the rail reaches past its container by `outset`, for a rail
    /// whose parent pads its content in but whose cards should scroll to the edge.
    var outset: CGFloat = 0
    var outsetEdges: Edge.Set = .horizontal
    /// Which part of the row shows first, for one that opens on its newest end.
    var anchor: UnitPoint?
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView(.horizontal) { content }
            .defaultScrollAnchor(anchor)
            .scrollIndicators(.hidden)
            .padding(outsetEdges, -outset)
            .endsAtSideBar()
    }
}
