//  EditShelfSheet.swift
//  Changing a shelf after the fact: its name, description and visibility, and
//  a smart shelf's conditions. The same plate vocabulary as the create sheet,
//  minus the kind — that is fixed the moment a shelf exists.

import SwiftUI

struct EditShelfSheet: View {
    /// What the card already knows. The sheet opens on it at once and fills
    /// the description and rules in from the detail read as it lands, rather
    /// than showing a spinner for fields the reader may not even touch.
    let shelf: ShelfSummary
    var onSaved: () -> Void

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var description = ""
    @State private var visibility: ShelfVisibility
    @State private var matchMode: MatchMode = .all
    @State private var rules: [ShelfRule] = []
    /// Whether the detail read has landed. A smart shelf's rules are only
    /// known then, and saving before that would replace them with nothing —
    /// which the server refuses, but only after a round trip.
    @State private var isLoaded = false
    @State private var isSaving = false
    @State private var error: String?
    @State private var preview: RulePreview?

    private var isOnline: Bool { Connectivity.shared.isOnline }

    init(shelf: ShelfSummary, onSaved: @escaping () -> Void) {
        self.shelf = shelf
        self.onSaved = onSaved
        _name = State(initialValue: shelf.name)
        _visibility = State(initialValue: shelf.visibility)
    }

    private var isSmart: Bool { shelf.kind == .smart }

    private var validRules: [ShelfRule] {
        rules.filter { !$0.value.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    /// The detail read can arrive after the reader started typing; a save is
    /// gated on it only where it matters, which is a smart shelf's rule set.
    private var canSave: Bool {
        !isSaving
            && isOnline
            && !name.trimmingCharacters(in: .whitespaces).isEmpty
            && (!isSmart || (isLoaded && !validRules.isEmpty))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    Plate {
                        PlateField(label: "Name", text: $name, isFirst: true)
                        PlateField(
                            label: "Description",
                            text: $description,
                            hint: "Optional",
                            multiline: true
                        )
                    }

                    group("Visibility") {
                        PillSelector(
                            options: [ShelfVisibility.private, .public],
                            label: { $0 == .private ? "Private" : "Public" },
                            selection: $visibility
                        )

                        Text(visibility == .private
                            ? "Only you can see this shelf."
                            : "Every reader on this server can see it.")
                            .font(.ui(12.5))
                            .foregroundStyle(palette.ink3Color)
                    }

                    if isSmart { conditions }

                    if !isOnline {
                        Text("You're offline. Shelves are saved on the server, so this can wait.")
                            .font(.ui(13))
                            .foregroundStyle(palette.ink3Color)
                    }

                    if let error {
                        Text(error)
                            .font(.ui(13))
                            .foregroundStyle(palette.badColor)
                    }
                }
                .screenPadding()
                .padding(.top, Spacing.md)
                .padding(.bottom, 48)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .background(ScreenBackground())
            .navigationTitle("Edit shelf")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(!canSave)
                }
            }
            .onChange(of: rules) { _, _ in Task { await refreshPreview() } }
            .onChange(of: matchMode) { _, _ in Task { await refreshPreview() } }
            .task { await load() }
        }
        .tint(palette.accentColor)
    }

    private var conditions: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionLabel("Conditions")
            if isLoaded {
                matchSelector
                ruleList
                addConditionButton
                previewLine
            } else {
                ProgressView()
            }
        }
    }

    private var matchSelector: some View {
        PillSelector(
            options: [MatchMode.all, .any],
            label: { (mode: MatchMode) in mode == .all ? "Match all" : "Match any" },
            selection: $matchMode
        )
    }

    private var ruleList: some View {
        VStack(spacing: Spacing.sm) {
            ForEach(rules.indices, id: \.self) { (index: Int) in
                RuleEditorRow(rule: $rules[index]) {
                    withAnimation(Motion.settle) { removeRule(at: index) }
                }
            }
        }
    }

    private func removeRule(at index: Int) {
        guard rules.indices.contains(index) else { return }
        rules.remove(at: index)
    }

    private var addConditionButton: some View {
        Button {
            Haptics.tap()
            withAnimation(Motion.settle) {
                rules.append(ShelfRule(field: .tag, op: .is, value: ""))
            }
        } label: {
            Label("Add condition", systemImage: "plus")
                .font(.ui(13.5, weight: .semibold))
                .foregroundStyle(palette.accentColor)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var previewLine: some View {
        if let preview {
            Text("\(preview.matched) of \(preview.total) books match")
                .font(.monoUI(11))
                .foregroundStyle(palette.ink3Color)
                .contentTransition(.numericText())
                .animation(Motion.snap, value: preview.matched)
        }
    }

    private func group<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionLabel(title)
            content()
        }
    }

    // MARK: - Data

    /// Fill in the fields the summary doesn't carry. The name and visibility
    /// are left alone: the reader may already be typing into them.
    private func load() async {
        for await detail in UserDataService.shelf(id: shelf.id).values() {
            guard !isLoaded else { break }
            description = detail.description ?? ""
            matchMode = detail.matchMode ?? .all
            rules = detail.rules
            isLoaded = true
        }
        // Offline with nothing cached, the stream ends without a value. A
        // manual shelf can still be renamed from the summary alone; a smart
        // one can't be saved without its rules, and `canSave` says so.
        if !isLoaded, !isSmart { isLoaded = true }
    }

    private func refreshPreview() async {
        guard isSmart, isLoaded else { return }
        let valid = validRules
        guard !valid.isEmpty else {
            preview = nil
            return
        }
        preview = try? await UserDataService.previewRule(
            RulePreviewRequest(matchMode: matchMode, rules: valid)
        )
    }

    private func save() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        // `description` is sent even when blank: `nil` would mean "leave it",
        // and clearing a description is a change the reader can make here.
        let request = UpdateShelfRequest(
            name: name,
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            visibility: visibility,
            matchMode: isSmart ? matchMode : nil,
            rules: isSmart ? validRules : nil
        )
        do {
            try await UserDataService.updateShelf(id: shelf.id, request)
            Haptics.success()
            onSaved()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
