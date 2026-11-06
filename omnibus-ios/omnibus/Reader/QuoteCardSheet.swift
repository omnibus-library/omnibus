//  QuoteCardSheet.swift
//  Picking how a passage should look, and sending it somewhere.

import SwiftUI
import UIKit

/// Picking how a passage should look, and sending it somewhere.
struct QuoteCardSheet: View {
    let quote: String
    let book: Book

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var styleID: String = "book"
    @State private var ratio: QuoteRatio = .square
    @State private var rendering = false

    /// The book's own colour first — a card in the tone of its cover is the
    /// one that reads as *this* book rather than as a template.
    private var styles: [QuoteStyle] {
        [QuoteStyle.book(CoverIdentity(book).tone)] + QuoteStyle.presets
    }

    private var style: QuoteStyle {
        styles.first { $0.id == styleID } ?? styles[0]
    }

    private var author: String? { book.creators.first?.name }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 26) {
                    preview
                    controls
                    actions
                }
                .screenPadding()
                .padding(.top, Spacing.md)
                .padding(.bottom, 36)
            }
            .scrollIndicators(.hidden)
            .background(ScreenBackground())
            .navigationTitle("Quote card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .tint(palette.accentColor)
    }

    private var preview: some View {
        GeometryReader { geometry in
            QuoteCard(
                quote: quote,
                title: book.displayTitle,
                author: author,
                style: style,
                ratio: ratio,
                width: geometry.size.width
            )
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            .shadow(color: .black.opacity(0.28), radius: 22, y: 10)
        }
        // The card sizes itself off the width it is given, so the container
        // has to reserve the height that width will produce.
        .aspectRatio(ratio.value, contentMode: .fit)
        .animation(Motion.settle, value: ratio)
        .animation(Motion.settle, value: styleID)
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionLabel("Background")
            HStack(spacing: 12) {
                ForEach(styles) { option in
                    Button {
                        guard styleID != option.id else { return }
                        Haptics.select()
                        withAnimation(Motion.snap) { styleID = option.id }
                    } label: {
                        Circle()
                            .fill(option.gradient)
                            .frame(width: 34, height: 34)
                            .overlay(
                                Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1)
                            )
                            .overlay {
                                if styleID == option.id {
                                    Circle()
                                        .strokeBorder(palette.accentColor, lineWidth: 2)
                                        .padding(-4)
                                }
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(option.id.capitalized)
                    .accessibilityAddTraits(styleID == option.id ? [.isSelected, .isButton] : .isButton)
                }
                Spacer(minLength: 0)
            }

            SectionLabel("Shape")
            PillSelector(
                options: QuoteRatio.allCases,
                label: \.label,
                selection: $ratio,
                detail: { $0.detail }
            )
        }
    }

    private var actions: some View {
        VStack(spacing: Spacing.md) {
            Button {
                Haptics.tap()
                share()
            } label: {
                Label("Share", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(FilledButtonStyle())
            .disabled(rendering)

            Button {
                Haptics.success()
                if let image = render() {
                    UIPasteboard.general.image = image
                }
            } label: {
                Label("Copy image", systemImage: "doc.on.doc")
            }
            .buttonStyle(FilledButtonStyle(prominent: false))
            .disabled(rendering)
        }
    }

    private func share() {
        rendering = true
        defer { rendering = false }
        guard let image = render() else { return }
        ShareSheet.present(items: [image])
    }

    /// The card at export size. 1080pt wide with a scale of 1 gives a 1080px
    /// PNG — the size every social surface wants — and because the card's
    /// metrics are all fractions of its width, it is pixel-for-pixel the
    /// preview, just larger.
    @MainActor
    private func render() -> UIImage? {
        let renderer = ImageRenderer(
            content: QuoteCard(
                quote: quote,
                title: book.displayTitle,
                author: author,
                style: style,
                ratio: ratio,
                width: 1080
            )
        )
        renderer.scale = 1
        renderer.isOpaque = true
        return renderer.uiImage
    }
}
