//  SeriesStackCells.swift
//  The library grid's Stack series cells: the folded stack tile, the head
//  card an opened stack leaves in its cell, and the band behind its run.
//  A volume itself reuses `BookGridCell` (see its caption/progress params).

import SwiftUI

extension SeriesStack {
    /// `base` accented by the front volume's cover.
    func palette(over base: Palette) -> Palette {
        front.map(base.accented(byCoverOf:)) ?? base
    }
}

/// A series folded into one tile: up to three covers fanned, a count badge, progress segments.
struct SeriesStackCell: View {
    let stack: SeriesStack

    /// Named so `SymbolNameTests` can prove it resolves.
    static let glyph = "square.stack"

    @Environment(\.palette) private var palette

    /// The front volume, then the next two in series order.
    private var leaves: [Book] {
        guard let front = stack.front else { return [] }
        return Array(([front] + stack.members.filter { $0.id != front.id }).prefix(3))
    }

    private var tint: Color { stack.palette(over: palette).accentColor }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            art
            VStack(alignment: .leading, spacing: 5) {
                if let segments = StackPresentation.segments(stack) {
                    segmentBar(segments)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(stack.name)
                        .font(.ui(12.5, weight: .medium))
                        .foregroundStyle(palette.ink0Color)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text("\(stack.members.count) books")
                        .font(.ui(11))
                        .foregroundStyle(palette.ink3Color)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .contentShape(Rectangle())
    }

    private var art: some View {
        Color.clear
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .overlay {
                GeometryReader { geo in
                    let width = geo.size.width * 0.84
                    ZStack(alignment: .bottomLeading) {
                        ForEach(Array(leaves.enumerated()), id: \.element.id) { depth, book in
                            leaf(book, depth: depth, width: width)
                        }
                    }
                    .frame(width: geo.size.width, height: geo.size.height, alignment: .bottomLeading)
                }
            }
            .overlay(alignment: .bottomLeading) { countBadge }
    }

    /// One fanned cover; each step back sits right, up, turned and dimmed.
    private func leaf(_ book: Book, depth: Int, width: CGFloat) -> some View {
        let step = CGFloat(depth)
        return BookCover(identity: CoverIdentity(book))
            .frame(width: width)
            .coverShadow()
            .colorMultiply(Color(white: 1 - 0.16 * step))
            .rotationEffect(.degrees(1.8 * step), anchor: UnitPoint(x: 0.15, y: 1))
            .offset(x: width * 0.075 * step, y: -width * 1.5 * 0.024 * step)
            .zIndex(Double(3 - depth))
    }

    private var countBadge: some View {
        HStack(spacing: 4) {
            Image(systemName: Self.glyph)
                .font(.system(size: 8, weight: .bold))
            Text("\(stack.members.count)")
                .font(.monoUI(9, weight: .semibold))
        }
        .foregroundStyle(.white)
        .padding(.leading, 5)
        .padding(.trailing, 7)
        .frame(height: 18)
        .background(Capsule().fill(.black.opacity(0.55)))
        .background(Capsule().fill(.ultraThinMaterial))
        .padding(5)
    }

    private func segmentBar(_ fractions: [Double]) -> some View {
        GeometryReader { geo in
            HStack(spacing: 2) {
                ForEach(Array(fractions.enumerated()), id: \.offset) { _, fraction in
                    Capsule()
                        .fill(palette.bg3Color)
                        .overlay(alignment: .leading) {
                            Capsule().fill(tint).scaleEffect(x: fraction, y: 1, anchor: .leading)
                        }
                }
            }
            .frame(width: geo.size.width * 0.84, alignment: .leading)
        }
        .frame(height: 2)
    }
}

/// The head card an opened stack leaves in its cell: kicker, name, count, and its two actions.
struct SeriesCapCell: View {
    let stack: SeriesStack
    let onFold: () -> Void

    @Environment(\.palette) private var palette

    private var tint: Palette { stack.palette(over: palette) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Color.clear
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
                .overlay(alignment: .bottomLeading) { card }
            // Hidden caption so the band matches the volumes' row height.
            VStack(alignment: .leading, spacing: 1) {
                Text(" ").font(.ui(12.5, weight: .medium)).lineLimit(1)
                Text(" ").font(.ui(11)).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .hidden()
        }
        .background { SeriesBand(tint: tint.accentColor, leading: true) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("library-series-cap")
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("SERIES")
                .font(.monoUI(9.5, weight: .medium))
                .tracking(1.5)
                .foregroundStyle(tint.accentColor)
            Text(stack.name)
                .font(.display(18, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .lineLimit(3)
                .minimumScaleFactor(0.8)
            // The count we hold, never a guessed series total.
            Text("\(stack.members.count) in your library")
                .font(.monoUI(9.5))
                .foregroundStyle(palette.ink2Color)
            VStack(spacing: 6) {
                if let id = stack.seriesId {
                    NavigationLink(value: Destination.series(id: id)) {
                        Text("Series page")
                            .font(.ui(12, weight: .semibold))
                            .foregroundStyle(tint.accentInkColor)
                            .frame(maxWidth: .infinity, minHeight: 32)
                            .background(Capsule().fill(tint.accentColor))
                    }
                    .buttonStyle(PressableStyle())
                }
                Button(action: onFold) {
                    Text("Fold up")
                        .font(.ui(12))
                        .foregroundStyle(palette.ink1Color)
                        .frame(maxWidth: .infinity, minHeight: 32)
                        .background(Capsule().fill(palette.bg0Color.opacity(0.4)))
                        .overlay(Capsule().strokeBorder(palette.line2Color, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .accessibilityIdentifier("library-series-fold")
            }
            .padding(.top, 4)
        }
    }
}

/// The tinted band behind an open run, rounded only where the run starts and ends.
struct SeriesBand: View {
    let tint: Color
    var leading = false
    var trailing = false

    @Environment(\.palette) private var palette

    var body: some View {
        let shape = UnevenRoundedRectangle(
            cornerRadii: RectangleCornerRadii(
                topLeading: leading ? 10 : 0, bottomLeading: leading ? 10 : 0,
                bottomTrailing: trailing ? 10 : 0, topTrailing: trailing ? 10 : 0
            ),
            style: .continuous
        )
        shape
            .fill(palette.bg1Color)
            .overlay(shape.fill(tint.opacity(0.16)))
            // Half the grid's 16pt column gap, so neighbouring bands meet.
            .padding(.horizontal, -8)
            .padding(.top, -8)
            .padding(.bottom, -10)
    }
}
