//  QuoteCardSheet.swift
//  Picking how a passage should look, and sending it somewhere.

import SwiftUI
import UIKit

/// The seed colours of the custom swatches: a coral to teal split.
private enum CustomSeed {
    static let coral = Color(.sRGB, red: 232.0 / 255, green: 115.0 / 255, blue: 90.0 / 255)
    static let teal = Color(.sRGB, red: 42.0 / 255, green: 157.0 / 255, blue: 143.0 / 255)
}

/// Picking how a passage should look, and sending it somewhere.
struct QuoteCardSheet: View {
    let quote: String
    let book: Book

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    /// `nil` is the book's own colour, so the sheet opens on Solid · Book.
    @State private var styleID: String?
    @State private var ratio: QuoteRatio = .square
    @State private var type = QuoteType()
    @State private var moreBefore = false
    // Both rows overflow on every iPhone, and the scroll callback may not fire before the first scroll.
    @State private var moreAfter = true
    @State private var customColor = CustomSeed.coral
    @State private var customFrom = CustomSeed.coral
    @State private var customTo = CustomSeed.teal
    @State private var customAngle = 135
    @State private var coverPairs: [QuoteStyle] = []

    /// The book's own colour first — a card in the tone of its cover is the
    /// one that reads as *this* book rather than as a template.
    private var bookStyle: QuoteStyle { .book(CoverIdentity(book).tone) }

    private var solids: [QuoteStyle] { [bookStyle] + QuoteStyle.solids }

    private var gradients: [QuoteStyle] { coverPairs + QuoteStyle.gradients }

    private var customSolid: QuoteStyle { .customSolid(OKLCH.from(customColor)) }

    private var customGradient: QuoteStyle {
        .customGradient(from: OKLCH.from(customFrom), to: OKLCH.from(customTo), angle: customAngle)
    }

    private var style: QuoteStyle {
        guard let styleID else { return bookStyle }
        let all = solids + gradients + [customSolid, customGradient]
        return all.first(where: { $0.id == styleID }) ?? bookStyle
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
        .task {
            guard book.coverURL != nil else { return }
            let fetched: CoverPalette? = try? await APIClient.shared.get("/api/books/\(book.uuid)/cover/palette")
            coverPairs = fetched?.styles ?? []
        }
    }

    private var preview: some View {
        GeometryReader { geometry in
            QuoteCard(
                quote: quote,
                title: book.displayTitle,
                author: author,
                style: style,
                ratio: ratio,
                type: type,
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
            HStack(spacing: Spacing.sm) {
                SectionLabel("Background")
                kindMenu
                Spacer(minLength: 0)
            }
            swatchRow
            if style.id == customGradient.id {
                gradientEditor
            }

            SectionLabel("Type")
            PillSelector(options: QuoteFace.allCases, label: \.label, selection: $type.face)
            HStack(spacing: Spacing.sm) {
                PillSelector(options: QuoteSize.allCases, label: \.label, selection: $type.size)
                toggleChip("Bold", systemImage: "bold", isOn: $type.bold)
                toggleChip("Italic", systemImage: "italic", isOn: $type.italic)
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

    private var kind: Binding<QuoteStyle.Kind> {
        Binding(
            get: { style.kind },
            set: { newKind in
                guard newKind != style.kind else { return }
                withAnimation(Motion.snap) {
                    styleID = newKind == .solid ? bookStyle.id : gradients.first?.id
                }
            }
        )
    }

    private var kindMenu: some View {
        Menu {
            Picker("Background", selection: kind) {
                Label("Solid", systemImage: "circle.fill").tag(QuoteStyle.Kind.solid)
                Label("Gradient", systemImage: "app.fill").tag(QuoteStyle.Kind.gradient)
            }
        } label: {
            HStack(spacing: 4) {
                Text(style.kind == .solid ? "Solid" : "Gradient")
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
            }
            .font(.ui(13, weight: .medium))
            .foregroundStyle(palette.ink1Color)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Capsule().fill(palette.bg2Color))
        }
    }

    private var swatchRow: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                BookCover(identity: CoverIdentity(book), size: .sm, cornerRadius: 3)
                    .frame(width: 24, height: 36)
                    .accessibilityHidden(true)
                if style.kind == .solid {
                    ForEach(solids) { swatch($0) }
                    customColorSwatch
                } else {
                    ForEach(coverPairs) { swatch($0) }
                    if !coverPairs.isEmpty { divider }
                    ForEach(QuoteStyle.gradients) { swatch($0) }
                    customGradientSwatch
                }
            }
        }
        .scrollIndicators(.hidden)
        .frame(height: 36)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.x > 1
        } action: { _, more in
            moreBefore = more
        }
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.x + geometry.containerSize.width < geometry.contentSize.width - 1
        } action: { _, more in
            moreAfter = more
        }
        .mask { edgeFade }
    }

    /// Fades only the side that has more to scroll to.
    private var edgeFade: some View {
        HStack(spacing: 0) {
            LinearGradient(
                colors: [moreBefore ? .clear : .black, .black],
                startPoint: .leading,
                endPoint: .trailing
            )
            .frame(width: 24)
            Rectangle().fill(.black)
            LinearGradient(
                colors: [.black, moreAfter ? .clear : .black],
                startPoint: .leading,
                endPoint: .trailing
            )
            .frame(width: 24)
        }
    }

    private func swatch(_ option: QuoteStyle) -> some View {
        let isOn = style.id == option.id

        return Button {
            guard !isOn else { return }
            Haptics.select()
            withAnimation(Motion.snap) { styleID = option.id }
        } label: {
            if option.kind == .solid {
                swatchFace(.solid, fill: option.from.color, isOn: isOn)
            } else {
                swatchFace(.gradient, fill: option.gradient, isOn: isOn)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.name)
        .accessibilityAddTraits(isOn ? [.isSelected, .isButton] : .isButton)
    }

    /// Solids are circles and gradients rounded squares, so a reader can tell
    /// the two apart by shape. The ring sits inside the 36pt cell, clear of the
    /// row's clipping.
    private func swatchFace<Fill: ShapeStyle>(
        _ kind: QuoteStyle.Kind, fill: Fill, isOn: Bool
    ) -> some View {
        ZStack {
            switch kind {
            case .solid:
                Circle()
                    .fill(fill)
                    .frame(width: 28, height: 28)
                    .overlay(Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1))
                if isOn {
                    Circle().strokeBorder(palette.accentColor, lineWidth: 2)
                }
            case .gradient:
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(fill)
                    .frame(width: 28, height: 28)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(.white.opacity(0.18), lineWidth: 1)
                    )
                if isOn {
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .strokeBorder(palette.accentColor, lineWidth: 2)
                }
            }
        }
        .frame(width: 36, height: 36)
        .contentShape(Rectangle())
    }

    private var divider: some View {
        Rectangle()
            .fill(.white.opacity(0.16))
            .frame(width: 1, height: 22)
            .frame(width: 9, height: 36)
            .accessibilityHidden(true)
    }

    private var plusMark: some View {
        Image(systemName: "plus")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.5), radius: 1)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    /// SwiftUI cannot open a `ColorPicker` from a button of our own, so its
    /// system well is the swatch.
    private var customColorSwatch: some View {
        let isOn = style.id == customSolid.id

        return ColorPicker("Custom colour", selection: $customColor, supportsOpacity: false)
            .labelsHidden()
            .frame(width: 36, height: 36)
            .overlay { plusMark }
            .overlay {
                if isOn {
                    Circle().strokeBorder(palette.accentColor, lineWidth: 2)
                        .allowsHitTesting(false)
                }
            }
            .onChange(of: customColor) { _, _ in
                styleID = customSolid.id
            }
            // Re-picking the same colour changes nothing, so a tap selects it too.
            .simultaneousGesture(TapGesture().onEnded { styleID = customSolid.id })
            .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    private var customGradientSwatch: some View {
        let isOn = style.id == customGradient.id
        let split = LinearGradient(
            stops: [
                .init(color: CustomSeed.coral, location: 0),
                .init(color: CustomSeed.coral, location: 0.5),
                .init(color: CustomSeed.teal, location: 0.5),
                .init(color: CustomSeed.teal, location: 1),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )

        return Button {
            guard !isOn else { return }
            Haptics.select()
            withAnimation(Motion.snap) { styleID = customGradient.id }
        } label: {
            swatchFace(.gradient, fill: split, isOn: isOn)
                .overlay { plusMark }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Custom gradient")
        .accessibilityAddTraits(isOn ? [.isSelected, .isButton] : .isButton)
    }

    private var gradientEditor: some View {
        HStack(spacing: Spacing.lg) {
            stopWell("From", selection: $customFrom)
            stopWell("To", selection: $customTo)
            Spacer(minLength: 0)
            Button {
                Haptics.select()
                withAnimation(Motion.snap) { customAngle = (customAngle + 45) % 360 }
            } label: {
                Label("\(customAngle)°", systemImage: "arrow.clockwise")
                    .font(.ui(13, weight: .medium))
                    .foregroundStyle(palette.ink1Color)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(palette.bg2Color))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Direction")
            .accessibilityValue("\(customAngle) degrees")
        }
    }

    private func stopWell(_ title: String, selection: Binding<Color>) -> some View {
        ColorPicker(selection: selection, supportsOpacity: false) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.ui(12, weight: .medium))
                    .foregroundStyle(palette.ink2Color)
                Text(OKLCH.from(selection.wrappedValue).hex)
                    .font(.monoUI(12))
                    .foregroundStyle(palette.ink0Color)
            }
        }
        .fixedSize()
    }

    private func toggleChip(_ label: String, systemImage: String, isOn: Binding<Bool>) -> some View {
        Button {
            Haptics.select()
            withAnimation(Motion.snap) { isOn.wrappedValue.toggle() }
        } label: {
            Chip(label: label, isOn: isOn.wrappedValue, systemImage: systemImage)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn.wrappedValue ? [.isSelected, .isButton] : .isButton)
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

            Button {
                Haptics.success()
                if let image = render() {
                    UIPasteboard.general.image = image
                }
            } label: {
                Label("Copy image", systemImage: "doc.on.doc")
            }
            .buttonStyle(FilledButtonStyle(prominent: false))
        }
    }

    private func share() {
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
                type: type,
                width: 1080
            )
        )
        renderer.scale = 1
        renderer.isOpaque = true
        return renderer.uiImage
    }
}
