//  DeleteBookSheet.swift
//  Admin "Delete files…" on book detail: pick the items to remove, then
//  confirm with copy that says whether the book itself goes. Port of the web
//  `DeleteBookDialog` (frontend-js/src/components/DeleteBookDialog/); the
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

    /// Whether the confirm step is up. A book with nothing to pick skips
    /// straight to the record-delete confirm.
    private func isConfirming(_ manifest: BookDeletionManifest) -> Bool {
        confirming || manifest.itemCount == 0
    }

    private var title: String {
        guard let manifest else { return DeleteSelectionCopy.menuLabel(hasFiles: !book.formats.isEmpty) }
        guard isConfirming(manifest) else {
            return "Delete files from \u{201c}\(book.displayTitle)\u{201d}?"
        }
        return confirmCopy(manifest).heading
    }

    private func confirmCopy(_ manifest: BookDeletionManifest) -> DeleteSelectionCopy {
        .resolve(
            title: book.displayTitle,
            manifest: manifest,
            pickedFiles: pickedFiles,
            pickedCopies: pickedCopies
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // No dismissal mid-delete — closing would hide the outcome while
            // the request keeps running.
            BookSheetHeader(title: title, closes: !busy) { dismiss() }

            if let manifest {
                ScrollView {
                    Group {
                        if isConfirming(manifest) {
                            confirm(manifest)
                        } else {
                            choose(manifest)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 28)
                }
                .scrollIndicators(.hidden)
            } else if let error {
                ErrorStateView(message: error) { Task { await load() } }
            } else {
                LoadingView()
            }
        }
        .bookSheet([.fraction(0.7), .large])
        .interactiveDismissDisabled(busy)
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

        return VStack(alignment: .leading, spacing: 0) {
            Text(hasCopies
                ? "Choose what to remove. Files are deleted from disk, and a physical copy is only un-recorded."
                : "Each file you choose is deleted from disk and from the library database. This can\u{2019}t be undone.")
                .font(.ui(15))
                .foregroundStyle(palette.ink1Color)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)

            HStack {
                Text(DeleteSelectionCopy.chooseHeading(manifest))
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                Spacer(minLength: 0)
                Button(picked == manifest.itemCount ? "Clear selection" : "Select all") {
                    Haptics.tap()
                    if picked == manifest.itemCount {
                        pickedFiles = []
                        pickedCopies = []
                    } else {
                        pickedFiles = Set(manifest.files.map(\.id))
                        pickedCopies = Set(manifest.copies.map(\.id))
                    }
                }
                .font(.ui(15, weight: .semibold))
                .foregroundStyle(palette.bookText)
                .frame(minHeight: 44)
                .accessibilityIdentifier("delete-select-all")
            }
            .padding(.top, 14)

            ForEach(manifest.files) { file in
                itemRow(
                    id: file.id,
                    title: file.label?.nilIfBlank ?? file.filename,
                    detail: fileDetail(file),
                    picked: $pickedFiles
                )
            }
            ForEach(manifest.copies) { copy in
                itemRow(
                    id: copy.id,
                    title: copy.isbn.map { "Physical copy, ISBN \($0)" } ?? "Physical copy",
                    detail: copy.note?.nilIfBlank ?? "Un-recorded only. Nothing on disk.",
                    picked: $pickedCopies
                )
            }

            HStack(spacing: 10) {
                Button("Cancel") { dismiss() }
                    .buttonStyle(QuietPillStyle(fills: true))

                Button {
                    Haptics.tap()
                    confirming = true
                } label: {
                    Text(DeleteSelectionCopy.chooseAction(picked: picked, hasCopies: hasCopies))
                }
                .buttonStyle(DangerPillStyle(enabled: picked > 0))
                .disabled(picked == 0)
                .accessibilityIdentifier("delete-continue")
            }
            .padding(.top, 16)
        }
    }

    private func itemRow(
        id: Int64, title: String, detail: String, picked: Binding<Set<Int64>>
    ) -> some View {
        let isOn = picked.wrappedValue.contains(id)

        return HStack(spacing: 14) {
            Image(systemName: isOn ? "checkmark.square.fill" : "square")
                .font(.system(size: 22))
                .foregroundStyle(isOn ? palette.dangerText : palette.ink2Color)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.ui(16, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                Text(detail)
                    .font(.ui(14))
                    .foregroundStyle(palette.ink1Color)
            }
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .frame(minHeight: 66)
        .overlay(alignment: .top) {
            Rectangle().fill(palette.ink0Color.opacity(0.1)).frame(height: 1)
        }
        .tapRow {
            Haptics.tap()
            if isOn { picked.wrappedValue.remove(id) } else { picked.wrappedValue.insert(id) }
        }
        .accessibilityAddTraits(isOn ? .isSelected : [])
        .accessibilityIdentifier("delete-item-\(id)")
    }

    private func fileDetail(_ file: BookFileInfo) -> String {
        var parts = [file.format.uppercased()]
        if file.sizeBytes > 0 { parts.append(Format.bytes(file.sizeBytes)) }
        return parts.joined(separator: " · ")
    }

    // MARK: - Step 2: confirm

    private func confirm(_ manifest: BookDeletionManifest) -> some View {
        let copy = confirmCopy(manifest)

        return VStack(alignment: .leading, spacing: 0) {
            Text(copy.body)
                .font(.ui(17))
                .foregroundStyle(palette.ink0Color)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
                .accessibilityIdentifier("delete-confirm-copy")

            if !copy.losses.isEmpty {
                Text("Also gone for good: \(ListFormatter.localizedString(byJoining: copy.losses)).")
                    .font(.ui(15))
                    .foregroundStyle(palette.ink1Color)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.bg2Color)
                    )
                    .padding(.top, 14)
                    .accessibilityIdentifier("delete-losses")
            }

            if let error {
                Text(error)
                    .font(.ui(14))
                    .foregroundStyle(palette.dangerText)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
                    .accessibilityIdentifier("delete-error")
            }

            HStack(spacing: 10) {
                Button(manifest.itemCount > 0 ? "Back" : "Cancel") {
                    error = nil
                    if manifest.itemCount > 0 {
                        confirming = false
                    } else {
                        dismiss()
                    }
                }
                .buttonStyle(QuietPillStyle(fills: true))
                .disabled(busy)
                .accessibilityIdentifier("delete-back")

                Button(role: .destructive) {
                    Haptics.tap()
                    run(manifest)
                } label: {
                    Text(busy ? "Deleting\u{2026}" : copy.action)
                }
                .buttonStyle(DangerPillStyle())
                .disabled(busy)
                .accessibilityIdentifier("delete-confirm")
            }
            .padding(.top, 22)
        }
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

/// A pill that deletes something.
private struct DangerPillStyle: ButtonStyle {
    var enabled = true

    @Environment(\.palette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(17, weight: .semibold))
            .foregroundStyle(enabled ? .white : palette.ink0Color.opacity(0.6))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(Capsule().fill(enabled ? palette.dangerFill : palette.quietFill))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Motion.lift, value: configuration.isPressed)
    }
}
