//  ShelvesRail.swift
//  Shelves on the landing screen.
//
//  Behind a browse pill, shelves were effectively invisible — you had to know
//  they existed to find them. As a rail under Continue they read as a real part
//  of the library, and the mosaics make each one recognisable at a glance.

import SwiftUI

struct ShelvesRail: View {
    let previews: [ShelfPreview]
    /// Who is looking, so a shelf someone else shared can say so. `nil` while
    /// the identity is still confirming, which withholds attribution rather
    /// than guessing it.
    var viewerId: Int64?
    /// Runs after a card's long-press menu edits or deletes a shelf, or a new
    /// one is made, so the rail redraws without the whole landing screen reloading.
    var onChanged: () -> Void = {}
    var onSeeAll: () -> Void

    @Environment(\.palette) private var palette
    @State private var showCreate = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .firstTextBaseline) {
                Text("Shelves")
                    .font(.display(27))
                    .foregroundStyle(palette.ink0Color)

                Spacer(minLength: 0)

                headingLink { showCreate = true } label: {
                    Image(systemName: "plus").font(.system(size: 10, weight: .semibold)).accessibilityHidden(true)
                    Text("New shelf")
                }
                headingLink(action: onSeeAll) {
                    Text("All")
                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).accessibilityHidden(true)
                }
            }
            .screenPadding()

            if !previews.isEmpty {
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: 14) {
                        ForEach(previews) { preview in
                            NavigationLink(value: Destination.shelf(id: preview.shelf.id)) {
                                ShelfCard(preview: preview, viewerId: viewerId, width: 108)
                            }
                            .buttonStyle(BookPressStyle())
                            .cascadeIn()
                            .shelfContextMenu(preview.shelf, onChanged: onChanged)
                            // Cards ease off as they leave, so the rail reads as a
                            // shelf continuing past the edge rather than a list
                            // that stops being drawn.
                            .scrollTransition(axis: .horizontal) { view, phase in
                                view
                                    .opacity(phase.isIdentity ? 1 : 0.55)
                                    .scaleEffect(phase.isIdentity ? 1 : 0.94)
                            }
                        }
                    }
                    .screenPadding()
                    .scrollTargetLayout()
                    .cascadeFill()
                }
                .scrollIndicators(.hidden)
                .scrollTargetBehavior(.viewAligned)
            }
        }
        .sheet(isPresented: $showCreate) {
            CreateShelfSheet(onCreated: onChanged)
        }
    }

    private func headingLink<Content: View>(
        action: @escaping () -> Void, @ViewBuilder label: () -> Content
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 3, content: label)
                .font(.ui(13, weight: .medium))
                .foregroundStyle(palette.accentColor)
                // Text alone gives a ~30pt target; pad out to the 44pt
                // minimum without moving the label.
                .padding(.vertical, 10)
                .padding(.leading, 16)
                .contentShape(Rectangle())
        }
    }
}
