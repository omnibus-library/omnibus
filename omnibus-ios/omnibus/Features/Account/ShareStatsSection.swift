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
                            .disabled(!connectivity.isOnline)
                    }
                }

                Text(error ?? "Other readers on this server can pick you on their Stats tab.")
                    .font(.ui(12))
                    .foregroundStyle(error == nil ? palette.ink3Color : palette.badColor)
            }
        }
        .screenPadding()
        .task {
            let current = app.user?.shareStats ?? true
            shareStats = current
            saved = current
        }
        .onChange(of: shareStats) { previous, next in
            guard next != saved else { return }
            Task {
                do {
                    try await AuthService.setShareStats(next)
                    saved = next
                    await app.refreshUser()
                    error = nil
                    Haptics.success()
                } catch let failure {
                    // Account configuration, so no outbox takes this (rule
                    // 08) — a swallowed failure would leave the switch
                    // showing a setting the server never received.
                    shareStats = previous
                    error = (failure as? APIError)?.errorDescription ?? failure.localizedDescription
                    Haptics.warning()
                }
            }
        }
    }
}
