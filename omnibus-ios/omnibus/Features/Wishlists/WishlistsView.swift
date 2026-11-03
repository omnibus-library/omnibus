//  WishlistsView.swift
//  The household's wishlists: one reader's list or everyone's, each book with
//  what the library already holds of it. Pushed from You › Library.

import SwiftUI

struct WishlistsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.palette) private var palette
    @State private var model = WishlistsModel()

    var body: some View {
        Group {
            if let books = model.books {
                if books.isEmpty {
                    empty
                } else {
                    list(books)
                }
            } else if let failure = model.failure {
                ErrorStateView(message: failure) { Task { await model.load() } }
            } else {
                LoadingView()
            }
        }
        .background(ScreenBackground())
        .navigationTitle(WishlistsFlow.title(model.scope, readers: model.readers))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { readerPicker }
        }
        .task { await model.load() }
    }

    private func list(_ books: [WishlistBook]) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let subline = WishlistsFlow.subline(model.scope, books: books.count, readers: model.readers) {
                    Text(subline)
                        .font(.ui(13))
                        .foregroundStyle(palette.ink2Color)
                        .padding(.bottom, Spacing.sm)
                }
                ForEach(books) { item in
                    WishlistRow(item: item, scope: model.scope, viewer: app.user?.id)
                    Hairline()
                }
            }
            .screenPadding()
            .padding(.vertical, Spacing.md)
        }
        .scrollIndicators(.hidden)
        .refreshTask { await model.load() }
    }

    private var empty: some View {
        let copy = WishlistsFlow.emptyCopy(model.scope, readers: model.readers)
        return EmptyStateView(icon: "heart", title: copy.title, message: copy.message, fanned: true)
    }

    /// A menu of text rows; its label carries the avatar because a menu can't draw a remote image.
    private var readerPicker: some View {
        Menu {
            Picker("Whose wishlist", selection: scopeBinding) {
                ForEach(WishlistsFlow.pickerOptions(from: model.readers), id: \.self) { option in
                    Text(WishlistsFlow.menuLabel(option, readers: model.readers)).tag(option)
                }
            }
        } label: {
            HStack(spacing: 4) {
                avatar
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
            }
        }
        .accessibilityLabel("Whose wishlist")
        .accessibilityValue(WishlistsFlow.menuLabel(model.scope, readers: model.readers))
    }

    @ViewBuilder
    private var avatar: some View {
        let shown: WishlistReader? = switch model.scope {
        case .everyone: nil
        case .you: model.readers?.readers.first { $0.isYou }
        case .reader: WishlistsFlow.reader(model.scope, in: model.readers)
        }
        if let shown {
            UserAvatar(id: shown.id, name: shown.name, hasAvatar: shown.hasAvatar, size: 28)
        } else {
            Image(systemName: model.scope == .everyone ? "person.2" : "person.crop.circle")
                .font(.system(size: 22))
        }
    }

    private var scopeBinding: Binding<WishlistScope> {
        Binding(get: { model.scope }, set: { scope in Task { await model.select(scope) } })
    }
}
