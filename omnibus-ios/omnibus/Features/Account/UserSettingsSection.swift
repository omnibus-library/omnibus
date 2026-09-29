//  UserSettingsSection.swift
//  The You tab's per-account switches: book-detail scroll stops and sharing
//  stats with the household. Account configuration under rule 08: saved
//  directly, never queued, disabled offline, and a failed save shows its error
//  rather than claiming a change that exists nowhere.

import SwiftUI

struct UserSettingsSection: View {
    /// Owned by `AccountView`, which seeds and saves it.
    @Binding var scrollStops: Bool
    let scrollStopsError: String?

    @Environment(AppState.self) private var app
    @Environment(\.palette) private var palette

    @State private var shareStats = true
    /// The last value this device confirmed the server holds. Compared
    /// against on every flip rather than `app.user` — a `refreshUser()` that
    /// silently fails to land would otherwise leave the next flip believing
    /// nothing had changed and skip its own write.
    @State private var saved = true
    @State private var error: String?
    /// True for the life of a save, so a flip made mid-save can't be
    /// dropped by another flip landing on top of it.
    @State private var isSaving = false
    /// Set once `.task` has seeded from `app.user`, so a later re-render
    /// doesn't re-seed from a value the server may since have changed.
    @State private var hasSeeded = false
    private var connectivity = Connectivity.shared

    // Explicit: the private stored properties would make the memberwise init private.
    init(scrollStops: Binding<Bool>, scrollStopsError: String?) {
        _scrollStops = scrollStops
        self.scrollStopsError = scrollStopsError
    }

    enum Row { case scrollStops, shareStats }

    /// A row's error, else what the setting does in its current state (web's wording).
    nonisolated static func caption(_ row: Row, isOn: Bool, error: String?) -> String {
        if let error { return error }
        switch row {
        case .scrollStops:
            return isOn
                ? "Book details snap through one panel at a time."
                : "Book details scroll continuously, top to bottom."
        case .shareStats:
            return isOn
                ? "Other readers on this server can see your stats page."
                : "Only you can see your stats page."
        }
    }

    /// A server that never sent the field can't save it either.
    private var showsShareStats: Bool { app.user?.shareStatsSetting != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            SectionLabel("User settings")

            Plate {
                PlateRow(
                    label: "Book details scroll stops", isFirst: true,
                    detail: captionText(.scrollStops, isOn: scrollStops, error: scrollStopsError)
                ) {
                    Toggle("", isOn: $scrollStops)
                        .labelsHidden()
                        .tint(palette.accentColor)
                        .disabled(!connectivity.isOnline)
                }

                if showsShareStats {
                    PlateRow(
                        label: "Share stats with household",
                        detail: captionText(.shareStats, isOn: shareStats, error: error)
                    ) {
                        Toggle("", isOn: $shareStats)
                            .labelsHidden()
                            .tint(palette.accentColor)
                            .disabled(!connectivity.isOnline || isSaving)
                    }
                }
            }
        }
        .screenPadding()
        .task {
            guard !hasSeeded else { return }
            hasSeeded = true
            let current = app.user?.shareStats ?? true
            shareStats = current
            saved = current
        }
        .onChange(of: app.user?.shareStats) { _, next in
            guard hasSeeded, !isSaving, let next else { return }
            shareStats = next
            saved = next
        }
        .onChange(of: shareStats) { previous, next in
            guard next != saved else { return }
            isSaving = true
            Task {
                do {
                    try await AuthService.setShareStats(next)
                    saved = next
                    await app.refreshUser()
                    error = nil
                    Haptics.success()
                } catch let failure {
                    shareStats = previous
                    error = (failure as? APIError)?.errorDescription ?? failure.localizedDescription
                    Haptics.warning()
                }
                isSaving = false
            }
        }
    }

    private func captionText(_ row: Row, isOn: Bool, error: String?) -> Text {
        Text(Self.caption(row, isOn: isOn, error: error))
            .font(.ui(12))
            .foregroundStyle(error == nil ? palette.ink3Color : palette.badColor)
    }
}
