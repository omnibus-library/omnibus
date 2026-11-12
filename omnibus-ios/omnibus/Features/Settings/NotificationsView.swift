//  NotificationsView.swift
//  Admin Notifications, pushed from Server settings: the server's public URL,
//  which notification links open, and the ntfy connections it posts to — each
//  with a switch that saves in place and how its last delivery went.
//
//  Live configuration, never queued (rule 08): every write is disabled while
//  offline, and the add/edit sheet is `NtfyConnectionSheet`.

import SwiftUI

/// What the add/edit sheet opens on.
enum NtfySheetTarget: Identifiable {
    case new
    case edit(NotificationConnection)

    var id: String {
        switch self {
        case .new: "new"
        case let .edit(connection): "edit-\(connection.id)"
        }
    }
}

struct NotificationsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.palette) private var palette

    @State private var model = NotificationsModel()
    @State private var sheet: NtfySheetTarget?
    @State private var confirmDelete: NotificationConnection?
    @State private var deleteError: String?
    private var connectivity = Connectivity.shared

    // Explicit: the private stored properties would make the memberwise init private.
    init() {}

    private var isOnline: Bool { connectivity.isOnline }

    var body: some View {
        Group {
            if app.user?.isAdmin == false {
                EmptyStateView(
                    icon: "bell.slash", title: "Admins only",
                    message: "Only an admin can change where the server sends notifications."
                )
            } else if model.isLoaded {
                content
            } else if let failure = model.failure {
                ErrorStateView(message: failure) { Task { await model.load() } }
            } else {
                LoadingView()
            }
        }
        .background(ScreenBackground())
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if app.user?.isAdmin != false {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { open(.new) } label: { Image(systemName: "plus") }
                        .disabled(!isOnline || !model.isLoaded)
                        .accessibilityLabel("Add a connection")
                        .accessibilityIdentifier("notifications.add")
                }
            }
        }
        .sheet(item: $sheet) { target in
            sheetView(target)
        }
        .task { await model.load() }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                publicURLSection
                connectionsSection
                if !isOnline {
                    Text("You\u{2019}re offline. Notification settings need a connection to the server.")
                        .font(.ui(13))
                        .foregroundStyle(palette.ink3Color)
                }
            }
            .screenPadding()
            .padding(.top, Spacing.md)
            .padding(.bottom, 40)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .refreshTask { await model.load() }
    }

    // MARK: - Public URL

    @ViewBuilder
    private var publicURLSection: some View {
        let status = model.publicURL ?? PublicURLStatus(url: nil, source: .none)
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionLabel("Public server URL")

            Text(NotificationsFlow.publicURLExplainer)
                .font(.ui(13))
                .foregroundStyle(palette.ink2Color)
                .fixedSize(horizontal: false, vertical: true)

            Plate {
                PlateField(
                    label: "Public URL",
                    text: Bindable(model).publicURLText,
                    isFirst: true,
                    keyboard: .URL,
                    identifier: "notifications.publicURL.field",
                    // A URL in effect that isn't saved here is shown, not offered for editing.
                    placeholder: status.source == .settings
                        ? "https://books.example.com" : status.url ?? "https://books.example.com",
                    capitalization: .never
                )
            }

            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                Text(model.publicURLError ?? NotificationsFlow.sourceLine(status))
                    .font(.ui(12))
                    .foregroundStyle(model.publicURLError == nil ? palette.ink3Color : palette.badColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier(
                        model.publicURLError == nil ? "notifications.publicURL.source" : "notifications.publicURL.error"
                    )

                Spacer(minLength: 0)

                if status.source == .settings {
                    let clearOff = !isOnline || model.isSavingPublicURL
                    Button("Clear") { Task { await model.clearPublicURL() } }
                        .font(.ui(13.5, weight: .medium))
                        .foregroundStyle(palette.ink2Color)
                        .opacity(clearOff ? 0.45 : 1)
                        .disabled(clearOff)
                        .accessibilityIdentifier("notifications.publicURL.clear")
                }

                let saveOff = !model.isPublicURLEdited || !isOnline || model.isSavingPublicURL
                Button(model.publicURLSaved ? "Saved" : "Save") {
                    Task {
                        await model.savePublicURL()
                        model.publicURLError == nil ? Haptics.success() : Haptics.warning()
                    }
                }
                .font(.ui(13.5, weight: .semibold))
                .foregroundStyle(model.publicURLSaved ? palette.okColor : palette.accentColor)
                // A text button keeps its colour when disabled; "Saved" is a state, not an idle button.
                .opacity(saveOff && !model.publicURLSaved ? 0.45 : 1)
                .disabled(model.publicURLSaved || saveOff)
                .contentTransition(.numericText())
                .animation(Motion.snap, value: model.publicURLSaved)
                .accessibilityIdentifier("notifications.publicURL.save")
            }
        }
    }

    // MARK: - Connections

    private var connectionsSection: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            SectionLabel("Connections")

            Text("Where the server sends a notification when something needs a person.")
                .font(.ui(13))
                .foregroundStyle(palette.ink2Color)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, Spacing.xs)

            if let deleteError = deleteError ?? model.listNotice {
                Text(deleteError)
                    .font(.ui(12.5))
                    .foregroundStyle(palette.badColor)
                    .accessibilityIdentifier("notifications.deleteError")
            }

            if model.connections.isEmpty {
                emptyConnections
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(model.connections.enumerated()), id: \.element.id) { index, connection in
                        ConnectionRow(
                            connection: connection,
                            isFirst: index == 0,
                            isSaving: model.toggling.contains(connection.id),
                            isOnline: isOnline,
                            rowError: model.rowErrors[connection.id],
                            setEnabled: { on in Task { await model.setEnabled(connection, on) } },
                            open: { open(.edit(connection)) },
                            delete: { confirmDelete = connection }
                        )
                    }
                    RecordRule()
                }
                .confirmationDialog(
                    "Delete \(confirmDelete?.name ?? "this connection")?",
                    isPresented: Binding(
                        get: { confirmDelete != nil },
                        set: { if !$0 { confirmDelete = nil } }
                    ),
                    titleVisibility: .visible,
                    presenting: confirmDelete
                ) { connection in
                    Button("Delete connection", role: .destructive) {
                        Task {
                            deleteError = await model.delete(id: connection.id)
                            deleteError == nil ? Haptics.success() : Haptics.warning()
                        }
                    }
                    Button("Cancel", role: .cancel) {}
                } message: { _ in
                    Text("The server stops sending to it. Nothing changes on the ntfy server.")
                }
                // The dialog's answers read in ink; the accent is too faint on a light ground.
                .tint(palette.ink0Color)
            }
        }
    }

    /// Nothing set up yet: what a connection is, and the way to add one.
    private var emptyConnections: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("No connections yet")
                .font(.display(22))
                .foregroundStyle(palette.ink0Color)

            Text(
                model.availableEvents.isEmpty
                    ? "A connection is an ntfy topic the server posts to, so a phone subscribed to it hears about things that need someone. What it can be told about appears once book requests are turned on."
                    : "A connection is an ntfy topic the server posts to, so a phone subscribed to it hears when a book request needs a version picked."
            )
            .font(.ui(13))
            .foregroundStyle(palette.ink2Color)
            .fixedSize(horizontal: false, vertical: true)

            Button("Add a connection") {
                Haptics.tap()
                open(.new)
            }
            .buttonStyle(EmptyStateActionStyle())
            .disabled(!isOnline)
            .padding(.top, Spacing.sm)
            .accessibilityIdentifier("notifications.addEmpty")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.lg)
        .background(
            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .fill(palette.bg1Color)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .strokeBorder(palette.line2.color, lineWidth: 0.5)
        )
    }

    // MARK: - Sheet

    private func open(_ target: NtfySheetTarget) {
        deleteError = nil
        sheet = target
    }

    @ViewBuilder
    private func sheetView(_ target: NtfySheetTarget) -> some View {
        switch target {
        case .new:
            NtfyConnectionSheet(
                draft: NtfyDraft(offering: model.availableEvents),
                connection: nil, screen: model
            )
        case let .edit(connection):
            if let draft = NtfyDraft(editing: connection) {
                NtfyConnectionSheet(draft: draft, connection: connection, screen: model)
            }
        }
    }
}

/// One connection: its name, where it posts, its last delivery, and its switch.
private struct ConnectionRow: View {
    let connection: NotificationConnection
    let isFirst: Bool
    let isSaving: Bool
    let isOnline: Bool
    let rowError: String?
    let setEnabled: (Bool) -> Void
    let open: () -> Void
    let delete: () -> Void

    @Environment(\.palette) private var palette

    /// Only a provider and sign-in this build knows can be edited; any row can
    /// be switched, since the switch sends nothing but `enabled`.
    private var isKnown: Bool { NotificationsFlow.isEditable(connection) }

    var body: some View {
        VStack(spacing: 0) {
            if !isFirst { Hairline() }

            HStack(alignment: .top, spacing: Spacing.md) {
                Image(systemName: connection.enabled ? "bell" : "bell.slash")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(connection.enabled ? palette.accentColor : palette.ink3Color)
                    .frame(width: 24, alignment: .leading)
                    .padding(.top, 2)
                    .accessibilityHidden(true)

                summary
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .modifier(OpensSheet(enabled: isKnown, action: open))
                    .accessibilityIdentifier("notifications.row.\(connection.id)")

                Toggle("Send notifications to \(connection.name)", isOn: Binding(
                    get: { connection.enabled },
                    set: { setEnabled($0) }
                ))
                .labelsHidden()
                .tint(palette.accentColor)
                .disabled(!isOnline || isSaving)
                .accessibilityIdentifier("notifications.row.\(connection.id).enabled")
            }
            .padding(.vertical, 13)
        }
        .contextMenu {
            if isKnown {
                Button("Edit", systemImage: "pencil", action: open)
            }
            Button("Delete", systemImage: "trash", role: .destructive, action: delete)
                .disabled(!isOnline)
        }
    }

    private var summary: some View {
        let delivery = NotificationsFlow.delivery(connection.lastDelivery)
        return VStack(alignment: .leading, spacing: 3) {
            Text(connection.name)
                .font(.ui(15.5))
                .foregroundStyle(connection.enabled ? palette.ink0Color : palette.ink2Color)
                .lineLimit(2)

            Text(NotificationsFlow.detail(connection))
                .font(.monoUI(11))
                .foregroundStyle(palette.ink3Color)
                .lineLimit(2)
                .truncationMode(.middle)

            HStack(spacing: 5) {
                Circle()
                    .fill(color(delivery.tone))
                    .frame(width: 6, height: 6)
                    .accessibilityHidden(true)
                Text(delivery.text)
                    .font(.ui(12, weight: .medium))
                    .foregroundStyle(color(delivery.tone))
            }
            .padding(.top, 2)

            // The server's own sentence, whole: cut short it stops mid-instruction.
            if let error = delivery.error {
                Text(error)
                    .font(.ui(12.5))
                    .foregroundStyle(palette.ink1Color)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("notifications.row.\(connection.id).error")
            }

            if let rowError {
                Text(rowError)
                    .font(.ui(12))
                    .foregroundStyle(palette.badColor)
            }
        }
    }

    private func color(_ tone: NotificationTone) -> Color {
        switch tone {
        case .ok: palette.okColor
        case .bad: palette.badColor
        case .quiet: palette.ink3Color
        }
    }
}

/// Opens the edit sheet on a tap a scroll can't set off; nothing for a row that can't be edited.
private struct OpensSheet: ViewModifier {
    let enabled: Bool
    let action: () -> Void

    func body(content: Content) -> some View {
        if enabled {
            content
                .tapRow(perform: action)
                .accessibilityHint("Opens its settings")
        } else {
            content.accessibilityElement(children: .combine)
        }
    }
}
