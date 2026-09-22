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
    /// Whether the *server's* detail has landed, not the replica's. The
    /// description and rules are shown and sent only once it has: the cached
    /// copy can predate an edit made on another device, and submitting it
    /// would put that edit back.
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

    /// A rename needs nothing but the summary the card already had; a rule
    /// edit needs the fresh rule set, or it would replace rules it never saw.
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
                        if isLoaded {
                            PlateField(
                                label: "Description",
                                text: $description,
                                hint: "Optional",
                                multiline: true
                            )
                        }
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
    /// are left alone: the reader may already be typing into them. The
    /// replica's answer seeds the fields but does not unlock them; only the
    /// server's does, so a stale description or rule set is never what gets
    /// saved. Offline the stream ends without one, and the sheet stays a
    /// rename-and-visibility form — which `canSave` already refuses offline.
    private func load() async {
        do {
            for try await read in UserDataService.shelf(id: shelf.id) {
                description = read.value.description ?? ""
                matchMode = read.value.matchMode ?? .all
                rules = read.value.rules
                if read.isFresh {
                    isLoaded = true
                    break
                }
            }
        } catch {}
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

        // `description` is sent even when blank — `nil` means "leave it", and
        // clearing one is a change the reader can make here — but only once
        // the server's copy was shown, so the field is never sent unseen.
        let request = UpdateShelfRequest(
            name: name,
            description: isLoaded
                ? description.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
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
