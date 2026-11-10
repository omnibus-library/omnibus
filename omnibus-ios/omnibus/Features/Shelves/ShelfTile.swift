//  ShelfTile.swift
//  The shelves index's tile: a shelf's first books standing on a lit ledge.
//
//  The web index draws the same tile (`ShelfTileFace`), so a shelf reads the
//  same on every client: covers upright on a plank washed in the shelf's own
//  accent, the last one leaning, then the name in the display face, what kind
//  of shelf it is and who can see it, and a foot with the count and the owner.
//  The landing rail keeps the compact mosaic `ShelfCard`; this is for a grid
//  with room for a caption.

import SwiftUI

struct ShelfTile: View {
    let preview: ShelfPreview
    /// What the foot calls the owner: "You", or their name.
    let ownerLabel: String

    @Environment(\.palette) private var palette

    private var shelf: ShelfSummary { preview.shelf }

    /// The shelf's own accent, or the app's when it has none.
    private var tint: Color {
        shelf.accent.flatMap { OKLCH.parse(cssValue: $0) }?.color ?? palette.accentColor
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ShelfLedge(preview: preview, tint: tint)

            VStack(alignment: .leading, spacing: 8) {
                Text(shelf.name)
                    .font(.display(19, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .multilineTextAlignment(.leading)
                    // Every tile in a row the same height, whether its name takes one line or two.
                    .lineLimit(2, reservesSpace: true)

                facets
                foot.padding(.top, 2)
            }
            .padding(.horizontal, 12)
            .padding(.top, 11)
            .padding(.bottom, 12)
        }
        .background(palette.bg1Color)
        .clipShape(.rect(cornerRadius: Self.radius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Self.radius, style: .continuous)
                .strokeBorder(palette.line2Color, lineWidth: 1)
        }
        .contentShape(.contextMenuPreview, .rect(cornerRadius: Self.radius, style: .continuous))
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    static let radius: CGFloat = 16

    /// Kind and visibility; on a tile too narrow for both words the visibility
    /// keeps only its glyph.
    private var facets: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                kindFacet
                facet(shelf.visibility.glyph, shelf.visibility.label)
            }
            HStack(spacing: 10) {
                kindFacet
                Image(systemName: shelf.visibility.glyph)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(palette.ink2Color)
                    .accessibilityLabel(shelf.visibility.label)
            }
        }
    }

    private var kindFacet: some View {
        facet(shelf.kind.glyph, shelf.kind.label)
            .foregroundStyle(tint.mix(with: palette.ink1Color, by: 0.22))
    }

    private func facet(_ glyph: String, _ label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: glyph).font(.system(size: 9, weight: .semibold))
            Text(label)
                .font(.monoUI(9.5, weight: .medium))
                .tracking(0.9)
                .textCase(.uppercase)
        }
        .foregroundStyle(palette.ink2Color)
        .lineLimit(1)
        .fixedSize()
    }

    private var foot: some View {
        HStack(spacing: 8) {
            Text(StatsFormat.counted(shelf.bookCount, "book"))
                .font(.ui(12.5))
                .foregroundStyle(palette.ink1Color)
                .lineLimit(1)
                .fixedSize()

            Spacer(minLength: 0)

            HStack(spacing: 6) {
                UserAvatar(
                    id: shelf.ownerUserId,
                    name: shelf.ownerUsername,
                    hasAvatar: shelf.ownerHasAvatar ?? false,
                    size: 18
                )
                .accessibilityHidden(true)
                Text(ownerLabel)
                    .font(.ui(12))
                    .foregroundStyle(palette.ink2Color)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
    }
}

/// The tile's top: up to four covers standing on a plank, lit from below in
/// the shelf's accent. A shelf with nothing on it says so on the ledge itself.
struct ShelfLedge: View {
    let preview: ShelfPreview
    let tint: Color

    @Environment(\.palette) private var palette

    /// How many books stand on the ledge.
    static let capacity = 4

    var body: some View {
        Color.clear
            .aspectRatio(1.6, contentMode: .fit)
            .background { ground }
            .overlay(alignment: .bottom) { plank }
            .overlay { content }
            .overlay(alignment: .bottom) {
                Rectangle().fill(palette.line2Color).frame(height: 1)
            }
            .accessibilityHidden(true)
    }

    private var ground: some View {
        ZStack {
            palette.bg2Color
            EllipticalGradient(
                colors: [tint.opacity(0.30), tint.opacity(0)],
                center: UnitPoint(x: 0.5, y: 1.15),
                startRadiusFraction: 0,
                endRadiusFraction: 0.72
            )
        }
    }

    private var plank: some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(tint.mix(with: palette.bg3Color, by: 0.6))
            .frame(height: 4)
            .shadow(color: .black.opacity(0.38), radius: 5, y: 4)
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
    }

    @ViewBuilder
    private var content: some View {
        let covers = Array(preview.covers.prefix(Self.capacity))
        // Members known but no covers cached yet: blank plates, not an empty shelf.
        let blanks = covers.isEmpty ? min(Int(preview.shelf.bookCount), Self.capacity) : 0

        if covers.isEmpty, blanks == 0 {
            emptyMark
        } else {
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(Array(covers.enumerated()), id: \.element.id) { index, book in
                    standing(leans: index == covers.count - 1 && covers.count > 1) {
                        BookCover(identity: CoverIdentity(book), size: .sm, cornerRadius: 0, keepsAspect: false)
                    }
                }
                ForEach(0..<blanks, id: \.self) { index in
                    standing(leans: index == blanks - 1 && blanks > 1) {
                        LinearGradient(
                            colors: [tint.mix(with: palette.bg3Color, by: 0.82), palette.coverFallbackBg.color],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 16)
            .padding(.bottom, 14)
        }
    }

    /// One book upright on the plank; the last of several leans on the rest.
    private func standing<Face: View>(leans: Bool, @ViewBuilder face: () -> Face) -> some View {
        face()
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .clipShape(UnevenRoundedRectangle(
                topLeadingRadius: 2, bottomLeadingRadius: 2,
                bottomTrailingRadius: 4, topTrailingRadius: 4,
                style: .continuous
            ))
            .overlay {
                UnevenRoundedRectangle(
                    topLeadingRadius: 2, bottomLeadingRadius: 2,
                    bottomTrailingRadius: 4, topTrailingRadius: 4,
                    style: .continuous
                )
                .strokeBorder(.black.opacity(0.18), lineWidth: 0.5)
            }
            .shadow(color: .black.opacity(0.42), radius: 7, y: 6)
            .frame(maxWidth: 58, maxHeight: .infinity, alignment: .bottom)
            .rotationEffect(.degrees(leans ? -6 : 0), anchor: .bottomTrailing)
    }

    private var emptyMark: some View {
        VStack(spacing: 7) {
            Image(systemName: preview.shelf.kind.glyph)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(tint.mix(with: palette.ink2Color, by: 0.3))
            Text(preview.shelf.kind.emptyLedge)
                .font(.monoUI(9.5, weight: .medium))
                .tracking(1.1)
                .textCase(.uppercase)
                .foregroundStyle(palette.ink3Color)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(palette.lineColor, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
        }
        .padding(.bottom, 6)
    }
}

extension ShelfKind {
    /// What a tile calls the kind.
    var label: String {
        switch self {
        case .smart: "Smart"
        case .manual: "Hand-picked"
        case .wishlist: "Wishlist"
        }
    }

    /// What an empty shelf's ledge says.
    var emptyLedge: String {
        switch self {
        case .smart: "No matches yet"
        case .manual: "Empty shelf"
        case .wishlist: "Nothing wished for"
        }
    }
}

extension ShelfVisibility {
    var label: String {
        switch self {
        case .private: "Private"
        case .public: "Public"
        }
    }

    var glyph: String {
        switch self {
        case .private: "lock.fill"
        case .public: "person.2.fill"
        }
    }
}
