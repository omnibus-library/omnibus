//  NtfyConnectionSheet.swift
//  Adding or editing an ntfy connection: where it posts, how it signs in, what
//  its messages look like and which events it is sent, with a Test that sends
//  the form's current values and saves nothing. The fields match the web's.
//
//  A saved token or password is never shown: its field opens blank and says
//  it is saved, and left blank it is kept (`NtfyDraft` leaves the key out).

import SwiftUI

struct NtfyConnectionSheet: View {
    /// The saved connection being edited; nil for a new one.
    let connection: NotificationConnection?
    let screen: NotificationsModel

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var sheet: NtfySheetModel
    @State private var confirmDelete = false
    @State private var isDeleting = false
    @State private var deleteError: String?
    private var connectivity = Connectivity.shared

    init(draft: NtfyDraft, connection: NotificationConnection?, screen: NotificationsModel) {
        self.connection = connection
        self.screen = screen
        _sheet = State(initialValue: NtfySheetModel(draft: draft, api: screen.api))
    }

    private var isOnline: Bool { connectivity.isOnline }

    var body: some View {
        @Bindable var sheet = sheet

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    basics($sheet.draft)
                    signIn($sheet.draft)
                    message($sheet.draft)
                    events($sheet.draft)
                    testSection
                    if let connection { lastDelivery(connection) }
                    footer
                }
                .screenPadding()
                .padding(.top, Spacing.md)
                .padding(.bottom, 48)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .background(ScreenBackground())
            .navigationTitle(connection == nil ? "New ntfy connection" : "Edit connection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .accessibilityIdentifier("ntfy.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    if sheet.isSaving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .disabled(!sheet.canSave || !isOnline || isDeleting)
                            .accessibilityIdentifier("ntfy.save")
                    }
                }
            }
        }
        .tint(palette.accentColor)
        // Unsaved typing goes only by Cancel, never by a stray swipe.
        .interactiveDismissDisabled(sheet.isDirty)
    }

    // MARK: - Sections

    private func basics(_ draft: Binding<NtfyDraft>) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Plate {
                PlateField(
                    label: "Name", text: draft.name, isFirst: true,
                    identifier: "ntfy.name", placeholder: "Requests to my phone",
                    capitalization: .sentences
                )
                PlateField(
                    label: "Server URL", text: draft.serverURL, keyboard: .URL,
                    identifier: "ntfy.serverURL", placeholder: "https://ntfy.sh",
                    capitalization: .never
                )
                PlateField(
                    label: "Topic", text: draft.topic, keyboard: .asciiCapable,
                    identifier: "ntfy.topic", placeholder: "omnibus-requests",
                    capitalization: .never
                )
            }
            caption("The topic is what a phone subscribes to in the ntfy app: letters, digits, - and _. On a public server anyone who knows it can read it.")
        }
    }

    private func signIn(_ draft: Binding<NtfyDraft>) -> some View {
        group("Sign-in") {
            Plate {
                ForEach(Array(NtfyAuth.allCases.enumerated()), id: \.element) { index, mode in
                    authRow(mode, isFirst: index == 0, selection: draft.auth)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("ntfy.auth")

            switch draft.wrappedValue.auth {
            case .none:
                EmptyView()
            case .token:
                Plate {
                    secretField("Access token", text: draft.token, isSaved: draft.wrappedValue.keepsSavedToken, identifier: "ntfy.token", isFirst: true)
                }
                if draft.wrappedValue.keepsSavedToken { secretCaption("token") }
            case .basic:
                Plate {
                    PlateField(
                        label: "Username", text: draft.username, isFirst: true,
                        identifier: "ntfy.username", capitalization: .never
                    )
                    secretField("Password", text: draft.password, isSaved: draft.wrappedValue.keepsSavedPassword, identifier: "ntfy.password")
                }
                if draft.wrappedValue.keepsSavedPassword { secretCaption("password") }
            }
        }
    }

    private func authRow(_ mode: NtfyAuth, isFirst: Bool, selection: Binding<NtfyAuth>) -> some View {
        let isOn = selection.wrappedValue == mode
        return VStack(spacing: 0) {
            if !isFirst { Hairline() }
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Self.authTitle(mode))
                        .font(.ui(14, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                    Text(Self.authDetail(mode))
                        .font(.ui(12))
                        .foregroundStyle(palette.ink3Color)
                }
                Spacer(minLength: Spacing.sm)
                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 18))
                    .foregroundStyle(isOn ? palette.accentColor : palette.ink3Color)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .tapRow {
                guard !isOn else { return }
                Haptics.select()
                withAnimation(Motion.snap) { selection.wrappedValue = mode }
            }
            .accessibilityAddTraits(isOn ? .isSelected : [])
            .accessibilityIdentifier("ntfy.auth.\(mode.rawValue)")
        }
    }

    private func secretField(
        _ label: String, text: Binding<String>, isSaved: Bool, identifier: String, isFirst: Bool = false
    ) -> some View {
        PlateField(
            label: label, text: text, isFirst: isFirst,
            identifier: identifier,
            placeholder: isSaved ? "Saved \u{2014} leave blank to keep" : "",
            capitalization: .never,
            isSecure: true
        )
    }

    private func secretCaption(_ noun: String) -> some View {
        caption("The saved \(noun) is never shown. Leave it blank to keep it, or type a new one to replace it.")
    }

    private func message(_ draft: Binding<NtfyDraft>) -> some View {
        group("Message") {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                RowLabel("Priority")
                PillSelector(
                    options: NotificationsFlow.priorities,
                    label: NotificationsFlow.priorityName,
                    selection: draft.priority
                )
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("ntfy.priority")
            }

            Plate {
                PlateField(
                    label: "Tags", text: draft.tags, isFirst: true, hint: "Comma-separated",
                    identifier: "ntfy.tags", placeholder: "books, bell",
                    capitalization: .never
                )
                toggleRow(
                    "Include book and requester details",
                    detail: "Off, a message says only that something needs attention \u{2014} for a topic others can read.",
                    isOn: draft.includeDetails, identifier: "ntfy.includeDetails"
                )
            }
            caption("A tag that names an emoji, such as bell or books, shows as that emoji.")
        }
    }

    @ViewBuilder
    private func events(_ draft: Binding<NtfyDraft>) -> some View {
        let choices = draft.wrappedValue.eventChoices(available: screen.availableEvents)
        group("Send when") {
            if choices.isEmpty {
                caption("Nothing to send yet. Request events appear here once book requests are turned on.")
                    .accessibilityIdentifier("ntfy.noEvents")
            } else {
                Plate {
                    ForEach(Array(choices.enumerated()), id: \.element) { index, event in
                        toggleRow(
                            NotificationsFlow.eventLabel(event),
                            detail: screen.availableEvents.contains(event)
                                ? Self.eventDetail(event)
                                : "Not sent while this server doesn\u{2019}t offer it.",
                            isOn: Binding(
                                get: { draft.wrappedValue.events.contains(event) },
                                set: { draft.wrappedValue.setEvent(event, on: $0) }
                            ),
                            identifier: "ntfy.event.\(event.rawValue)",
                            isFirst: index == 0
                        )
                    }
                }
            }

            Plate {
                toggleRow(
                    "Turned on",
                    detail: draft.wrappedValue.enabled
                        ? "Sends as these things happen."
                        : "Sends nothing until it is turned back on.",
                    isOn: draft.enabled, identifier: "ntfy.enabled", isFirst: true
                )
            }
        }
    }

    private var testSection: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Button {
                Haptics.tap()
                Task { await sheet.test() }
            } label: {
                HStack(spacing: Spacing.sm) {
                    if sheet.testState == .sending {
                        ProgressView().tint(palette.ink1Color)
                    }
                    Text(sheet.testState == .sending ? "Sending\u{2026}" : "Send a test")
                }
            }
            .buttonStyle(FilledButtonStyle(prominent: false))
            .disabled(!sheet.canTest || !isOnline)
            .accessibilityIdentifier("ntfy.test")

            caption("Sends a sample with what this form says now. Nothing is saved.")

            testResult
        }
    }

    @ViewBuilder
    private var testResult: some View {
        switch sheet.testState {
        case .idle, .sending:
            EmptyView()
        case .sent:
            Label("Test notification sent", systemImage: "checkmark.circle.fill")
                .font(.ui(13))
                .foregroundStyle(palette.okColor)
                .accessibilityIdentifier("ntfy.testResult")
        case let .failed(message):
            VStack(alignment: .leading, spacing: 3) {
                Label("Couldn\u{2019}t send the test", systemImage: "exclamationmark.triangle.fill")
                    .font(.ui(13, weight: .semibold))
                    .foregroundStyle(palette.badColor)
                Text(message)
                    .font(.ui(12.5))
                    .foregroundStyle(palette.ink1Color)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("ntfy.testResult")
        }
    }

    /// The whole of the last delivery, where a row's two lines cut it short.
    private func lastDelivery(_ connection: NotificationConnection) -> some View {
        let delivery = NotificationsFlow.delivery(connection.lastDelivery)
        return group("Last delivery") {
            VStack(alignment: .leading, spacing: 3) {
                Text(delivery.text)
                    .font(.ui(13.5, weight: .medium))
                    .foregroundStyle(tone(delivery.tone))
                if let error = delivery.error {
                    Text(error)
                        .font(.ui(12.5))
                        .foregroundStyle(palette.ink1Color)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                caption("A test doesn\u{2019}t count; only a real notification does.")
                    .padding(.top, 2)
            }
            .accessibilityIdentifier("ntfy.lastDelivery")
        }
    }

    @ViewBuilder
    private var footer: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if let issue = sheet.draft.saveIssue {
                Text(issue)
                    .font(.ui(12.5))
                    .foregroundStyle(palette.ink3Color)
                    .accessibilityIdentifier("ntfy.issue")
            }
            if let error = sheet.saveError {
                Text(error)
                    .font(.ui(13))
                    .foregroundStyle(palette.badColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("ntfy.saveError")
            }
            if !isOnline {
                Text("You\u{2019}re offline. Connections are saved on the server, so this can wait.")
                    .font(.ui(13))
                    .foregroundStyle(palette.ink3Color)
            }
            if connection != nil { deleteButton }
        }
    }

    private var deleteButton: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Button(role: .destructive) {
                confirmDelete = true
            } label: {
                Label(isDeleting ? "Deleting\u{2026}" : "Delete connection", systemImage: "trash")
                    .font(.ui(14, weight: .medium))
                    .foregroundStyle(palette.badColor)
            }
            .buttonStyle(.plain)
            .disabled(!isOnline || isDeleting || sheet.isSaving)
            .accessibilityIdentifier("ntfy.delete")

            if let deleteError {
                Text(deleteError)
                    .font(.ui(12.5))
                    .foregroundStyle(palette.badColor)
            }
        }
        .padding(.top, Spacing.sm)
        .confirmationDialog(
            "Delete \(connection?.name ?? "this connection")?",
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button("Delete connection", role: .destructive) { Task { await delete() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The server stops sending to it. Nothing changes on the ntfy server.")
        }
        // The dialog's answers read in ink; the accent is too faint on a light ground.
        .tint(palette.ink0Color)
    }

    // MARK: - Pieces

    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionLabel(title)
            content()
        }
    }

    private func caption(_ text: String) -> some View {
        Text(text)
            .font(.ui(12))
            .foregroundStyle(palette.ink3Color)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func toggleRow(
        _ label: String, detail: String, isOn: Binding<Bool>, identifier: String, isFirst: Bool = false
    ) -> some View {
        PlateRow(
            label: label, isFirst: isFirst,
            detail: Text(detail).font(.ui(12)).foregroundStyle(palette.ink3Color)
        ) {
            Toggle(label, isOn: isOn)
                .labelsHidden()
                .tint(palette.accentColor)
                .accessibilityIdentifier(identifier)
        }
    }

    private func tone(_ tone: NotificationTone) -> Color {
        switch tone {
        case .ok: palette.okColor
        case .bad: palette.badColor
        case .quiet: palette.ink3Color
        }
    }

    static func authTitle(_ mode: NtfyAuth) -> String {
        switch mode {
        case .none: "None"
        case .token: "Access token"
        case .basic: "Username & password"
        }
    }

    static func authDetail(_ mode: NtfyAuth) -> String {
        switch mode {
        case .none: "For a topic anyone may post to."
        case .token: "An ntfy access token, sent as a bearer token."
        case .basic: "An ntfy account\u{2019}s sign-in."
        }
    }

    static func eventDetail(_ event: NotificationEventName) -> String {
        switch event {
        case .requestNeedsChooser: "A search found versions, and the reader who asked can\u{2019}t pick one."
        default: "Sent when the server reports it."
        }
    }

    // MARK: - Writes

    private func save() async {
        if let saved = await sheet.save() {
            screen.upsert(saved)
            Haptics.success()
            dismiss()
        } else {
            Haptics.warning()
        }
    }

    private func delete() async {
        guard let connection else { return }
        isDeleting = true
        defer { isDeleting = false }
        if let error = await screen.delete(id: connection.id) {
            deleteError = error
            Haptics.warning()
        } else {
            Haptics.success()
            dismiss()
        }
    }
}
