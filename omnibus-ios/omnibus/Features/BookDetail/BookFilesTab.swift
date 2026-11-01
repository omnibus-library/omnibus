//  BookFilesTab.swift
//  The Files tab: what this phone holds of the book, the link between its
//  formats, and the record's printing details.

import SwiftUI

struct BookFilesTab: View {
    let book: Book
    let model: BookDetailModel
    var onAlignment: () -> Void

    @Environment(\.palette) private var palette
    // Not `private`: a private stored property makes the memberwise
    // initializer private too, and this view is constructed from the page.
    var downloads = DownloadManager.shared

    /// Every transfer for this book that is still moving — one per format, and
    /// both at once when a reader downloads the ebook and the audiobook.
    private var activeDownloads: [DownloadRecord] {
        [DownloadKind.ebook, .audio]
            .compactMap { downloads.record(for: book.uuid, kind: $0) }
            .filter { $0.state == .running || $0.state == .queued }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if book.hasEbook || book.hasAudiobook || book.hasPhysical {
                Text("On this phone")
                    .font(.display(30, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.bottom, 12)

                formats
            }

            // Full width, below the rows rather than inside one: the control in
            // the row is a tap target with no room to say anything, and a
            // stalled transfer that only shows a still circle is what left a
            // reader unable to tell a starved download from a broken one.
            ForEach(activeDownloads, id: \.id) { record in
                DownloadProgressView(
                    record: record, activity: downloads.activity(of: record)
                )
                .padding(.top, 12)
            }

            if book.hasEbook, book.hasAudiobook {
                linkRow
                    .padding(.top, 10)
            }

            Text("Details")
                .font(.display(30, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 32)
                .padding(.bottom, 6)

            details
        }
    }

    // MARK: - Formats

    private var formats: some View {
        VStack(spacing: 0) {
            if book.hasEbook {
                formatRow("Ebook", detail: ebookDetail) {
                    DownloadBadge(book: book, kind: .ebook)
                }
            }
            if book.hasEbook, book.hasAudiobook { rule }
            if book.hasAudiobook {
                formatRow("Audiobook", detail: audioDetail) {
                    DownloadBadge(book: book, kind: .audio)
                }
            }
            if book.hasPhysical, book.hasEbook || book.hasAudiobook { rule }
            if book.hasPhysical {
                formatRow(
                    "Physical copy",
                    detail: book.isbn13.map { "ISBN \($0)" } ?? "On your shelf"
                ) {
                    Image(systemName: "books.vertical")
                        .font(.system(size: 16))
                        .foregroundStyle(palette.ink1Color)
                        .accessibilityHidden(true)
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.bg1Color))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var rule: some View {
        Rectangle().fill(palette.line.color).frame(height: 0.5)
    }

    private func formatRow<Control: View>(
        _ title: String, detail: String, @ViewBuilder control: () -> Control
    ) -> some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .font(.ui(16, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                Text(detail)
                    .font(.ui(14))
                    .foregroundStyle(palette.ink1Color)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            control()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(minHeight: 64)
    }

    private var ebookDetail: String {
        BookFilesCopy.ebookDetail(
            formats: book.formats,
            sizeBytes: book.epubSizeBytes,
            held: downloads.localURL(for: book.uuid, kind: .ebook) != nil
        )
    }

    private var audioDetail: String {
        BookFilesCopy.audioDetail(
            files: book.audioFiles,
            duration: model.audioDuration,
            held: downloads.localURL(for: book.uuid, kind: .audio) != nil
        )
    }

    // MARK: - Link

    private var linkRow: some View {
        let copy = DetailRead.syncRow(state: model.syncState)

        return Button {
            Haptics.tap()
            onAlignment()
        } label: {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(copy.title)
                        .font(.ui(16, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                    Text(copy.detail)
                        .font(.ui(14))
                        .foregroundStyle(palette.ink1Color)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(palette.ink1Color)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(minHeight: 64)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.bg1Color)
            )
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier("position-sync-row")
    }

    // MARK: - Details

    private var details: some View {
        VStack(spacing: 0) {
            ForEach(BookFilesCopy.details(book), id: \.key) { row in
                HStack(alignment: .firstTextBaseline, spacing: 16) {
                    Text(row.key)
                        .foregroundStyle(palette.ink1Color)
                    Spacer(minLength: 0)
                    Text(row.value)
                        .font(.ui(15, weight: .medium))
                        .foregroundStyle(palette.ink0Color)
                        .multilineTextAlignment(.trailing)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                }
                .font(.ui(15))
                .padding(.vertical, 11)
                .overlay(alignment: .bottom) { rule }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// The copy on the Files tab, kept off the view so the suite can pin it.
enum BookFilesCopy {
    /// `EPUB · 412 KB · downloaded`.
    static func ebookDetail(formats: [String], sizeBytes: Int64?, held: Bool) -> String {
        var parts = [
            formats
                .filter { Book.ebookFormats.contains($0.lowercased()) }
                .map { $0.uppercased() }
                .joined(separator: " · ")
        ]
        if let sizeBytes { parts.append(Format.bytes(sizeBytes)) }
        if held { parts.append("downloaded") }
        return parts.joined(separator: " · ")
    }

    /// `M4B · 4 h 49 m · 138 MB · streams`.
    static func audioDetail(files: [BookFileInfo], duration: Double?, held: Bool) -> String {
        let format = files.first?.format.uppercased() ?? "Audio"
        var parts = [files.count > 1 ? "\(format) · \(files.count) files" : format]
        if let duration { parts.append(DetailFormat.duration(Int64(duration))) }
        let bytes = files.reduce(0) { $0 + $1.sizeBytes }
        if bytes > 0 { parts.append(Format.bytes(bytes)) }
        parts.append(held ? "downloaded" : "streams")
        return parts.joined(separator: " · ")
    }

    /// The colophon. A row the record has nothing for is left out.
    static func details(_ book: Book) -> [DetailStatRow] {
        var series = book.series?.nilIfBlank
        if let name = series, let index = book.seriesIndex?.nilIfBlank {
            series = "\(name), book \(index)"
        }
        let rows: [(String, String?)] = [
            ("Publisher", book.publisher),
            ("Published", book.published.map(Format.looseDate)),
            ("Series", series),
            ("Language", Format.language(book.language)),
            ("ISBN", book.isbn13),
            ("Added", book.addedAt.map(Format.isoDate)),
            ("File", book.filename),
        ]
        return rows.compactMap { key, value in
            value?.nilIfBlank.map { DetailStatRow(key: key, value: $0) }
        }
    }
}

/// The download control for one format: fetch, progress while moving, a check
/// once held. Drawn as the design's 44pt disc in every state.
struct DownloadBadge: View {
    let book: Book
    let kind: DownloadKind

    @Environment(\.palette) private var palette
    @State private var confirmRemove = false
    private var downloads = DownloadManager.shared

    init(book: Book, kind: DownloadKind) {
        self.book = book
        self.kind = kind
    }

    var body: some View {
        let record = downloads.record(for: book.uuid, kind: kind)

        Group {
            switch record?.state {
            case .complete where downloads.isStale(book.uuid, kind: kind, against: book):
                disc("arrow.triangle.2.circlepath", tint: palette.warnColor, label: "Update download") {
                    Task { await downloads.redownload(book: book, kind: kind) }
                }

            case .complete:
                disc("checkmark", tint: palette.bookText, label: "Remove the download") {
                    confirmRemove = true
                }

            case .running, .queued:
                Button {
                    Task { await downloads.cancel(book.uuid, kind: kind) }
                } label: {
                    ProgressView(value: record?.fraction ?? 0)
                        .progressViewStyle(.circular)
                        .controlSize(.small)
                        .tint(palette.bookText)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(palette.quietFill))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Downloading. Tap to cancel.")

            case .failed:
                // Visibly a failure, not a fresh download — and the reason
                // travels with it, so the tap that retries isn't a mystery.
                HStack(spacing: 6) {
                    if let message = record?.error {
                        Text(message)
                            .font(.ui(12))
                            .foregroundStyle(palette.badColor)
                            .lineLimit(2)
                            .frame(maxWidth: 110, alignment: .trailing)
                    }
                    disc(
                        "exclamationmark.arrow.triangle.2.circlepath",
                        tint: palette.badColor,
                        label: "Download failed. Retry."
                    ) {
                        Task { await downloads.start(book: book, kind: kind) }
                    }
                }

            default:
                disc("arrow.down.to.line", tint: palette.ink0Color, label: downloadLabel) {
                    Task { await downloads.start(book: book, kind: kind) }
                }
            }
        }
        .confirmationDialog(
            "Remove the download?", isPresented: $confirmRemove, titleVisibility: .visible
        ) {
            Button("Remove download", role: .destructive) {
                Task { await downloads.remove(book.uuid, kind: kind) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The copy on this phone goes. Your library and your place in the book stay.")
        }
    }

    private var downloadLabel: String {
        kind == .audio ? "Download the audiobook" : "Download the ebook"
    }

    private func disc(
        _ symbol: String, tint: Color, label: String, action: @escaping () -> Void
    ) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 44, height: 44)
                .background(Circle().fill(palette.quietFill))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
