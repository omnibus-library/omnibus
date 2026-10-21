//  CoverGrid.swift
//  The grid of covers the browsing screens lay their books and shelves in.
//
//  The library, a shelf, the shelves index, an author and search results all
//  draw this grid. What has to agree across them — the column sizing, the top
//  alignment, how the cells fill in — lives here, so it changes in one place.
//  Each screen still builds its own cell: a link, a press style, a long-press
//  menu.

import SwiftUI

/// How large a `CoverGrid`'s covers run.
enum CoverGridDensity: CaseIterable {
    /// The library and shelves.
    case regular
    /// An author's books and search results, which fit a column more.
    case compact

    // `.top` keeps cells aligned by their cover art when captions in the same
    // row wrap to different line counts. The default centring pushes the
    // shorter cells down, which reads as a different-sized cover (#1481).
    var columns: [GridItem] {
        switch self {
        case .regular: [GridItem(.adaptive(minimum: 112, maximum: 168), spacing: 16, alignment: .top)]
        case .compact: [GridItem(.adaptive(minimum: 104, maximum: 150), spacing: 14, alignment: .top)]
        }
    }

    var rowSpacing: CGFloat {
        switch self {
        case .regular: 26
        case .compact: 20
        }
    }
}

/// A lazy grid of covers whose first fill ripples in and whose later rows arrive whole.
struct CoverGrid<Item: Identifiable, Cell: View>: View {
    let items: [Item]
    let density: CoverGridDensity
    let cell: (Item) -> Cell

    init(
        _ items: [Item],
        density: CoverGridDensity = .regular,
        @ViewBuilder cell: @escaping (Item) -> Cell
    ) {
        self.items = items
        self.density = density
        self.cell = cell
    }

    var body: some View {
        LazyVGrid(columns: density.columns, spacing: density.rowSpacing) {
            ForEach(items) { item in
                cell(item).cascadeIn()
            }
        }
        .cascadeFill()
    }
}
