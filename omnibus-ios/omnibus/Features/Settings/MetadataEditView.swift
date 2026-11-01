//  MetadataEditView.swift
//  The metadata editor: one sheet with three tabs, a fetch view it can turn
//  into, and one footer that says how many changes are waiting.
//
//  Nothing writes until Save. That includes the cover, which sits in
//  `StagedCover` beside the draft, so "N unsaved changes" and Discard mean the
//  same for every thing on the sheet. Metadata is library-wide configuration
//  (rule 08), so a save calls straight through and reports failure here; it is
//  never queued.

import PhotosUI
import SwiftUI

/// The sheet's three tabs.
enum MetadataEditTab: String, CaseIterable, Identifiable {
    case details = "Details"
    case artwork = "Artwork"
    case identifiers = "Identifiers"

    var id: String { rawValue }
}

struct MetadataEditView: View {
    let uuid: String
    /// Runs with the line to report once a save or revert has landed and the
    /// sheet is gone, so the surface behind it can refresh.
    var onSaved: ((String) -> Void)?

    init(uuid: String, onSaved: ((String) -> Void)? = nil) {
        self.uuid = uuid
        self.onSaved = onSaved
    }

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var book: Book?
    @State private var draft = MetadataDraft()
    @State private var loaded = MetadataDraft()
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var error: String?
    @State private var tab = MetadataEditTab.details
    /// The search is a turn of this sheet, not a sheet on top of it.
    @State private var showFetch = false

    /// Text in a chip's entry field but not yet committed. Held here so a save
    /// can flush it.
    @State private var pendingAuthor = ""
    @State private var pendingTag = ""
    @State private var pendingGenre = ""

    @State private var stagedCover: StagedCover?
    @State private var coverPhotoItem: PhotosPickerItem?
    @State private var coverURLText = ""
    /// Turns the header cover over when an applied edition brought new art.
    @State private var coverFlips = 0

    /// Empty leaves the fetch button out: offering a search that could only
    /// fail is worse than not offering one.
    @State private var providers: [ProviderInfo] = []

    /// Autocomplete pools, filled best-effort; empty just means no dropdown.
    @State private var authorPool: [SuggestionItem] = []
    @State private var tagPool: [SuggestionItem] = []
    @State private var genrePool: [SuggestionItem] = []
    @State private var seriesPool: [SuggestionItem] = []

    @State private var confirmLeave = false
    @State private var confirmRevert = false
    /// The line owed to `onSaved`, set the moment a write lands. Reported on
    /// the way out rather than on the spot, so fields that saved ahead of a
    /// cover that failed still refresh the page however the sheet closes.
    @State private var landed: String?

    private var pendingDraft: MetadataDraft {
        draft.committingPending(author: pendingAuthor, tag: pendingTag, genre: pendingGenre)
    }

    private var detailEdits: Int { pendingDraft.editedCount(since: loaded) }

    private var hasCoverEdit: Bool { stagedCover != nil || coverURLText.nilIfBlank != nil }

    private var changeCount: Int { detailEdits + (hasCoverEdit ? 1 : 0) }

    var body: some View {
        Group {
            if isLoading {
                LoadingView()
            } else if let book {
                if showFetch {
                    MetadataFetchView(
                        book: book,
                        draft: $draft,
                        staged: $stagedCover,
                        onApplied: applied,
                        onBack: { withAnimation(Motion.settle) { showFetch = false } }
                    )
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                } else {
                    editor(book)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                }
            } else {
                ErrorStateView(message: error ?? "This book couldn\u{2019}t be loaded.") {
                    Task { await load() }
                }
            }
        }
        .bookSheet([.large])
        .interactiveDismissDisabled(changeCount > 0 || isSaving)
        .task { await load() }
        .task { await loadSuggestionPools() }
        .task { await loadProviders() }
        .onChange(of: coverPhotoItem) { _, item in
            Task { await stagePhoto(item) }
        }
        .onChange(of: tab) { _, _ in stagePastedCover() }
        .onDisappear {
            if let landed { onSaved?(landed) }
        }
    }

    // MARK: - The editor

    private func editor(_ book: Book) -> some View {
        VStack(spacing: 0) {
            header(book)
            if !providers.isEmpty { fetchButton }
            tabStrip

            ScrollView {
                Group {
                    switch tab {
                    case .details: detailsTab(book)
                    case .artwork: artworkTab(book)
                    case .identifiers: identifiersTab(book)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 18)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)

            footer
        }
        .padding(.top, 12)
        .confirmationDialog(
            MetadataEditCopy.leaveTitle(count: changeCount),
            isPresented: $confirmLeave,
            titleVisibility: .visible
        ) {
            Button("Save") { Task { await save() } }
            Button("Don\u{2019}t save", role: .destructive) { dismiss() }
            // No cancel role: the system would fold it away into a tap outside,
            // and this is the answer that keeps the work.
            Button("Keep editing") {}
        }
        .confirmationDialog(
            "Revert to scanned values?", isPresented: $confirmRevert, titleVisibility: .visible
        ) {
            Button("Revert", role: .destructive) { Task { await revert() } }
            Button("Cancel") {}
        } message: {
            Text(
                "Every edit to this book, its cover included, is dropped and the values read from its files come back. This can\u{2019}t be undone."
            )
        }
        // The dialogs' answers read in ink; the book's tone is too faint on a light ground.
        .tint(palette.ink0Color)
    }

    private func header(_ book: Book) -> some View {
        HStack(spacing: 12) {
            EditCoverArt(book: book, staged: stagedCover, size: .sm)
                .frame(width: 46, height: 68)
                .clipShape(UnevenRoundedRectangle(
                    topLeadingRadius: 2, bottomLeadingRadius: 2, bottomTrailingRadius: 3, topTrailingRadius: 3
                ))
                .keyframeAnimator(initialValue: 8.0, trigger: coverFlips) { view, angle in
                    view.rotation3DEffect(
                        .degrees(reduceMotion ? 8 : angle), axis: (x: 0, y: 1, z: 0), perspective: 0.3
                    )
                } keyframes: { _ in
                    KeyframeTrack {
                        MoveKeyframe(180)
                        CubicKeyframe(8, duration: 0.72)
                    }
                }
                .rotationEffect(.degrees(-2.5))
                .shadow(color: .black.opacity(0.5), radius: 7, x: 4, y: 6)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(draft.title.nilIfBlank ?? book.displayTitle)
                    .font(.display(23, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(2)
                Text(pendingDraft.authors.first ?? "No author")
                    .font(.ui(14))
                    .foregroundStyle(palette.ink1Color)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button(action: requestClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .disabled(isSaving)
            .accessibilityLabel("Close")
            .accessibilityIdentifier("metadata-close")
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .padding(.vertical, 8)
    }

    /// Sits above the fields because it is the fastest route through the sheet:
    /// someone fixing a badly-scanned book should find it before they type.
    private var fetchButton: some View {
        Button {
            Haptics.tap()
            stagePastedCover()
            withAnimation(Motion.settle) { showFetch = true }
        } label: {
            HStack(spacing: 11) {
                Image(systemName: "sparkles")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(palette.bookText)

                VStack(alignment: .leading, spacing: 0) {
                    Text("Fetch metadata")
                        .font(.ui(16, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                    Text(MetadataEditCopy.providersLine(providers))
                        .font(.ui(13))
                        .foregroundStyle(palette.ink1Color)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
            }
            .padding(.leading, 14)
            .padding(.trailing, 12)
            .padding(.vertical, 7)
            .frame(minHeight: 56)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(palette.bookWash))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(palette.bookRim, lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
        .accessibilityIdentifier("metadata-fetch-open")
    }

    private var tabStrip: some View {
        HStack(spacing: 0) {
            ForEach(MetadataEditTab.allCases) { option in
                Button {
                    guard tab != option else { return }
                    Haptics.select()
                    tab = option
                } label: {
                    HStack(spacing: 6) {
                        Text(option.rawValue)
                            .font(.ui(15, weight: tab == option ? .semibold : .medium))
                            .foregroundStyle(tab == option ? palette.ink0Color : palette.ink1Color)
                        if hasEdits(option) {
                            Circle()
                                .fill(palette.bookText)
                                .frame(width: 6, height: 6)
                                .accessibilityLabel("has edits")
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 46)
                    .overlay(alignment: .bottom) {
                        if tab == option {
                            Rectangle().fill(palette.bookText).frame(height: 2)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(tab == option ? .isSelected : [])
                .accessibilityIdentifier("metadata-tab-\(option.rawValue.lowercased())")
            }
        }
        .padding(.horizontal, 16)
        .overlay(alignment: .bottom) {
            Rectangle().fill(palette.ink0Color.opacity(0.12)).frame(height: 1)
        }
    }

    private func hasEdits(_ option: MetadataEditTab) -> Bool {
        switch option {
        case .details: detailEdits > 0
        case .artwork: hasCoverEdit
        case .identifiers: false
        }
    }

    // MARK: - Details

    private func detailsTab(_ book: Book) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            field("Title", \.title, hint: "Title", capitalization: .words, identifier: "title")
            EditChipField(
                label: "Authors",
                hint: "Primary author first",
                values: $draft.authors,
                entry: $pendingAuthor,
                isEdited: draft.authors != loaded.authors,
                suggestions: authorPool,
                identifier: "metadata-field-authors"
            )
            SpanRow(spans: [4, 2]) {
                field(
                    "Series", \.series, hint: "None", capitalization: .words,
                    suggestions: seriesPool, identifier: "series"
                )
                field("Number", \.seriesIndex, hint: "None", keyboard: .decimalPad, identifier: "number")
            }
            field("Publisher", \.publisher, hint: "None", capitalization: .words, identifier: "publisher")
            SpanRow(spans: [3, 3]) {
                field("Published", \.published, hint: "Year", identifier: "published")
                field("Language", \.language, hint: "en", identifier: "language")
            }
            SpanRow(spans: [2, 4]) {
                field("Print pages", \.printPages, hint: "0", keyboard: .numberPad, identifier: "pages")
                field("ISBN-13", \.isbn13, hint: "13 digits", keyboard: .numberPad, identifier: "isbn13")
            }
            // Not `.numberPad`: an ISBN-10's check digit can be X.
            field("ISBN-10", \.isbn10, hint: "10 characters", keyboard: .asciiCapable, identifier: "isbn10")
            EditParagraphField(
                label: "Description",
                text: $draft.description,
                hint: "Plain text or HTML",
                isEdited: draft.description != loaded.description,
                identifier: "metadata-field-description"
            )
            EditChipField(
                label: "Tags",
                hint: "Add a tag",
                values: $draft.tags,
                entry: $pendingTag,
                isEdited: draft.tags != loaded.tags,
                deduplicates: true,
                suggestions: tagPool,
                identifier: "metadata-field-tags"
            )
            EditChipField(
                label: "Genres",
                hint: "Add a genre",
                values: $draft.genres,
                entry: $pendingGenre,
                isEdited: draft.genres != loaded.genres,
                deduplicates: true,
                suggestions: genrePool,
                identifier: "metadata-field-genres"
            )

            VStack(alignment: .leading, spacing: 12) {
                if book.hasOverride || book.hasCoverOverride {
                    Button("Revert to scanned values") {
                        Haptics.warning()
                        confirmRevert = true
                    }
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(palette.dangerText)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("metadata-revert")
                }
                Text("Omnibus never writes to your book files. Your edits are saved in the Omnibus library database.")
                    .font(.ui(13))
                    .foregroundStyle(palette.ink1Color)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func field(
        _ label: String,
        _ key: WritableKeyPath<MetadataDraft, String>,
        hint: String,
        keyboard: UIKeyboardType = .default,
        capitalization: TextInputAutocapitalization = .never,
        suggestions: [SuggestionItem] = [],
        identifier: String
    ) -> some View {
        EditTextField(
            label: label,
            text: Binding(
                get: { draft[keyPath: key] },
                set: { draft[keyPath: key] = $0 }
            ),
            hint: hint,
            isEdited: draft[keyPath: key] != loaded[keyPath: key],
            keyboard: keyboard,
            capitalization: capitalization,
            suggestions: suggestions,
            identifier: "metadata-field-\(identifier)"
        )
    }

    // MARK: - Artwork

    private func artworkTab(_ book: Book) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(spacing: 20) {
                EditCoverArt(book: book, staged: stagedCover, size: .lg)
                    .frame(width: 158, height: 234)
                    .clipShape(UnevenRoundedRectangle(
                        topLeadingRadius: 3, bottomLeadingRadius: 3, bottomTrailingRadius: 5, topTrailingRadius: 5
                    ))
                    .rotation3DEffect(.degrees(8), axis: (x: 0, y: 1, z: 0), perspective: 0.2)
                    .rotationEffect(.degrees(-2.5))
                    .shadow(color: .black.opacity(0.55), radius: 20, x: 14, y: 20)
                    .accessibilityLabel("Cover as it will read")

                Text(MetadataEditCopy.coverHint(staged: stagedCover, book: book))
                    .font(.ui(14))
                    .foregroundStyle(palette.ink1Color)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("metadata-cover-hint")
            }
            .frame(maxWidth: .infinity)

            PhotosPicker(selection: $coverPhotoItem, matching: .images) {
                Text("Choose a photo")
                    .font(.ui(16, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(Capsule().fill(palette.quietFill))
            }
            .buttonStyle(PressableStyle())
            .padding(.top, 16)
            .accessibilityIdentifier("metadata-cover-photo")

            Text("Or paste an image URL")
                .font(.ui(14, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .padding(.top, 16)
                .padding(.bottom, 5)

            TextField(
                "", text: $coverURLText,
                prompt: Text("https://\u{2026}").foregroundStyle(palette.ink1Color.opacity(0.7))
            )
            .font(.ui(16))
            .foregroundStyle(palette.ink0Color)
            .tint(palette.bookText)
            .keyboardType(.URL)
            .textContentType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.done)
            .onSubmit { stagePastedCover() }
            .padding(.horizontal, 12)
            .frame(height: 46)
            .editInputBox()
            .accessibilityLabel("Image URL")
            .accessibilityIdentifier("metadata-cover-url")

            // Not in a menu of its own: dropping a replacement is the one thing
            // this tab has to offer once there is one, and it stages like the rest.
            if book.hasCoverOverride, stagedCover != .scanned {
                Button("Use the file\u{2019}s own cover") {
                    Haptics.tap()
                    coverURLText = ""
                    stagedCover = .scanned
                }
                .font(.ui(15, weight: .semibold))
                .foregroundStyle(palette.bookText)
                .frame(minHeight: 44)
                .padding(.top, 8)
                .accessibilityIdentifier("metadata-cover-scanned")
            }
        }
    }

    /// Stage what sits in the URL box. Blank clears nothing: a box left empty
    /// has no opinion about a photo already chosen.
    private func stagePastedCover() {
        guard let text = coverURLText.nilIfBlank else { return }
        guard let cover = StagedCover.pasted(text) else {
            error = "That doesn\u{2019}t look like an image URL. It should start with https://."
            return
        }
        error = nil
        stagedCover = cover
        coverURLText = ""
    }

    /// Read and re-encode the picked photo now, so a bad one is said at once
    /// rather than at Save.
    private func stagePhoto(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        // Cleared so picking the same photo again re-fires the selection.
        defer { coverPhotoItem = nil }
        guard let raw = try? await item.loadTransferable(type: Data.self),
            let image = UIImage(data: raw)
        else {
            error = "That image couldn\u{2019}t be read."
            Haptics.warning()
            return
        }
        // 1600px long edge: covers render at most a phone screen tall, and
        // the server regenerates every thumb from what lands here — while a
        // camera-roll original could blow the route's 10 MiB cap.
        guard let encoded = UploadImageEncoder.jpeg(image, maxDimension: 1600) else {
            error = "That image couldn\u{2019}t be prepared for upload."
            Haptics.warning()
            return
        }
        error = nil
        coverURLText = ""
        stagedCover = .photo(encoded)
    }

    // MARK: - Identifiers

    private func identifiersTab(_ book: Book) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(book.identifiers.isEmpty
                ? "The file carries no identifiers."
                : "As the file carries them. Read only.")
                .font(.ui(14))
                .foregroundStyle(palette.ink1Color)

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(book.identifiers.enumerated()), id: \.offset) { _, identifier in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(MetadataEditCopy.scheme(identifier))
                            .font(.ui(14))
                            .foregroundStyle(palette.ink1Color)
                        Text(identifier.value)
                            .font(.ui(16))
                            .foregroundStyle(palette.ink0Color)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 11)
                    .overlay(alignment: .top) {
                        Rectangle().fill(palette.ink0Color.opacity(0.12)).frame(height: 1)
                    }
                }
            }
        }
    }

    // MARK: - Footer

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error {
                Text(error)
                    .font(.ui(14))
                    .foregroundStyle(palette.dangerText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("metadata-error")
            }

            HStack(spacing: 8) {
                Text(MetadataEditCopy.summary(count: changeCount))
                    .font(.ui(14, weight: changeCount > 0 ? .semibold : .regular))
                    .foregroundStyle(changeCount > 0 ? palette.ink0Color : palette.ink1Color)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("metadata-status")

                if changeCount > 0 {
                    Button("Discard", action: discard)
                        .font(.ui(15, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                        .frame(minHeight: 44)
                        .padding(.horizontal, 6)
                        .disabled(isSaving)
                        .accessibilityIdentifier("metadata-discard")
                }

                Button {
                    if changeCount == 0 {
                        dismiss()
                    } else {
                        Task { await save() }
                    }
                } label: {
                    Text(isSaving ? "Saving\u{2026}" : changeCount > 0 ? "Save" : "Done")
                        .font(.ui(16, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 20)
                        .frame(minWidth: 84)
                        .frame(height: 46)
                        .background(Capsule().fill(palette.bookDeep))
                }
                .buttonStyle(PressableStyle())
                .disabled(isSaving)
                .accessibilityIdentifier("metadata-save")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background {
            palette.bg2Color.opacity(0.45)
                .overlay(alignment: .top) {
                    Rectangle().fill(palette.ink0Color.opacity(0.12)).frame(height: 1)
                }
                .ignoresSafeArea(edges: .bottom)
        }
    }

    private func requestClose() {
        if changeCount > 0 {
            confirmLeave = true
        } else {
            dismiss()
        }
    }

    private func discard() {
        Haptics.tap()
        draft = loaded
        pendingAuthor = ""
        pendingTag = ""
        pendingGenre = ""
        stagedCover = nil
        coverURLText = ""
        error = nil
    }

    /// An applied edition lands on the tab that shows what it changed, and new
    /// art turns the header's cover over.
    private func applied(_ rows: [MetadataDiffRow]) {
        let brought = rows.contains { row in
            if case .cover = row.kind { return true }
            return false
        }
        if brought, rows.count == 1 { tab = .artwork } else { tab = .details }
        withAnimation(Motion.settle) { showFetch = false }
        guard brought else { return }
        // After the editor is back, or the turn plays on a view not yet drawn.
        Task {
            try? await Task.sleep(for: .milliseconds(40))
            coverFlips += 1
        }
    }

    // MARK: - Data

    private func load() async {
        isLoading = true
        error = nil
        do {
            let fetched = try await LibraryService.settledBook(uuid: uuid)
            book = fetched
            loaded = MetadataDraft(book: fetched)
            draft = loaded
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }

    private func loadProviders() async {
        let catalog: [ProviderInfo] = (try? await APIClient.shared.get("/api/metadata/providers")) ?? []
        providers = catalog.filter(\.configured)
    }

    /// Mirrors the web editor's `use_suggestion_pools`. Each pool streams
    /// replica-first, so a cached listing paints suggestions immediately and
    /// the server's answer refines them.
    private func loadSuggestionPools() async {
        async let authors: Void = collectAuthorPool()
        async let tags: Void = collectTagPool()
        async let genres: Void = collectGenrePool()
        async let series: Void = collectSeriesPool()
        _ = await (authors, tags, genres, series)
    }

    private func collectAuthorPool() async {
        for await authors in LibraryService.authors().values() {
            authorPool = SuggestionPool.collect(
                authors.map { SuggestionItem(name: $0.name, count: $0.bookCount) }
            )
        }
    }

    private func collectTagPool() async {
        for await tags in LibraryService.tags().values() {
            tagPool = SuggestionPool.collect(
                tags.map { SuggestionItem(name: $0.name, count: $0.count) }
            )
        }
    }

    private func collectGenrePool() async {
        for await genres in LibraryService.genres().values() {
            genrePool = SuggestionPool.collect(
                genres.map { SuggestionItem(name: $0.name, count: $0.count) }
            )
        }
    }

    private func collectSeriesPool() async {
        for await series in LibraryService.series().values() {
            seriesPool = SuggestionPool.collect(
                series.map { SuggestionItem(name: $0.name, count: $0.bookCount) }
            )
        }
    }

    private func save() async {
        guard !isSaving else { return }
        error = nil
        stagePastedCover()
        // A URL the box refuses stays in the box, with the reason in the footer.
        guard error == nil else {
            tab = .artwork
            Haptics.warning()
            return
        }

        // Before the chip flush below, which mutates `draft`: a rejected save
        // has to leave the form exactly as the reader left it, or a bad page
        // count silently consumes the author they were half-way through typing.
        do {
            try draft.validate(since: loaded)
        } catch {
            tab = .details
            report(error)
            return
        }

        isSaving = true
        defer { isSaving = false }
        flushPendingChips()

        let edits = draft.editedCount(since: loaded)
        let body = draft.payload(since: loaded)
        let title = draft.title.nilIfBlank ?? book?.displayTitle ?? ""
        var written = 0

        do {
            // Skipped when empty, not merely to save a trip: an empty body makes
            // the server insert an override row that latches the book to "Edited"
            // for good. See `MetadataOverridesPayload.isEmpty`.
            if !body.isEmpty {
                let _: Empty = try await APIClient.shared.post(
                    "/api/ebooks/\(uuid)/overrides", body: body
                )
                await OfflineStore.shared.cacheDelete(CacheKey.book(uuid))
                written = edits
                // So a cover that fails below leaves only itself unsaved.
                loaded = draft
                landed = MetadataEditCopy.savedToast(count: written, title: title)
            }
            if let stagedCover {
                book = try await write(stagedCover)
                self.stagedCover = nil
                written += 1
                landed = MetadataEditCopy.savedToast(count: written, title: title)
            }
            Haptics.success()
            dismiss()
        } catch {
            report(error)
        }
    }

    private func write(_ cover: StagedCover) async throws -> Book {
        switch cover {
        case let .url(url): try await LibraryService.applyCoverFromURL(uuid: uuid, url: url)
        case let .photo(data): try await LibraryService.uploadCover(uuid: uuid, jpegData: data)
        case .scanned: try await LibraryService.revertCover(uuid: uuid)
        }
    }

    private func report(_ error: Error) {
        self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        Haptics.warning()
    }

    /// A value typed into an entry field but never committed is still what the
    /// reader meant to save.
    private func flushPendingChips() {
        draft = pendingDraft
        pendingAuthor = ""
        pendingTag = ""
        pendingGenre = ""
    }

    private func revert() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await LibraryService.revertOverrides(uuid: uuid)
            Haptics.success()
            landed = "Reverted to scanned values"
            dismiss()
        } catch {
            report(error)
        }
    }
}

/// The cover as a save would leave it: a staged replacement if there is one,
/// else the book's own art or generated plate.
struct EditCoverArt: View {
    let book: Book
    let staged: StagedCover?
    var size: ThumbSize = .sm

    var body: some View {
        switch staged {
        case let .url(url):
            ExternalImage(url: url) { plate }
        case let .photo(data):
            if let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                plate
            }
        case .scanned:
            plate
        case nil:
            BookCover(identity: CoverIdentity(book), size: size, cornerRadius: 0)
        }
    }

    private var plate: some View {
        GeneratedCoverPlate(identity: CoverIdentity(book))
    }
}
