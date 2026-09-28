//  ShareStatsSection.swift
//  The "Share stats with household" switch on the You tab. Account
//  configuration under rule 08: saved directly, never queued, disabled
//  offline, and a failed save surfaces its error rather than claiming a
//  change that exists nowhere.

import SwiftUI

struct ShareStatsSection: View {
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

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            SectionLabel("Sharing")

            VStack(alignment: .leading, spacing: Spacing.md) {
                Plate {
                    PlateRow(label: "Share stats with household", isFirst: true) {
                        Toggle("", isOn: $shareStats)
                            .labelsHidden()
                            .tint(palette.accentColor)
                            .disabled(!connectivity.isOnline || isSaving)
                    }
                }

                Text(error ?? "Other readers on this server can pick you on their Stats tab.")
                    .font(.ui(12))
                    .foregroundStyle(error == nil ? palette.ink3Color : palette.badColor)
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
}
