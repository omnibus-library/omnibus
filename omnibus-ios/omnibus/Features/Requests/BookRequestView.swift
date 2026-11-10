//  BookRequestView.swift
//  A book's requests on one page: the book, a lane for the request it opened on
//  and each other one going or stuck, the formats not yet requested, and the
//  history. Pushed from the Requests list and the wishlist's Get sheet.

import SwiftUI

struct BookRequestView: View {
    @Environment(AppState.self) private var app
    @Environment(\.palette) private var palette
    @State private var model: BookRequestModel

    init(uuid: String) {
        _model = State(initialValue: BookRequestModel(uuid: uuid))
    }

    private var viewer: RequestViewer {
        app.user.map(RequestViewer.init) ?? .nobody
    }

    var body: some View {
        Group {
            if model.isMissing {
                EmptyStateView(icon: "book.closed", title: "Book not found.")
            } else if let failure = model.failure {
                ErrorStateView(message: failure) { Task { await model.load(viewer: viewer) } }
            } else if let book = model.book {
                page(book)
            } else {
                LoadingView()
            }
        }
        .background(ScreenBackground())
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .bottom) { toastLayer }
        .animation(Motion.settle, value: model.toast?.id)
        .task { await model.load(viewer: viewer) }
        // Re-reads the clock when an undo window closes, so Request again appears without a reload.
        .task(id: model.nextWindowClose) {
            guard let close = model.nextWindowClose else { return }
            // Past the close, so the wake never lands a hair before it and finds the window still open.
            try? await Task.sleep(for: .seconds(max(0, close.timeIntervalSince(model.now())) + 0.25))
            guard !Task.isCancelled else { return }
            model.tick()
        }
        // Keyed on whether anything is moving, so a lane that starts moving after a write restarts the loop.
        .task(id: model.pollInterval != nil) {
            while let interval = model.pollInterval {
                try? await Task.sleep(for: interval)
                guard !Task.isCancelled else { return }
                await model.poll()
            }
        }
    }

    @ViewBuilder
    private var toastLayer: some View {
        if let toast = model.toast {
            StageToast(
                text: toast.text,
                actionLabel: toast.undoRequestID == nil ? nil : "Undo",
                action: { Task { await model.undo(toast) } },
                actionDisabled: model.busy != nil,
                onDismiss: { model.toast = nil }
            )
                .padding(.horizontal, 16)
                .padding(.bottom, Spacing.md)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: toast.id) {
                    try? await Task.sleep(for: toast.duration)
                    guard !Task.isCancelled else { return }
                    model.toast = nil
                }
        }
    }

    /// Share of a wide page the book's own pane takes, and the narrowest wide page that splits: the book page's.
    static let headerPaneShare = BookDetailView.stagePaneShare
    static let twoPaneWidth = BookDetailView.twoPaneWidth

    /// The two panes a page this big splits into, or nil for one column.
    static func split(size: CGSize, fold: Fold?) -> PaneSplit? {
        PaneSplit.resolve(size: size, fold: fold, share: headerPaneShare, minimumWidth: twoPaneWidth)
    }

    private func page(_ book: Book) -> some View {
        // The keyboard-down size, as on the book page, so a field's keyboard can't flip the layout.
        PaneGeometryReader { pane, _ in
            if let split = Self.split(size: pane.size, fold: pane.fold) {
                HStack(spacing: 0) {
                    scrolling { header(book) }.frame(width: split.leading)
                    Color.clear.frame(width: split.gap)
                    scrolling { lanes; history }.frame(width: split.trailing)
                }
            } else {
                scrolling {
                    header(book)
                    lanes
                    history
                }
            }
        }
    }

    private func scrolling<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) { content() }
                .screenPadding()
                .padding(.vertical, Spacing.md)
        }
        .scrollIndicators(.hidden)
        .refreshTask { await model.load(viewer: viewer) }
    }

    @ViewBuilder
    private var lanes: some View {
        ForEach(model.lanes) { lane in
            RequestLane(model: model, lane: lane)
        }
        ForEach(model.unrequested, id: \.self) { kind in
            UnrequestedLane(model: model, kind: kind)
        }
    }

    private func header(_ book: Book) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            BookCover(identity: CoverIdentity(book), size: .md, cornerRadius: 4)
                .frame(width: 78)
            VStack(alignment: .leading, spacing: 4) {
                Text(book.displayTitle)
                    .font(.display(32))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(3)
                if !book.creators.isEmpty {
                    Text(book.authorDisplay).font(.ui(14)).foregroundStyle(palette.ink2Color)
                }
                if let wishers = BookRequestFlow.wishersLine(model.wanters ?? [], viewer: viewer.id) {
                    Text(wishers).font(.ui(13)).foregroundStyle(palette.ink2Color)
                }
                NavigationLink(value: Destination.book(uuid: model.uuid)) {
                    Text("Open book page")
                        .font(.ui(13.5, weight: .medium))
                        .foregroundStyle(palette.accentColor)
                }
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var history: some View {
        let rows = model.history
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("HISTORY")
                    .font(.monoUI(10.5))
                    .tracking(1.2)
                    .foregroundStyle(palette.ink3Color)
                    .accessibilityAddTraits(.isHeader)
                ForEach(rows, id: \.request.id) { row in
                    HistoryRow(model: model, listing: row)
                }
            }
        }
    }
}

/// One past request, saying only what was recorded.
private struct HistoryRow: View {
    let model: BookRequestModel
    let listing: RequestListing

    @Environment(\.palette) private var palette

    var body: some View {
        // Read so the row draws again when a cancel's undo window closes.
        let _ = model.clock
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(BookRequestFlow.historyLine(listing, viewer: model.viewer.id))
                    .font(.ui(14))
                    .foregroundStyle(palette.ink0Color)
                if let details = BookRequestFlow.historyDetails(listing) {
                    Text(details).font(.ui(12)).foregroundStyle(palette.ink3Color)
                }
                ForEach(BookRequestFlow.swapFacts(listing), id: \.id) { fact in
                    Text(fact.text).font(.ui(12)).foregroundStyle(palette.ink3Color)
                }
            }
            Spacer(minLength: 0)
            if model.offersRequestAgain(listing.request) {
                RequestButton(model: model, kind: listing.request.kind, label: "Request again")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.md)
        .background(RoundedRectangle(cornerRadius: Radius.md, style: .continuous).fill(palette.bg2Color))
        .accessibilityElement(children: .contain)
    }
}
