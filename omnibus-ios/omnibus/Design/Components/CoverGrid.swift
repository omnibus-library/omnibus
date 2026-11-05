//  CoverGrid.swift
//  The grid of covers the browsing screens lay their books and shelves in.
//
//  The library, a shelf, the shelves index, an author and search results all
//  draw this grid. What has to agree across them — the column sizing, the top
//  alignment, how the cells fill in — lives here, so it changes in one place.
//  Each screen still builds its own cell: a link, a press style, a long-press
//  menu. Across a partly folded iPhone Duo the columns split evenly either side
//  of the hinge, so no cover is bent down the middle.

import SwiftUI

/// How large a `CoverGrid`'s covers run.
enum CoverGridDensity: CaseIterable {
    /// The library and shelves.
    case regular
    /// An author's books and search results, which fit a column more.
    case compact

    var minimum: CGFloat {
        switch self {
        case .regular: 112
        case .compact: 104
        }
    }

    var maximum: CGFloat {
        switch self {
        case .regular: 168
        case .compact: 150
        }
    }

    var spacing: CGFloat {
        switch self {
        case .regular: 16
        case .compact: 14
        }
    }

    // `.top` keeps cells aligned by their cover art when captions in the same
    // row wrap to different line counts. The default centring pushes the
    // shorter cells down, which reads as a different-sized cover (#1481).
    var columns: [GridItem] {
        [GridItem(.adaptive(minimum: minimum, maximum: maximum), spacing: spacing, alignment: .top)]
    }

    var rowSpacing: CGFloat {
        switch self {
        case .regular: 26
        case .compact: 20
        }
    }
}

/// Columns that leave a vertical fold in the gutter between the two middle
/// columns: the same count either side, with the grid centred on the hinge.
struct FoldGridLayout: Equatable {
    /// Columns on each side of the fold.
    var perSide: Int
    var leadingInset: CGFloat
    var trailingInset: CGFloat
    var foldGap: CGFloat

    /// Nil when the fold misses the grid or either side can't hold a column.
    static func resolve(width: CGFloat, fold: Fold, density: CoverGridDensity) -> FoldGridLayout? {
        guard let span = FoldSpan.resolve(width: width, fold: fold) else { return nil }
        let side = span.side(of: width)
        let perSide = Int(((side + density.spacing) / (density.minimum + density.spacing)).rounded(.down))
        guard perSide >= 1 else { return nil }
        return FoldGridLayout(
            perSide: perSide,
            leadingInset: span.leading,
            trailingInset: span.trailing,
            foldGap: span.gap
        )
    }

    func columns(_ density: CoverGridDensity) -> [GridItem] {
        (0..<perSide * 2).map { index in
            GridItem(.flexible(), spacing: index == perSide - 1 ? foldGap : density.spacing, alignment: .top)
        }
    }
}

/// A lazy grid of covers whose first fill ripples in and whose later rows arrive whole.
struct CoverGrid<Item: Identifiable, Cell: View>: View {
    let items: [Item]
    let density: CoverGridDensity
    let cell: (Item) -> Cell

    @State private var foldLayout: FoldGridLayout?

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
        LazyVGrid(columns: foldLayout?.columns(density) ?? density.columns, spacing: density.rowSpacing) {
            ForEach(items) { item in
                cell(item).cascadeIn()
            }
        }
        .padding(.leading, foldLayout?.leadingInset ?? 0)
        .padding(.trailing, foldLayout?.trailingInset ?? 0)
        .cascadeFill()
        // Measured outside the insets, so applying them can't move the fold it measured.
        .onGeometryChange(for: FoldGridLayout?.self) { proxy in
            proxy.activeFold.flatMap {
                FoldGridLayout.resolve(width: proxy.size.width, fold: $0, density: density)
            }
        } action: { layout in
            foldLayout = layout
        }
    }
}
