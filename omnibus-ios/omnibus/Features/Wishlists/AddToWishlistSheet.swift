//  AddToWishlistSheet.swift
//  Search the library and the online providers by title, author or ISBN (typed
//  or scanned) and put a result on your wishlist.

import SwiftUI

struct AddToWishlistSheet: View {
    let model: WishlistsModel

    @Environment(\.dismiss) private var dismiss

    @State private var addError: String?

    var body: some View {
        BookSearchSheet(title: "Add to your wishlist", isBusy: model.isAdding, error: $addError) { hit, via in
            Button("Add") { Task { await add(WishlistHit(hit), via: via) } }
                .buttonStyle(EmptyStateActionStyle())
                .disabled(model.isAdding || !Connectivity.shared.isOnline)
                .accessibilityLabel("Add \(hit.title)")
        }
    }

    private func add(_ hit: WishlistHit, via: FoundVia) async {
        addError = nil
        addError = await model.add(hit, via: via)
        if addError == nil { dismiss() }
    }
}
