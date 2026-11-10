//  RequestsView.swift
//  Every reader's book requests, grouped by where each book stands. Pushed from You.

import SwiftUI

extension RequestTone {
    func color(in palette: Palette) -> Color {
        switch self {
        case .accent: palette.accentColor
        case .bad: palette.badColor
        case .ok: palette.okColor
        case .ink1: palette.ink1Color
        case .ink3: palette.ink3Color
        }
    }
}

struct RequestsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.palette) private var palette
    @State private var model = RequestsModel()

    private var viewer: RequestViewer? { app.user.map(RequestViewer.init) }

    var body: some View {
        Group {
            if let listings = model.listings {
                if listings.isEmpty { empty } else { list }
            } else if model.failure != nil {
                ErrorStateView(message: "Couldn\u{2019}t read the requests.") { Task { await model.load() } }
            } else {
                LoadingView()
            }
        }
        .background(ScreenBackground())
        .navigationTitle("Requests")
        .navigationBarTitleDisplayMode(.large)
        .task {
            await model.load()
            while let interval = RequestsFlow.listPollInterval(model.listings) {
                try? await Task.sleep(for: interval)
                guard !Task.isCancelled else { return }
                await model.poll()
            }
        }
    }

    private var list: some View {
        let groups = model.groups(viewer: viewer ?? RequestViewer(id: 0, canStart: false, canChoose: false))
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                Text(RequestsFlow.countsLine(groups))
                    .font(.ui(13))
                    .foregroundStyle(palette.ink2Color)
                    .padding(.bottom, Spacing.sm)
                ForEach(groups, id: \.key) { group in
                    header(group)
                    if !model.isFolded(group.key) {
                        ForEach(group.items, id: \.request.id) { item in
                            RequestRow(item: item, group: group.key)
                            Hairline()
                        }
                    }
                }
            }
            .screenPadding()
            .padding(.vertical, Spacing.md)
        }
        .scrollIndicators(.hidden)
        .refreshTask { await model.load() }
    }

    private func header(_ group: RequestGroup) -> some View {
        let folded = model.isFolded(group.key)
        return Button {
            withAnimation(Motion.snap) { model.toggleFold(group.key) }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .rotationEffect(.degrees(folded ? -90 : 0))
                Text(group.key.label.uppercased()).tracking(1.2)
                Text("\(group.items.count)")
                Spacer(minLength: 0)
            }
            .font(.monoUI(10.5))
            .foregroundStyle(palette.ink3Color)
            .padding(.top, Spacing.lg)
            .padding(.bottom, Spacing.sm)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isHeader)
        .accessibilityValue(folded ? "Folded" : "Open")
        .accessibilityHint(folded ? "Shows the books" : "Hides the books")
    }

    private var empty: some View {
        // A scroll view, so pull-to-refresh works on an empty list too.
        ScrollView {
            EmptyStateView(
                icon: "tray", title: "No requests yet",
                message: "A book anyone in the household asks for shows up here.", fanned: true
            )
            .containerRelativeFrame(.vertical)
        }
        .scrollIndicators(.hidden)
        .refreshTask { await model.load() }
    }
}

/// One book on the list: its cover, title, where it stands and a status dot.
private struct RequestRow: View {
    let item: RequestListing
    let group: RequestGroupKey

    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: Spacing.md) {
            BookCover(identity: CoverIdentity(item.book), size: .sm, cornerRadius: 4)
                .frame(width: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.book.displayTitle)
                    .font(.display(19, weight: .medium))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(2)
                Text(RequestsFlow.itemLine(item, group: group))
                    .font(.ui(12.5))
                    .foregroundStyle(palette.ink2Color)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Circle().fill(group.tone.color(in: palette)).frame(width: 7, height: 7)
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(palette.ink3Color.opacity(0.7))
        }
        .padding(.vertical, Spacing.sm)
        .accessibilityElement(children: .combine)
    }
}
