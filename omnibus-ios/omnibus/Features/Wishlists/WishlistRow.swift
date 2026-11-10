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

            Text(WishlistsFlow.meta(item, scope: scope, viewer: viewer))
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
}

/// The Get menu for one book: where to find it, its requests (view the one going,
/// or ask for a kind the library lacks), its page, and on your own list Remove.
struct WishlistGetSheet: View {
    let item: WishlistBook
    let scope: WishlistScope
    let viewer: Int64?
    let requestItems: [WishlistRequestItem]
    var onRequest: (RequestKind) -> Void
    var onView: () -> Void
    var onRemove: () -> Void

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.openDestination) private var openDestination

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Hairline()
            action("Find a copy", detail: "Opens an Amazon search for this book") {
                StoreLink.open(book: item.book, with: openURL)
                dismiss()
            }
            ForEach(requestItems, id: \.kind) { request in
                switch request.action {
                case .view:
                    action(request.title, detail: request.detail) {
                        dismiss()
                        onView()
                    }
                case .request:
                    action(request.title, detail: request.detail, enabled: Connectivity.shared.isOnline) {
                        dismiss()
                        onRequest(request.kind)
                    }
                }
            }
            action("Open book page") {
                dismiss()
                openDestination(.book(uuid: item.id))
            }
            if scope == .you {
                action("Remove from wishlist", enabled: Connectivity.shared.isOnline, destructive: true) {
                    dismiss()
                    onRemove()
                }
            }
            Spacer(minLength: 0)
        }
        .screenPadding()
        .padding(.top, Spacing.lg)
        .background(ScreenBackground())
        .presentationDetents([.medium, .large])
    }

    private var header: some View {
        let meta = WishlistsFlow.meta(item, scope: scope, viewer: viewer)
        return HStack(spacing: Spacing.md) {
            BookCover(identity: CoverIdentity(item.book), size: .sm, cornerRadius: 4)
                .frame(width: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.book.displayTitle)
                    .font(.ui(16, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(2)
                Text("\(item.book.authorDisplay) \u{b7} \(meta.prefix(1).lowercased() + meta.dropFirst())")
                    .font(.ui(12.5))
                    .foregroundStyle(palette.ink2Color)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, Spacing.md)
    }

    private func action(
        _ title: String, detail: String? = nil, enabled: Bool = true, destructive: Bool = false,
        run: @escaping () -> Void
    ) -> some View {
        VStack(spacing: 0) {
            Button(action: run) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.ui(15.5, weight: .medium))
                        .foregroundStyle(destructive ? palette.badColor : palette.ink0Color)
                    if let detail {
                        Text(detail)
                            .font(.ui(12))
                            .foregroundStyle(palette.ink3Color)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!enabled)
            Hairline()
        }
    }
}
