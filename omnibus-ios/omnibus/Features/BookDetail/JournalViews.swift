//  JournalViews.swift
//  Journal composer, the Markdown editor it shares with the review composer,
//  and the bookmarks sheet.

import SwiftUI

struct JournalComposer: View {
    let book: Book
    /// The entry being edited, or `nil` when writing a new one.
    var editing: JournalEntry?
    var onSaved: () -> Void

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState

    @State private var body_ = ""
    @State private var progress: Double = 0
    @State private var trackProgress = false
    @State private var isDraft = false
    @State private var isSaving = false
    @State private var didLoad = false
    @FocusState private var focused: Bool

    private var isEditing: Bool { editing != nil }

    var body: some View {
        NavigationStack {
            // The editor takes the whole sheet rather than a 180pt box with the
            // options stacked under it in a scroll view: this is the one screen
            // in the app for writing, and it should read as a page. The options
            // dock at the foot, where they stay reachable without competing
            // with the text.
            VStack(spacing: 0) {
                editor
                options
            }
            .background(ScreenBackground())
            .navigationTitle(isEditing ? "Edit entry" : "New entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isDraft ? "Save draft" : "Publish") { Task { await save() } }
                        .disabled(body_.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
        }
        .onAppear {
            // Seeded once: re-running on every appear would discard edits when
            // the keyboard or a sheet re-triggers it.
            if !didLoad {
                didLoad = true
                if let editing {
                    body_ = editing.bodyMd
                    isDraft = editing.status == .draft
                    if let existing = editing.progress {
                        progress = Double(existing)
                        trackProgress = true
                    }
                }
            }
            focused = true
        }
    }

    private var editor: some View {
        MarkdownEditorField(text: $body_, placeholder: "What did you think?")
            .focused($focused)
    }

    private var options: some View {
        VStack(spacing: 0) {
            Hairline()

            VStack(spacing: 0) {
                if trackProgress {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            RowLabel("Progress")
                            Spacer(minLength: 0)
                            Text("\(Int(progress))%")
                                .font(.monoUI(12))
                                .foregroundStyle(palette.accentColor)
                                .contentTransition(.numericText())
                        }
                        Slider(value: $progress, in: 0...100, step: 1)
                            .tint(palette.accentColor)
                    }
                    .padding(.horizontal, Spacing.screen)
                    .padding(.top, Spacing.md)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                }

                toggleRow("Record progress", isOn: $trackProgress.animation(Motion.settle))
                Hairline().padding(.leading, Spacing.screen)
                toggleRow("Save as draft", isOn: $isDraft)
            }
            .background(palette.bg1Color)
        }
    }

    private func toggleRow(_ label: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            Text(label)
                .font(.ui(14.5))
                .foregroundStyle(palette.ink1Color)
        }
        .tint(palette.accentColor)
        .padding(.horizontal, Spacing.screen)
        .padding(.vertical, 11)
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }

        let recorded = trackProgress ? Int(progress) : nil
        let status: JournalStatus = isDraft ? .draft : .published

        if let editing {
            await UserDataService.updateJournal(
                editing,
                payload: UpdateJournalEntry(bodyMd: body_, progress: recorded, status: status)
            )
        } else {
            await UserDataService.createJournal(
                CreateJournalEntry(
                    bookUUID: book.uuid,
                    bodyMd: body_,
                    progress: recorded,
                    status: status
                ),
                author: appState.user
            )
        }

        Haptics.success()
        onSaved()
        dismiss()
    }
}

/// The composers' writing surface, shared by journal entries and reviews: set
/// in the reading face the text will be rendered in, so what you type is what
/// you get rather than sans in, serif out, with a placeholder until the first
/// keystroke.
///
/// No `.lineSpacing` here, although the rendered text has some: on the editor
/// it is applied as a paragraph style the caret rect does not include, so every
/// scroll-to-caret lands a little short and the text view corrects it a frame
/// later — a bounce that grows by one line's spacing per line of text, until a
/// long entry jitters on every few letters. The bottom margin is what keeps the
/// caret line clear of whatever is docked under the editor.
struct MarkdownEditorField: View {
    @Binding var text: String
    let placeholder: String

    @Environment(\.palette) private var palette

    var body: some View {
        TextEditor(text: $text)
            .font(.display(19))
            .foregroundStyle(palette.ink0Color)
            .tint(palette.accentColor)
            .scrollContentBackground(.hidden)
            .contentMargins(.bottom, Spacing.lg, for: .scrollContent)
            .padding(.horizontal, Spacing.screen - 5)
            .padding(.top, Spacing.sm)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder)
                        .font(.display(19))
                        .foregroundStyle(palette.ink3Color)
                        .padding(.horizontal, Spacing.screen)
                        .padding(.top, Spacing.md)
                        .allowsHitTesting(false)
                }
            }
    }
}

// MARK: - Bookmarks

struct BookmarksSheet: View {
    let book: Book
    let isAudio: Bool

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(AudioPlayer.self) private var player

    @State private var bookmarks: [Bookmark] = []
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    LoadingView()
                } else if bookmarks.isEmpty {
                    EmptyStateView(
                        icon: "bookmark",
                        title: "No bookmarks",
                        message: "Bookmarks you save while reading or listening show up here."
                    )
                } else {
                    List {
                        ForEach(bookmarks) { bookmark in
                            Button {
                                open(bookmark)
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(bookmark.title?.nilIfBlank ?? positionLabel(bookmark))
                                        .font(.ui(15, weight: .medium))
                                        .foregroundStyle(palette.ink0Color)
                                    Text(Format.relative(unix: bookmark.createdAt))
                                        .font(.ui(11))
                                        .foregroundStyle(palette.ink3Color)
                                }
                            }
                            .listRowBackground(palette.bg1Color)
                        }
                        .onDelete { offsets in
                            let doomed = offsets.map { bookmarks[$0] }
                            Task {
                                for bookmark in doomed {
                                    await UserDataService.deleteBookmark(bookmark)
                                }
                                await load()
                            }
                        }
                    }
                    .scrollContentBackground(.hidden)
                    .background(palette.bg0Color)
                }
            }
            .background(ScreenBackground())
            .navigationTitle("Bookmarks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task { await load() }
    }

    private func load() async {
        for await items in UserDataService.bookmarks(uuid: book.uuid).values() {
            bookmarks = items
            isLoading = false
        }
        isLoading = false
    }

    private func positionLabel(_ bookmark: Bookmark) -> String {
        if isAudio, let seconds = Double(bookmark.position) {
            return Format.duration(seconds)
        }
        return "Saved position"
    }

    private func open(_ bookmark: Bookmark) {
        if isAudio, let seconds = Double(bookmark.position) {
            Task { await player.seek(to: seconds) }
        } else {
            ReaderBridge.shared.pendingCFI = bookmark.position
        }
        dismiss()
    }
}
