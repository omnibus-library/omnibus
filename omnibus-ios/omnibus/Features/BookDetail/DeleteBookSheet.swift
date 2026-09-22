//  DeleteBookSheet.swift
//  Admin "Delete files…" on book detail: pick the items to remove, then
//  confirm with copy that says whether the book itself goes. Port of the web
//  `DeleteBookDialog` (frontend/src/components/delete_book_dialog.rs); the
//  wording lives in `DeleteSelectionCopy` so it can be pinned by a test.

import SwiftUI

struct DeleteBookSheet: View {
    let book: Book
    /// Run with the delete's result; the sheet dismisses itself first.
    var onDeleted: (DeleteBookFilesResult) -> Void

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var manifest: BookDeletionManifest?
    @State private var pickedFiles: Set<Int64> = []
    @State private var pickedCopies: Set<Int64> = []
    @State private var confirming = false
    @State private var busy = false
    @State private var error: String?

    private var picked: Int { pickedFiles.count + pickedCopies.count }

    var body: some View {
        NavigationStack {
            Group {
                if let manifest {
                    // A book with nothing to pick skips straight to the
                    // record-delete confirm.
                    if confirming || manifest.itemCount == 0 {
                        confirm(manifest)
                    } else {
                        choose(manifest)
                    }
                } else if let error {
                    ErrorStateView(message: error) { Task { await load() } }
                } else {
                    LoadingView()
                }
            }
            .background(ScreenBackground())
            .navigationTitle(DeleteSelectionCopy.menuLabel(hasFiles: manifest?.files.isEmpty == false))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        // No dismissal mid-delete — closing would hide the
                        // outcome while the request keeps running.
                        .disabled(busy)
                }
            }
            .interactiveDismissDisabled(busy)
        }
        .presentationDetents([.large])
        .presentationBackground(palette.bg1Color)
        .task { await load() }
    }

    private func load() async {
        error = nil
        do {
            manifest = try await AdminBookService.deletionManifest(uuid: book.uuid)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Step 1: choose

    private func choose(_ manifest: BookDeletionManifest) -> some View {
        let hasCopies = !manifest.copies.isEmpty
        return VStack(alignment: .leading, spacing: Spacing.lg) {
            Text(hasCopies
                ? "Choose what to remove. Files are deleted from disk; a physical copy is only un-recorded."
                : "Choose the files to remove. Each one is deleted from disk and from the library database. This cannot be undone.")
                .font(.ui(13))
                .foregroundStyle(palette.ink2Color)
                .fixedSize(horizontal: false, vertical: true)

            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    if !manifest.files.isEmpty {
                        section(
                            hasCopies ? "Files on disk" : "\(manifest.files.count) \(manifest.files.count == 1 ? "file" : "files") on disk",
                            rows: manifest.files.map { file in
                                itemRow(
                                    id: file.id,
                                    title: file.label?.nilIfBlank ?? file.filename,
                                    detail: fileDetail(file),
                                    badge: file.format.uppercased(),
                                    picked: $pickedFiles
                                )
                            }
                        )
                    }
                    if hasCopies {
                        section(
                            "Physical copies",
                            rows: manifest.copies.map { copy in
                                itemRow(
                                    id: copy.id,
                                    title: copy.isbn.map { "ISBN \($0)" } ?? "Copy without an ISBN",
                                    detail: copy.note?.nilIfBlank ?? "Un-recorded only \u{2014} nothing on disk.",
                                    badge: "PHYS",
                                    picked: $pickedCopies
                                )
                            }
                        )
                    }
                }
            }
            .scrollIndicators(.hidden)

            Button(picked == manifest.itemCount ? "Clear selection" : "Select everything") {
                if picked == manifest.itemCount {
                    pickedFiles = []
                    pickedCopies = []
                } else {
                    pickedFiles = Set(manifest.files.map(\.id))
                    pickedCopies = Set(manifest.copies.map(\.id))
                }
            }
            .font(.ui(13, weight: .medium))
            .foregroundStyle(palette.accentColor)
            .accessibilityIdentifier("delete-select-all")

            Button {
                Haptics.tap()
                confirming = true
            } label: {
                Text(DeleteSelectionCopy.chooseAction(picked: picked, hasCopies: hasCopies))
            }
            .buttonStyle(FilledButtonStyle())
            .disabled(picked == 0)
            .accessibilityIdentifier("delete-continue")
        }
        .screenPadding()
        .padding(.vertical, Spacing.lg)
    }

    private func section(_ title: String, rows: [AnyView]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(title.uppercased())
                .font(.monoUI(9.5))
                .tracking(1.2)
                .foregroundStyle(palette.ink3Color)
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    if index > 0 { Hairline() }
                    row
                }
                RecordRule()
            }
        }
    }

    private func itemRow(
        id: Int64, title: String, detail: String, badge: String, picked: Binding<Set<Int64>>
    ) -> AnyView {
        let isOn = picked.wrappedValue.contains(id)
        return AnyView(
            Button {
                Haptics.tap()
                if isOn { picked.wrappedValue.remove(id) } else { picked.wrappedValue.insert(id) }
            } label: {
                HStack(spacing: Spacing.md) {
                    Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 20, weight: .light))
                        .foregroundStyle(isOn ? palette.accentColor : palette.ink3Color)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title)
                            .font(.ui(14.5, weight: .medium))
                            .foregroundStyle(palette.ink0Color)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Text(detail)
                            .font(.ui(12))
                            .foregroundStyle(palette.ink3Color)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                    Badge(text: badge)
                }
                .padding(.vertical, Spacing.sm)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle())
            .accessibilityAddTraits(isOn ? .isSelected : [])
            .accessibilityIdentifier("delete-item-\(id)")
        )
    }

    private func fileDetail(_ file: BookFileInfo) -> String {
        var parts: [String] = []
        if file.sizeBytes > 0 { parts.append(Format.bytes(file.sizeBytes)) }
        if let path = file.path?.nilIfBlank { parts.append(path) }
        return parts.isEmpty ? file.filename : parts.joined(separator: " · ")
    }

    // MARK: - Step 2: confirm

    private func confirm(_ manifest: BookDeletionManifest) -> some View {
        let copy = DeleteSelectionCopy.resolve(
            title: book.displayTitle,
            manifest: manifest,
            pickedFiles: pickedFiles,
            pickedCopies: pickedCopies
        )
        return VStack(alignment: .leading, spacing: Spacing.lg) {
            SectionLabel(copy.heading)

            Text(copy.body)
                .font(.ui(14))
                .foregroundStyle(palette.ink1Color)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("delete-confirm-copy")

            if !copy.losses.isEmpty {
                Text("Also deleted: \(copy.losses.joined(separator: ", ")).")
                    .font(.ui(13))
                    .foregroundStyle(palette.badColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("delete-losses")
            }

            if let error {
                Text(error)
                    .font(.ui(12.5))
                    .foregroundStyle(palette.badColor)
                    .accessibilityIdentifier("delete-error")
            }

            Spacer(minLength: 0)

            Button(role: .destructive) {
                Haptics.tap()
                run(manifest)
            } label: {
                Text(busy ? "Deleting\u{2026}" : copy.action)
                    .font(.ui(16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(
                        RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                            .fill(palette.badColor)
                    )
            }
            .buttonStyle(PressableStyle())
            .disabled(busy)
            .accessibilityIdentifier("delete-confirm")

            if manifest.itemCount > 0 {
                Button("Back") {
                    error = nil
                    confirming = false
                }
                .buttonStyle(QuietButtonStyle())
                .frame(maxWidth: .infinity)
                .disabled(busy)
                .accessibilityIdentifier("delete-back")
            }
        }
        .screenPadding()
        .padding(.vertical, Spacing.lg)
    }

    private func run(_ manifest: BookDeletionManifest) {
        // A double-tap can land before the disabled state re-renders.
        guard !busy else { return }
        busy = true
        error = nil
        let remaining = manifest.files.filter { !pickedFiles.contains($0.id) }
        Task {
            do {
                let result = try await AdminBookService.deleteBookItems(
                    uuid: book.uuid,
                    fileIDs: pickedFiles.sorted(),
                    copyIDs: pickedCopies.sorted(),
                    remaining: remaining
                )
                dismiss()
                onDeleted(result)
            } catch {
                busy = false
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}
