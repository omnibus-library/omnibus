//  BookSheets.swift
//  What the book page's More menu opens: the shared sheet chrome, Bookmarks and
//  Export. Shelves, merge and delete keep their own files.

import SwiftUI

// MARK: - Chrome

/// The title and the way out that every one of the page's sheets opens with.
struct BookSheetHeader: View {
    let title: String
    var closes = true
    var onClose: () -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
            Text(title)
                .font(.display(28, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .disabled(!closes)
            .opacity(closes ? 1 : 0.4)
            .accessibilityLabel("Close")
            .accessibilityIdentifier("book-sheet-close")
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .padding(.top, 15)
        .padding(.bottom, 2)
    }
}

extension View {
    /// The page's sheet: rounded and grounded the same, at the detents given.
    func bookSheet(_ detents: Set<PresentationDetent>) -> some View {
        modifier(BookSheetFrame(detents: detents))
    }
}

private struct BookSheetFrame: ViewModifier {
    let detents: Set<PresentationDetent>

    @Environment(\.palette) private var palette

    func body(content: Content) -> some View {
        content
            .presentationDetents(detents)
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(Radius.xl)
            .presentationBackground(palette.bg1Color)
    }
}

extension Palette {
    /// The ground of a button that deletes something.
    var dangerFill: Color { OKLCH(0.47, 0.15, 28).color }
    /// Text and icons that warn of the same.
    var dangerText: Color { bg0.l > 0.5 ? badColor : OKLCH(0.76, 0.13, 28).color }
}

// MARK: - The More menu

/// Which rows the More menu shows. Pure, so who sees what has a test.
struct BookMenuRows: Equatable {
    var bookmarks: Bool
    var export: Bool
    var editMetadata: Bool
    var removeFromWishlist: Bool
    var merge: Bool
    var delete: Bool

    static func resolve(
        hasFiles: Bool, canDownload: Bool, canSendToKindle: Bool, canEdit: Bool,
        wishlisted: Bool, isAdmin: Bool
    ) -> BookMenuRows {
        BookMenuRows(
            bookmarks: hasFiles,
            export: hasFiles && (canDownload || canSendToKindle),
            editMetadata: canEdit,
            removeFromWishlist: wishlisted,
            merge: isAdmin && hasFiles,
            delete: isAdmin
        )
    }
}

// MARK: - Bookmarks

enum BookmarkCopy {
    /// The bookmark's name, or where it is when it has none.
    static func name(_ bookmark: Bookmark) -> String {
        if let title = bookmark.title?.nilIfBlank { return title }
        if let seconds = Double(bookmark.position) {
            return "Listening, \(DetailFormat.duration(Int64(seconds))) in"
        }
        return "Saved position"
    }

    /// `Chapter 7 · October 28`, leaving out a chapter a listening bookmark
    /// can't place.
    static func meta(
        _ bookmark: Bookmark, chapters: [AlignmentEbookChapter], now: Date = Date()
    ) -> String {
        [
            ChapterLocator.label(chapters: chapters, cfi: bookmark.position),
            DetailFormat.day(unix: bookmark.createdAt, now: now),
        ]
        .compactMap { $0 }
        .joined(separator: " · ")
    }
}

/// Every bookmark in the book, and a tap to open at one. Presented from the
/// player too, where a tap seeks the book already playing.
struct BookmarksSheet: View {
    let book: Book
    let isAudio: Bool
    var chapters: [AlignmentEbookChapter] = []
    /// Hands the chosen bookmark back, for a screen with no reader or player
    /// up to take it. Without it, a tap goes to whichever is.
    var onOpen: ((Bookmark) -> Void)?

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(AudioPlayer.self) private var player

    @State private var bookmarks: [Bookmark] = []
    @State private var isLoading = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BookSheetHeader(title: "Bookmarks") { dismiss() }

            if isLoading {
                LoadingView()
            } else if bookmarks.isEmpty {
                Text("No bookmarks yet. The ones you place while reading or listening gather here.")
                    .font(.ui(16))
                    .foregroundStyle(palette.ink1Color)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
                    .padding(.top, 6)
                Spacer(minLength: 0)
            } else {
                list
            }
        }
        .bookSheet([.fraction(0.57), .large])
        .task { await load() }
    }

    private var list: some View {
        List {
            ForEach(bookmarks) { bookmark in
                row(bookmark)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparatorTint(palette.ink0Color.opacity(0.1))
            }
            .onDelete { offsets in
                let doomed = offsets.map { bookmarks[$0] }
                bookmarks.remove(atOffsets: offsets)
                Task {
                    for bookmark in doomed {
                        await UserDataService.deleteBookmark(bookmark)
                    }
                    await load()
                }
            }

            Text("Swipe one to remove it.")
                .font(.ui(14))
                .foregroundStyle(palette.ink1Color)
                .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 0, trailing: 16))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .deleteDisabled(true)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .scrollIndicators(.hidden)
    }

    private func row(_ bookmark: Bookmark) -> some View {
        Button {
            Haptics.tap()
            open(bookmark)
        } label: {
            HStack(spacing: 14) {
                RibbonShape()
                    .fill(palette.bookRibbon)
                    .frame(width: 15, height: 26)
                VStack(alignment: .leading, spacing: 0) {
                    Text(BookmarkCopy.name(bookmark))
                        .font(.ui(16, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                    Text(BookmarkCopy.meta(bookmark, chapters: chapters))
                        .font(.ui(14))
                        .foregroundStyle(palette.ink1Color)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(palette.ink1Color)
            }
            .padding(.vertical, 8)
            .frame(minHeight: 66)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        for await items in UserDataService.bookmarks(uuid: book.uuid).values() {
            bookmarks = items
            isLoading = false
        }
        isLoading = false
    }

    private func open(_ bookmark: Bookmark) {
        if let onOpen {
            onOpen(bookmark)
        } else if isAudio, let seconds = Double(bookmark.position) {
            Task { await player.seek(to: seconds) }
        } else {
            ReaderBridge.shared.pendingCFI = bookmark.position
        }
        dismiss()
    }
}

// MARK: - Export

/// How far a Send to Kindle has got.
enum KindleSendState: Equatable {
    case idle
    case sending
    case sent
    case failed(String)
}

/// What the Send to Kindle row says, and whether it answers a tap.
struct KindleRowCopy: Equatable {
    var meta: String
    var end: String
    var enabled: Bool
}

/// The copy on the Export sheet, kept off the view so the suite can pin it.
enum BookExportCopy {
    static func kindleRow(gate: KindleGate, state: KindleSendState, hasEpub: Bool) -> KindleRowCopy {
        let sends = "Emails the \(hasEpub ? "EPUB" : "book") to your Kindle"
        switch gate {
        case .noAddress:
            return KindleRowCopy(
                meta: "Add your Kindle address in Settings first.", end: "Settings", enabled: true
            )
        case .oversize:
            return KindleRowCopy(
                meta: "Too large to email. Upload it on Amazon\u{2019}s Send to Kindle page, up to 200 MB.",
                end: "Open",
                enabled: true
            )
        case .offline, .nothingToSend:
            return KindleRowCopy(meta: "Needs a connection", end: "", enabled: false)
        case .ready:
            break
        }
        switch state {
        case .idle: return KindleRowCopy(meta: sends, end: "Send", enabled: true)
        case .sending: return KindleRowCopy(meta: sends, end: "Sending\u{2026}", enabled: false)
        case .sent: return KindleRowCopy(meta: "Sent to your Kindle.", end: "Sent", enabled: false)
        case .failed(let message): return KindleRowCopy(meta: message, end: "Retry", enabled: true)
        }
    }

    /// `412 KB · opens the share sheet`.
    static func ebookMeta(sizeBytes: Int64?) -> String {
        [sizeBytes.map(Format.bytes), "opens the share sheet"]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    /// `M4B · 138 MB · opens the share sheet`.
    static func audioMeta(files: [BookFileInfo]) -> String {
        let bytes = files.reduce(0) { $0 + $1.sizeBytes }
        return [
            files.first?.format.uppercased(),
            bytes > 0 ? Format.bytes(bytes) : nil,
            "opens the share sheet",
        ]
        .compactMap { $0 }
        .joined(separator: " · ")
    }

    /// What to call a saved file: the book's title, since the server names one
    /// by uuid, with the extension the server actually answered with. A KEPUB
    /// that failed to convert arrives as a plain EPUB and must say so.
    static func fileName(title: String, suggested: String?, fallbackExtension: String) -> String {
        let safe = title
            .components(separatedBy: CharacterSet(charactersIn: "/\\:"))
            .joined(separator: " ")
        let name = suggested?.lowercased() ?? ""
        if name.hasSuffix(".kepub.epub") { return "\(safe).kepub.epub" }
        let ext = (name as NSString).pathExtension
        return "\(safe).\(ext.isEmpty ? fallbackExtension : ext)"
    }
}

/// Where a copy of the book can go: emailed to a Kindle, saved for a Kobo, or
/// out through the share sheet. Every one of these is a command, so per rule 08
/// test 2 none of them queues; offline they say so.
struct BookExportSheet: View {
    let book: Book

    private enum Save: Hashable { case kobo, ebook, audio }

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(AppState.self) private var app
    @State private var kindle = KindleSendState.idle
    @State private var saving: Save?
    @State private var saveError: String?
    private var downloads = DownloadManager.shared
    private var connectivity = Connectivity.shared

    init(book: Book) {
        self.book = book
    }

    private var canDownload: Bool { app.user?.canDownload == true }

    private var gate: KindleGate {
        KindleService.gate(
            hasSendableFile: book.hasEpub || book.hasPDF,
            epubSizeBytes: book.epubSizeBytes,
            kindleEmail: app.user?.kindleEmail,
            isOnline: connectivity.isOnline
        )
    }

    private var showsSends: Bool {
        !gate.isHidden || (book.hasEpub && canDownload)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BookSheetHeader(title: "Export", closes: kindle != .sending) { dismiss() }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if showsSends {
                        sectionHead("Send to a device")
                            .padding(.top, 4)
                        if !gate.isHidden { kindleRow }
                        if book.hasEpub, canDownload { koboRow }
                    }
                    if canDownload, book.hasEbook || book.hasAudiobook {
                        sectionHead("Save a copy")
                            .padding(.top, showsSends ? 18 : 4)
                        if book.hasEbook { ebookRow }
                        if book.hasAudiobook { audioRow }
                    }
                    if let saveError {
                        Text(saveError)
                            .font(.ui(14))
                            .foregroundStyle(palette.dangerText)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 12)
                            .accessibilityIdentifier("export-error")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
            .scrollIndicators(.hidden)
        }
        .bookSheet([.fraction(0.64), .large])
    }

    private func sectionHead(_ title: String) -> some View {
        Text(title)
            .font(.ui(15, weight: .semibold))
            .foregroundStyle(palette.ink0Color)
            .padding(.bottom, 2)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: - Kindle

    private var kindleRow: some View {
        let copy = BookExportCopy.kindleRow(gate: gate, state: kindle, hasEpub: book.hasEpub)

        return actionRow(
            "Send to Kindle", meta: copy.meta, metaInk: failed ? palette.dangerText : palette.ink1Color,
            enabled: copy.enabled, dimmed: gate == .offline
        ) {
            tapKindle()
        } end: {
            Text(copy.end)
                .font(.ui(15, weight: .semibold))
                .foregroundStyle(copy.enabled || kindle == .sent ? palette.bookText : palette.ink1Color)
                .fixedSize()
        }
        .accessibilityIdentifier("export-kindle")
    }

    private var failed: Bool {
        if case .failed = kindle { return true }
        return false
    }

    private func tapKindle() {
        Haptics.tap()
        switch gate {
        case .ready: send()
        case .oversize:
            if let url = KindleService.webUploadURL { openURL(url) }
        case .noAddress:
            // The address lives on the You tab, behind everything on this stack.
            dismiss()
            Presentation.shared.requestedTab = .you
        case .offline, .nothingToSend:
            break
        }
    }

    /// Enqueue the send and poll it to an outcome. Straight through
    /// `KindleService`, never the outbox: a send replayed hours later delivers a
    /// book the reader may have already finished. So it reports what happened,
    /// including refusals the gate can't pre-flight, chiefly an instance with no
    /// SMTP relay configured.
    private func send() {
        guard kindle != .sending else { return }
        kindle = .sending
        Task {
            do {
                try await KindleService.send(uuid: book.uuid)
                kindle = .sent
                Haptics.success()
            } catch {
                // The caller went away, not the send, which may already be in
                // flight, so reporting a failure is the one wrong answer.
                guard !isCancellation(error) else { return }
                kindle = .failed(
                    (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                )
                Haptics.warning()
            }
        }
    }

    // MARK: - Files

    private var koboRow: some View {
        actionRow(
            "Send to Kobo",
            meta: connectivity.isOnline
                ? "Saves a KEPUB to copy onto your Kobo" : "Needs a connection",
            enabled: connectivity.isOnline && saving == nil,
            dimmed: !connectivity.isOnline
        ) {
            save(.kobo, path: "/api/ebooks/\(book.uuid)/kepub", kind: nil, fallback: "epub")
        } end: {
            Text(saving == .kobo ? "Saving\u{2026}" : "Save")
                .font(.ui(15, weight: .semibold))
                .foregroundStyle(palette.bookText)
                .fixedSize()
        }
        .accessibilityIdentifier("export-kobo")
    }

    private var ebookRow: some View {
        let format = DownloadManager.targetFile(book, kind: .ebook)?.format.uppercased()
            ?? DownloadManager.fallbackEbookExtension(book).uppercased()
        let held = downloads.localURL(for: book.uuid, kind: .ebook) != nil

        return shareRow(
            "Download \(format)",
            meta: BookExportCopy.ebookMeta(sizeBytes: book.epubSizeBytes),
            needsNetwork: !held,
            busy: saving == .ebook
        ) {
            save(
                .ebook, path: "/api/ebooks/\(book.uuid)/download", kind: .ebook,
                fallback: format.lowercased()
            )
        }
        .accessibilityIdentifier("export-ebook")
    }

    private var audioRow: some View {
        let held = downloads.localURL(for: book.uuid, kind: .audio) != nil

        return shareRow(
            "Download audiobook",
            meta: BookExportCopy.audioMeta(files: book.audioFiles),
            needsNetwork: !held,
            busy: saving == .audio
        ) {
            save(
                .audio, path: "/api/audiobooks/\(book.uuid)/download", kind: .audio,
                fallback: book.audioFiles.first?.format.lowercased() ?? "m4b"
            )
        }
        .accessibilityIdentifier("export-audio")
    }

    /// Put a file in the share sheet: the copy on this phone when there is one,
    /// since an export of that costs nothing, otherwise fetched to disk.
    private func save(_ what: Save, path: String, kind: DownloadKind?, fallback: String) {
        guard saving == nil else { return }
        Haptics.tap()
        if let kind, let local = downloads.localURL(for: book.uuid, kind: kind) {
            ShareSheet.present(items: [local])
            return
        }
        saving = what
        saveError = nil
        Task {
            defer { saving = nil }
            do {
                let fetched = try await APIClient.shared.file(for: path)
                let folder = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let name = BookExportCopy.fileName(
                    title: book.displayTitle, suggested: fetched.suggestedName,
                    fallbackExtension: fallback
                )
                let destination = folder.appendingPathComponent(name)
                try FileManager.default.moveItem(at: fetched.url, to: destination)
                ShareSheet.present(items: [destination])
            } catch {
                guard !isCancellation(error) else { return }
                saveError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                Haptics.warning()
            }
        }
    }

    private func shareRow(
        _ title: String, meta: String, needsNetwork: Bool, busy: Bool,
        action: @escaping () -> Void
    ) -> some View {
        let offline = needsNetwork && !connectivity.isOnline

        return actionRow(
            title,
            meta: offline ? "Needs a connection" : meta,
            enabled: !offline && saving == nil,
            dimmed: offline,
            minHeight: 60,
            action: action
        ) {
            if busy {
                ProgressView().controlSize(.small).tint(palette.ink1Color)
            } else {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(palette.ink1Color)
            }
        }
    }

    private func actionRow<End: View>(
        _ title: String, meta: String, metaInk: Color? = nil, enabled: Bool, dimmed: Bool,
        minHeight: CGFloat = 66, action: @escaping () -> Void, @ViewBuilder end: () -> End
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.ui(16, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                    Text(meta)
                        .font(.ui(14))
                        .foregroundStyle(metaInk ?? palette.ink1Color)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                end()
            }
            .padding(.vertical, 8)
            .frame(minHeight: minHeight)
            .overlay(alignment: .top) {
                Rectangle().fill(palette.ink0Color.opacity(0.1)).frame(height: 1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(dimmed ? 0.5 : 1)
    }
}
