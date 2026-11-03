//  WishlistsView.swift
//  The household's wishlists: one reader's list or everyone's, each book with
//  what the library already holds of it. Pushed from You › Library.

import SwiftUI

struct WishlistsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.palette) private var palette
    @State private var model = WishlistsModel()
    @State private var getting: WishlistBook?
    @State private var adding = false

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
        .refreshTask { await model.load() }
        .background(ScreenBackground())
        .navigationTitle(WishlistsFlow.title(model.scope, readers: model.readers))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { readerPicker }
            ToolbarItem(placement: .topBarTrailing) {
                Button { adding = true } label: { Image(systemName: "plus") }
                    .disabled(!Connectivity.shared.isOnline)
                    .accessibilityLabel("Add to your wishlist")
            }
        }
        .overlay(alignment: .bottom) { toastLayer }
        .animation(Motion.settle, value: model.toast?.id)
        .sheet(isPresented: $adding) { AddToWishlistSheet(model: model) }
        .sheet(item: $getting) { item in
            WishlistGetSheet(item: item, scope: model.scope, viewer: app.user?.id) {
                Task { await model.remove(item) }
            }
        }
        .task { await model.load() }
    }

    @ViewBuilder
    private var toastLayer: some View {
        if let toast = model.toast {
            StageToast(
                text: toast.text,
                actionLabel: toast.undo == nil ? nil : "Undo",
                action: { Task { await model.undo(toast) } },
                onDismiss: { model.toast = nil }
            )
            .padding(.horizontal, 16)
            .padding(.bottom, Spacing.md)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .task(id: toast.id) {
                try? await Task.sleep(for: .seconds(4))
                guard !Task.isCancelled else { return }
                model.toast = nil
            }
        }
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
                    WishlistRow(item: item, scope: model.scope, viewer: app.user?.id) { getting = item }
                    Hairline()
                }
            }
            .screenPadding()
            .padding(.vertical, Spacing.md)
        }
        .scrollIndicators(.hidden)
    }

    private var empty: some View {
        let copy = WishlistsFlow.emptyCopy(model.scope, readers: model.readers)
        // A scroll view, so pull-to-refresh works on an empty list too.
        return ScrollView {
            EmptyStateView(
                icon: "heart", title: copy.title, message: copy.message, fanned: true,
                actionTitle: copy.offersAdd ? "Add to your wishlist" : nil,
                action: { adding = true }
            )
            .containerRelativeFrame(.vertical)
        }
        .scrollIndicators(.hidden)
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
