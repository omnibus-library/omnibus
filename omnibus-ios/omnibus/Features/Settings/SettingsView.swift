//  SettingsView.swift
//  Admin-only server settings: library paths, the way in to notifications,
//  and index maintenance.

import SwiftUI

/// Whether the library paths on screen are the server's, kept apart from the
/// view so the rules are testable. Saving posts both paths whole, so blank
/// fields that were never filled from the server would clear the library.
struct LibraryPathsLoad: Equatable {
    /// Set by the first read that answers, and never unset: a later appearance
    /// (coming back from Notifications) must not overwrite paths being typed.
    private(set) var hasLoaded = false
    private(set) var isLoading = false
    /// Why the last read failed, while none has answered.
    private(set) var failure: String?

    /// Whether an appearance should read the paths.
    var needsLoad: Bool { !hasLoaded && !isLoading }
    /// Only the server's own paths may be posted back.
    var canSave: Bool { hasLoaded }
    /// Nothing to show yet: no answer and no failure to explain.
    var isWaiting: Bool { !hasLoaded && failure == nil }

    mutating func begin() { isLoading = true }

    mutating func succeeded() {
        hasLoaded = true
        isLoading = false
        failure = nil
    }

    /// A cancelled read (the view went away mid-request) is no failure: the
    /// next appearance reads again.
    mutating func failed(_ error: Error) {
        isLoading = false
        guard !isCancellation(error) else { return }
        failure = (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}

struct SettingsView: View {
    @Environment(\.palette) private var palette

    @State private var ebookPath = ""
    @State private var audiobookPath = ""
    @State private var load = LibraryPathsLoad()
    @State private var isSaving = false
    @State private var status: String?
    @State private var isError = false

    var body: some View {
        Group {
            if load.isWaiting {
                LoadingView()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        paths
                        notifications
                        maintenance
                        if let status { statusLine(status) }
                    }
                    .screenPadding()
                    .padding(.top, Spacing.md)
                    .padding(.bottom, 40)
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .background(ScreenBackground())
        .navigationTitle("Server settings")
        .navigationBarTitleDisplayMode(.inline)
        .task { if load.needsLoad { await read() } }
    }

    /// A filesystem path is long, monospaced, and edited whole — a trailing
    /// `LabeledContent` field gave it a third of the row and truncated the part
    /// that identifies it.
    @ViewBuilder
    private var paths: some View {
        if load.hasLoaded {
            pathFields
        } else {
            unreadPaths
        }
    }

    /// The paths couldn't be read, so there is nothing safe to save over them.
    private var unreadPaths: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionLabel("Library paths")
            Text("Couldn\u{2019}t read the library paths. \(load.failure ?? "")")
                .font(.ui(13))
                .foregroundStyle(palette.badColor)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("settings-paths-error")
            Button {
                Task { await read() }
            } label: {
                if load.isLoading {
                    ProgressView()
                } else {
                    Text("Try again")
                }
            }
            .buttonStyle(EmptyStateActionStyle())
            .disabled(load.isLoading)
        }
    }

    private var pathFields: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionLabel("Library paths")

            Plate {
                PlateField(
                    label: "Ebooks", text: $ebookPath, isFirst: true,
                    hint: "/path/to/ebooks"
                )
                PlateField(
                    label: "Audiobooks", text: $audiobookPath,
                    hint: "/path/to/audiobooks"
                )
            }

            Button {
                Task { await save() }
            } label: {
                if isSaving {
                    ProgressView().tint(palette.accentInk.color)
                } else {
                    Text("Save")
                }
            }
            .buttonStyle(FilledButtonStyle())
            .disabled(isSaving || !load.canSave)

            Text("Saving repoints the library and reindexes in the background.")
                .font(.ui(12))
                .foregroundStyle(palette.ink3Color)
        }
    }

    private var notifications: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            SectionLabel("Notifications")

            VStack(spacing: 0) {
                NavigationLink(value: Destination.notifications) {
                    rowLabel(
                        "Connections and public URL",
                        detail: "Where the server sends alerts through ntfy, and the address their links open.",
                        icon: "bell", isFirst: true, chevron: true
                    )
                }
                .buttonStyle(PressableStyle())
                .accessibilityIdentifier("settings-notifications")
                RecordRule()
            }
        }
    }

    private var maintenance: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            SectionLabel("Maintenance")

            VStack(spacing: 0) {
                taskRow(
                    "Reindex library", detail: "Re-read every file's metadata.",
                    icon: "arrow.triangle.2.circlepath", isFirst: true
                ) {
                    await post("/api/reindex", "Reindex started.")
                }
                taskRow(
                    "Scan library", detail: "Look for files added or removed on disk.",
                    icon: "magnifyingglass"
                ) {
                    await post("/api/scan-library", "Scan started.")
                }
                taskRow(
                    "Rebuild search index", detail: "Recreate the full-text index.",
                    icon: "text.magnifyingglass"
                ) {
                    await post("/api/fts/rebuild", "Search index rebuilt.")
                }
                RecordRule()
            }
        }
    }

    /// Each job says what it will do — the names alone don't distinguish a
    /// reindex from a scan, and both are slow enough to be worth choosing well.
    private func taskRow(
        _ title: String, detail: String, icon: String,
        isFirst: Bool = false, action: @escaping () async -> Void
    ) -> some View {
        Button {
            Haptics.tap()
            Task { await action() }
        } label: {
            rowLabel(title, detail: detail, icon: icon, isFirst: isFirst)
        }
        .buttonStyle(PressableStyle())
    }

    private func rowLabel(
        _ title: String, detail: String, icon: String, isFirst: Bool, chevron: Bool = false
    ) -> some View {
        VStack(spacing: 0) {
            if !isFirst { Hairline() }

            HStack(spacing: Spacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(palette.accentColor)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.ui(15))
                        .foregroundStyle(palette.ink0Color)
                    Text(detail)
                        .font(.ui(11.5))
                        .foregroundStyle(palette.ink3Color)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 0)

                if chevron {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(palette.ink3Color.opacity(0.7))
                        .accessibilityHidden(true)
                }
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
    }

    private func statusLine(_ status: String) -> some View {
        Label(status, systemImage: isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
            .font(.ui(13))
            .foregroundStyle(isError ? palette.badColor : palette.okColor)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
            .background(
                RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                    .fill((isError ? palette.badColor : palette.okColor).opacity(0.12))
            )
            .transition(.opacity.combined(with: .move(edge: .top)))
    }

    private func read() async {
        load.begin()
        do {
            let settings: LibrarySettings = try await APIClient.shared.get("/api/settings")
            ebookPath = settings.ebookLibraryPath ?? ""
            audiobookPath = settings.audiobookLibraryPath ?? ""
            load.succeeded()
        } catch {
            load.failed(error)
        }
    }

    private func save() async {
        guard load.canSave else { return }
        isSaving = true
        defer { isSaving = false }
        let body = LibrarySettings(
            ebookLibraryPath: ebookPath.nilIfBlank,
            audiobookLibraryPath: audiobookPath.nilIfBlank
        )
        do {
            let _: Empty = try await APIClient.shared.post("/api/settings", body: body)
            // The reindex runs in a background task server-side, so the save
            // returning is not the same as the library being current.
            show("Saved. Reindexing in the background.", error: false)
        } catch {
            show((error as? APIError)?.errorDescription ?? error.localizedDescription, error: true)
        }
    }

    private func post(_ path: String, _ success: String) async {
        do {
            let _: Empty = try await APIClient.shared.post(path, body: Empty())
            show(success, error: false)
        } catch {
            show((error as? APIError)?.errorDescription ?? error.localizedDescription, error: true)
        }
    }

    private func show(_ message: String, error: Bool) {
        withAnimation {
            status = message
            isError = error
        }
        error ? Haptics.warning() : Haptics.success()
    }
}
