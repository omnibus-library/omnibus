//  MetadataEditFields.swift
//  The editor's form pieces: a labelled box, a single-line or paragraph input,
//  a chip list with its entry inline, and the two layouts that set them out.
//  Leaves only: they take bindings, never the network.

import SwiftUI

// MARK: - Layouts

/// One row of the form's six-column grid. Each field takes the columns its
/// span says, whatever its content wants.
struct SpanRow: Layout {
    let spans: [Int]
    var columns = 6
    var spacing: CGFloat = 10

    private func width(of span: Int, in total: CGFloat) -> CGFloat {
        let column = (total - spacing * CGFloat(columns - 1)) / CGFloat(columns)
        return column * CGFloat(span) + spacing * CGFloat(span - 1)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let total = proposal.width ?? 358
        let height = zip(subviews, spans).map { subview, span in
            subview.sizeThatFits(ProposedViewSize(width: width(of: span, in: total), height: nil)).height
        }.max()
        return CGSize(width: total, height: height ?? 0)
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        var x = bounds.minX
        for (subview, span) in zip(subviews, spans) {
            let cell = width(of: span, in: bounds.width)
            subview.place(
                at: CGPoint(x: x, y: bounds.minY),
                proposal: ProposedViewSize(width: cell, height: nil)
            )
            x += cell + spacing
        }
    }
}

/// Chips that wrap, with the last subview (the entry field) taking what is left
/// of the final line, or a line of its own once less than its minimum remains.
struct ChipRowLayout: Layout {
    var spacing: CGFloat = 6
    var minEntryWidth: CGFloat = 90
    private let lineHeight: CGFloat = 34

    private func frames(_ subviews: Subviews, width: CGFloat) -> [CGRect] {
        var frames: [CGRect] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        for (index, subview) in subviews.enumerated() {
            let isEntry = index == subviews.count - 1
            let wanted = isEntry ? minEntryWidth : min(subview.sizeThatFits(.unspecified).width, width)
            if x > 0, x + wanted > width {
                x = 0
                y += lineHeight + spacing
            }
            let taken = isEntry ? width - x : wanted
            frames.append(CGRect(x: x, y: y, width: taken, height: lineHeight))
            x += taken + spacing
        }
        return frames
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        return CGSize(width: width, height: frames(subviews, width: width).last?.maxY ?? lineHeight)
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        for (subview, frame) in zip(subviews, frames(subviews, width: bounds.width)) {
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size)
            )
        }
    }
}

// MARK: - Fields

/// A field's name, with the mark that says it differs from what was loaded.
struct EditFieldLabel: View {
    let text: String
    var isEdited = false

    @Environment(\.palette) private var palette

    var body: some View {
        // The narrow columns have room for the dot and not the word.
        ViewThatFits(in: .horizontal) {
            row(sayingEdited: true)
            row(sayingEdited: false)
        }
    }

    private func row(sayingEdited: Bool) -> some View {
        HStack(spacing: 6) {
            Text(text)
                .font(.ui(14, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .lineLimit(1)
                .fixedSize()
            if isEdited {
                HStack(spacing: 4) {
                    Circle().fill(palette.bookText).frame(width: 6, height: 6)
                    if sayingEdited {
                        Text("edited")
                            .font(.ui(13, weight: .medium))
                            .foregroundStyle(palette.bookText)
                            .fixedSize()
                    }
                }
                .accessibilityElement()
                .accessibilityLabel("edited")
            }
        }
    }
}

extension View {
    /// The ground and rule every input on the sheet sits in.
    func editInputBox(isEdited: Bool = false, corner: CGFloat = 10) -> some View {
        modifier(EditInputBox(isEdited: isEdited, corner: corner))
    }
}

private struct EditInputBox: ViewModifier {
    let isEdited: Bool
    let corner: CGFloat

    @Environment(\.palette) private var palette

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: corner, style: .continuous).fill(palette.bg0Color)
            )
            .overlay {
                RoundedRectangle(cornerRadius: corner, style: .continuous)
                    .strokeBorder(
                        isEdited ? palette.bookText.opacity(0.6) : palette.ink0Color.opacity(0.18),
                        lineWidth: 1
                    )
            }
    }
}

/// A single line of the form: its label, its box, and any autocomplete.
struct EditTextField: View {
    let label: String
    @Binding var text: String
    var hint = ""
    var isEdited = false
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .never
    /// Non-empty offers the pool under the field as the value is typed; a pick
    /// overwrites the value.
    var suggestions: [SuggestionItem] = []
    var identifier: String?

    @Environment(\.palette) private var palette
    @FocusState private var focused: Bool
    /// Closed by a pick: the picked name is often a substring of other entries,
    /// so "the filter still matches" would keep the list open forever.
    @State private var open = false
    @State private var lastPicked: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            EditFieldLabel(text: label, isEdited: isEdited)

            TextField("", text: $text, prompt: prompt)
                .font(.ui(16))
                .foregroundStyle(palette.ink0Color)
                .tint(palette.bookText)
                .keyboardType(keyboard)
                .textInputAutocapitalization(capitalization)
                .autocorrectionDisabled()
                .focused($focused)
                .padding(.horizontal, 12)
                .frame(height: 46)
                .editInputBox(isEdited: isEdited)
                .accessibilityLabel(label)
                .accessibilityIdentifier(identifier ?? "")

            if open, !suggestions.isEmpty {
                let rows = SuggestionPool.filtered(pool: suggestions, current: [text], query: text)
                if !rows.isEmpty {
                    SuggestionList(items: rows) { name in
                        lastPicked = name
                        text = name
                        open = false
                    }
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous).fill(palette.bg2Color)
                    )
                }
            }
        }
        .onChange(of: focused) { _, isFocused in open = isFocused }
        .onChange(of: text) { _, value in
            if value == lastPicked {
                lastPicked = nil
            } else if focused {
                open = true
            }
        }
    }

    private var prompt: Text {
        Text(hint).foregroundStyle(palette.ink1Color.opacity(0.7))
    }
}

/// The description: a paragraph box that grows with what is in it.
struct EditParagraphField: View {
    let label: String
    @Binding var text: String
    var hint = ""
    var isEdited = false
    var identifier: String?

    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            EditFieldLabel(text: label, isEdited: isEdited)

            TextField(
                "", text: $text, prompt: Text(hint).foregroundStyle(palette.ink1Color.opacity(0.7)),
                axis: .vertical
            )
            .font(.ui(16))
            .foregroundStyle(palette.ink0Color)
            .tint(palette.bookText)
            .lineLimit(5...14)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .editInputBox(isEdited: isEdited)
            .accessibilityLabel(label)
            .accessibilityIdentifier(identifier ?? "")
        }
    }
}

/// A list-valued field: removable chips, with the entry inline after them.
/// Order means something in all three lists, so entries append and leave one
/// at a time.
struct EditChipField: View {
    let label: String
    let hint: String
    @Binding var values: [String]
    @Binding var entry: String
    var isEdited = false
    /// Tags refuse an exact re-add; two credited authors can share a name.
    var deduplicates = false
    var suggestions: [SuggestionItem] = []
    var identifier: String?

    @Environment(\.palette) private var palette
    @FocusState private var focused: Bool
    /// Stays closed after a commit until the next keystroke, so the
    /// just-emptied entry doesn't instantly resurface the pool.
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            EditFieldLabel(text: label, isEdited: isEdited)

            ChipRowLayout {
                // Index-identified: an author's name can repeat.
                ForEach(Array(values.enumerated()), id: \.offset) { index, name in
                    chip(name, at: index)
                }
                TextField("", text: $entry, prompt: Text(hint).foregroundStyle(palette.ink1Color.opacity(0.7)))
                    .font(.ui(16))
                    .foregroundStyle(palette.ink0Color)
                    .tint(palette.bookText)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .focused($focused)
                    .onSubmit { commit(entry) }
                    .padding(.horizontal, 4)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityLabel(label)
                    .accessibilityIdentifier(identifier ?? "")
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .frame(minHeight: 46)
            .editInputBox(isEdited: isEdited)
            .animation(Motion.snap, value: values)

            if open {
                let rows = SuggestionPool.filtered(pool: suggestions, current: values, query: entry)
                let create = SuggestionPool.showsCreateRow(pool: suggestions, current: values, typed: entry)
                    ? entry.nilIfBlank : nil
                if !rows.isEmpty || create != nil {
                    SuggestionList(items: rows, createText: create) { commit($0) }
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(palette.bg2Color)
                        )
                }
            }
        }
        .onChange(of: focused) { _, isFocused in open = isFocused }
        .onChange(of: entry) { _, value in
            // A commit clears the entry programmatically; only typing reopens.
            if !value.isEmpty { open = true }
        }
    }

    private func chip(_ name: String, at index: Int) -> some View {
        HStack(spacing: 0) {
            Text(name)
                .font(.ui(15))
                .foregroundStyle(palette.ink0Color)
                .lineLimit(1)
            Button {
                Haptics.tap()
                values.remove(at: index)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(palette.ink1Color)
                    .frame(width: 30, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(name)")
        }
        .padding(.leading, 11)
        .frame(height: 34)
        .background(Capsule().fill(palette.bg2Color))
    }

    private func commit(_ name: String) {
        defer {
            entry = ""
            open = false
        }
        guard
            let chip = ChipEntry.committed(from: name, existing: values, deduplicating: deduplicates)
        else { return }
        Haptics.select()
        values.append(chip)
    }
}
