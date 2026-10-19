//  UserSettingsSection.swift
//  The You tab's per-account switches: Stack series, book-detail scroll stops
//  and sharing stats with the household. Account configuration under rule 08: saved
//  directly, never queued, disabled offline, and a failed save shows its error
//  rather than claiming a change that exists nowhere.

import SwiftUI

/// An account switch's save rules, separated from the view so they're testable
/// without a UI or a server.
struct AccountSettingToggle: Equatable {
    /// What the switch shows.
    var value = true
    /// The last value this device confirmed the server holds. Compared
    /// against on every flip rather than `app.user` — a `refreshUser()` that
    /// silently fails to land would otherwise leave the next flip believing
    /// nothing had changed and skip its own write.
    var saved = true
    /// True for the life of a save, so a flip made mid-save can't be
    /// dropped by another flip landing on top of it.
    var isSaving = false
    /// Set by the first seed, so a later appearance doesn't re-seed from a
    /// value the server may since have changed.
    var hasSeeded = false
    var error: String?

    mutating func seed(_ current: Bool) {
        guard !hasSeeded else { return }
        hasSeeded = true
        value = current
        saved = current
    }

    /// Follows the server's value, except mid-save, when the save's own answer wins.
    mutating func serverChanged(to next: Bool?) {
        guard hasSeeded, !isSaving, let next else { return }
        value = next
        saved = next
    }

    /// Whether the switch's value needs a write; marks one in flight if so.
    mutating func beginSave() -> Bool {
        guard value != saved else { return false }
        isSaving = true
        return true
    }

    mutating func saveSucceeded(wrote next: Bool) {
        saved = next
        error = nil
    }

    /// A failed write never happened, so the switch goes back to what the server holds.
    mutating func saveFailed(revertTo previous: Bool, message: String) {
        value = previous
        error = message
    }

    mutating func finishSave() {
        isSaving = false
    }

    func isDisabled(online: Bool) -> Bool { !online || isSaving }
}

/// The native twin of the web Account page's user-settings card
/// (`frontend/src/pages/account/user_settings.rs`).
struct UserSettingsSection: View {
    /// Owned by `AccountView`, which seeds and saves it.
    @Binding var scrollStops: Bool
    let scrollStopsError: String?

    @Environment(AppState.self) private var app
    @Environment(\.palette) private var palette

    @State private var stack = AccountSettingToggle(value: false, saved: false)
    @State private var share = AccountSettingToggle()
    private var connectivity = Connectivity.shared

    // Explicit: the private stored properties would make the memberwise init private.
    init(scrollStops: Binding<Bool>, scrollStopsError: String?) {
        _scrollStops = scrollStops
        self.scrollStopsError = scrollStopsError
    }

    enum Row { case stackSeries, scrollStops, shareStats }

    /// A row's error, else what the setting does in its current state (web's wording).
    nonisolated static func caption(_ row: Row, isOn: Bool, error: String?) -> String {
        if let error { return error }
        switch row {
        case .stackSeries:
            return isOn
                ? "Each series folds into one stack wherever books are listed."
                : "Every book in a series keeps its own cover."
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
                    label: "Stack series", isFirst: true,
                    detail: captionText(.stackSeries, isOn: stack.value, error: stack.error)
                ) {
                    Toggle("", isOn: $stack.value)
                        .labelsHidden()
                        .tint(palette.accentColor)
                        .disabled(stack.isDisabled(online: connectivity.isOnline))
                }

                PlateRow(
                    label: "Book details scroll stops",
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
                        detail: captionText(.shareStats, isOn: share.value, error: share.error)
                    ) {
                        Toggle("", isOn: $share.value)
                            .labelsHidden()
                            .tint(palette.accentColor)
                            .disabled(share.isDisabled(online: connectivity.isOnline))
                    }
                }
            }
        }
        .screenPadding()
        .task {
            stack.seed(app.user?.stackSeries ?? false)
            share.seed(app.user?.shareStats ?? true)
        }
        .onChange(of: app.user?.stackSeries) { _, next in stack.serverChanged(to: next) }
        .onChange(of: app.user?.shareStats) { _, next in share.serverChanged(to: next) }
        .onChange(of: stack.value) { previous, next in
            save($stack, from: previous, to: next, write: AuthService.setStackSeries)
        }
        .onChange(of: share.value) { previous, next in
            save($share, from: previous, to: next, write: AuthService.setShareStats)
        }
    }

    /// Writes a flipped switch to the account; a refusal puts it back with the reason.
    private func save(
        _ toggle: Binding<AccountSettingToggle>, from previous: Bool, to next: Bool,
        write: @escaping (Bool) async throws -> Void
    ) {
        guard toggle.wrappedValue.beginSave() else { return }
        Task {
            do {
                try await write(next)
                toggle.wrappedValue.saveSucceeded(wrote: next)
                // Every book grid reads the setting off `app.user`, so this is what restacks them.
                await app.refreshUser()
                Haptics.success()
            } catch let failure {
                toggle.wrappedValue.saveFailed(
                    revertTo: previous,
                    message: (failure as? APIError)?.errorDescription ?? failure.localizedDescription
                )
                Haptics.warning()
            }
            toggle.wrappedValue.finishSave()
        }
    }

    private func captionText(_ row: Row, isOn: Bool, error: String?) -> Text {
        Text(Self.caption(row, isOn: isOn, error: error))
            .font(.ui(12))
            .foregroundStyle(error == nil ? palette.ink3Color : palette.badColor)
    }
}
