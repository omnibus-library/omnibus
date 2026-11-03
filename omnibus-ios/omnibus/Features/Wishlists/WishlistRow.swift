//  WishlistRow.swift
//  One wishlisted book: its cover and title, what the library holds of it,
//  and who wants it or when it was added.

import SwiftUI

struct WishlistRow: View {
    let item: WishlistBook
    let scope: WishlistScope
    let viewer: Int64?
    var onGet: () -> Void = {}

    @Environment(\.palette) private var palette

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            // The link and Get are siblings: a button nested in a link loses its taps.
            NavigationLink(value: Destination.book(uuid: item.id)) {
                HStack(alignment: .top, spacing: Spacing.md) {
                    BookCover(identity: CoverIdentity(item.book), size: .sm, cornerRadius: 4)
                        .frame(width: 52)
                    details
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button("Get", action: onGet)
                .buttonStyle(EmptyStateActionStyle())
        }
        .padding(.vertical, Spacing.sm)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(item.book.displayTitle)
                .font(.ui(15, weight: .medium))
                .foregroundStyle(palette.ink0Color)
                .lineLimit(2)
                .multilineTextAlignment(.leading)

            let byline = WishlistsFlow.byline(item.book)
            if !byline.isEmpty {
                Text(byline)
                    .font(.ui(12.5))
                    .foregroundStyle(palette.ink2Color)
                    .lineLimit(1)
            }

            holdings

            Text(meta)
                .font(.ui(11.5))
                .foregroundStyle(palette.ink3Color)
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private var holdings: some View {
        if item.holdings.isEmpty {
            Text("\u{2014}")
                .font(.ui(12))
                .foregroundStyle(palette.ink3Color)
                .accessibilityLabel("Not in the library")
        } else {
            HStack(spacing: Spacing.sm) {
                ForEach(item.holdings, id: \.format) { holding in
                    HStack(spacing: 3) {
                        Badge(text: holding.format)
                        if holding.count > 1 {
                            Text("\u{d7}\(holding.count)")
                                .font(.monoUI(10))
                                .foregroundStyle(palette.ink3Color)
                        }
                    }
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private var meta: String {
        scope == .everyone
            ? "Wanted by \(WishlistsFlow.wantedBy(item.wantedBy, viewer: viewer))"
            : "Added \(Format.date(unix: item.addedAt))"
    }
}
