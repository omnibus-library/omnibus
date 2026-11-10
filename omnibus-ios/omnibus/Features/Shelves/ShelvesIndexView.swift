//  ShelvesIndexView.swift
//  The shelves index: every shelf the reader can see, grouped by owner.
//
//  Laid out as the web's `/shelves` is — a census under the title, kind and
//  owner filters, then one section per owner with the viewer's first — but in
//  the platform's grammar: the title is the navigation bar's, the text filter
//  is the system search field, and the order lives in a toolbar menu.

import SwiftUI

struct ShelvesView: View {
    @Environment(\.palette) private var palette
    @Environment(AppState.self) private var app
    @State private var previews: [ShelfPreview] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var showCreate = false
    @State private var query = ShelfQuery(sort: ShelvesSort.load())

    private var viewerId: Int64? { app.user?.id }
    private var summaries: [ShelfSummary] { previews.map(\.shelf) }
    private var groups: [ShelfOwnerGroup] {
        ShelvesIndex.groups(previews, viewerId: viewerId, query: query)
    }

    var body: some View {
        Group {
            if isLoading && previews.isEmpty {
                LoadingView()
            } else if let error, previews.isEmpty {
                ErrorStateView(message: error) { Task { await load() } }
            } else if previews.isEmpty {
                EmptyStateView(
                    icon: "square.stack",
                    title: "No shelves yet",
                    message: "Gather books by hand, or let a rule fill one for you.",
                    kicker: "Your shelves",
                    fanned: true,
                    actionTitle: "Create a shelf",
                    action: { showCreate = true }
                )
            } else {
                index
            }
        }
        .background(ScreenBackground())
        .navigationTitle("Shelves")
        .navigationSubtitle(previews.isEmpty ? "" : ShelvesIndex.census(summaries, viewerId: viewerId))
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query.text, prompt: "Filter by shelf or owner")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { sortMenu }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showCreate = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New shelf")
            }
        }
        .refreshTask { await load(force: true) }
        .sheet(isPresented: $showCreate) {
            CreateShelfSheet { Task { await load(force: true) } }
        }
        .task { await load() }
        .onChange(of: ReplicaInvalidations.shared.generation(of: CacheKey.shelfPreviews)) { _, _ in
            Task { await load() }
        }
        .onChange(of: query.sort) { _, sort in sort.save() }
    }

    private var index: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                filters

                let groups = groups
                if groups.isEmpty {
                    EmptyStateView(
                        icon: "line.3.horizontal.decrease.circle",
                        title: "No shelves match",
                        message: ShelvesIndex.emptyMessage(query),
                        actionTitle: "Clear filters",
                        action: { withAnimation(Motion.settle) { clearFilters() } }
                    )
                    .frame(minHeight: 360)
                } else {
                    LazyVStack(alignment: .leading, spacing: 30) {
                        ForEach(groups) { group in
                            section(group)
                        }
                    }
                    .padding(.top, Spacing.xl)
                }
            }
            .padding(.top, Spacing.sm)
            .padding(.bottom, 40)
        }
        .scrollIndicators(.hidden)
    }

    // MARK: Filters

    /// Kind, then owner — the owner row only once there is more than one to choose.
    private var filters: some View {
        let owners = ShelvesIndex.owners(summaries, viewerId: viewerId)
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            SideRail {
                HStack(spacing: 6) {
                    ForEach(ShelfKindFilter.allCases) { kind in
                        chipButton(isOn: query.kind == kind, id: "shelves-kind-\(kind.rawValue)") {
                            query.kind = kind
                        } label: {
                            Chip(label: kind.label, isOn: query.kind == kind)
                        }
                    }
                }
                .screenPadding()
            }

            if owners.count > 1 {
                SideRail {
                    HStack(spacing: 6) {
                        chipButton(isOn: query.owner == nil, id: "shelves-owner-anyone") {
                            query.owner = nil
                        } label: {
                            Chip(label: "Everyone", isOn: query.owner == nil, count: previews.count)
                        }
                        ForEach(owners) { owner in
                            let isOn = query.owner == owner.id
                            chipButton(isOn: isOn, id: "shelves-owner-\(owner.id)") {
                                query.owner = isOn ? nil : owner.id
                            } label: {
                                OwnerChip(owner: owner, isOn: isOn)
                            }
                        }
                    }
                    .screenPadding()
                }
            }
        }
    }

    private func chipButton<Label: View>(
        isOn: Bool, id: String, action: @escaping () -> Void, @ViewBuilder label: () -> Label
    ) -> some View {
        Button {
            Haptics.select()
            withAnimation(Motion.settle) { action() }
        } label: {
            label()
        }
        .buttonStyle(PressableStyle())
        .accessibilityAddTraits(isOn ? .isSelected : [])
        .accessibilityIdentifier(id)
    }

    private var sortMenu: some View {
        Menu {
            Picker("Sort", selection: $query.sort.animation(Motion.settle)) {
                ForEach(ShelvesSort.allCases) { sort in
                    Text(sort.label).tag(sort)
                }
            }
        } label: {
            Image(systemName: "arrow.up.arrow.down")
        }
        .accessibilityLabel("Sort shelves")
    }

    private func clearFilters() {
        query.text = ""
        query.owner = nil
        query.kind = .any
    }

    // MARK: Groups

    private func section(_ group: ShelfOwnerGroup) -> some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            HStack(spacing: 10) {
                UserAvatar(
                    id: group.owner.id,
                    name: group.owner.name,
                    hasAvatar: group.owner.hasAvatar,
                    size: 30
                )
                .accessibilityHidden(true)
                Text(group.owner.groupTitle)
                    .font(.display(24))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                Text("\(group.shelves.count)")
                    .font(.monoUI(11))
                    .foregroundStyle(palette.ink3Color)
                    .accessibilityHidden(true)
            }
            .padding(.bottom, 10)
            .overlay(alignment: .bottom) {
                Rectangle().fill(palette.line2Color).frame(height: 1)
            }

            CoverGrid(group.shelves, density: .tiles) { preview in
                NavigationLink(value: Destination.shelf(id: preview.shelf.id)) {
                    ShelfTile(preview: preview, ownerLabel: group.owner.shortName)
                }
                .buttonStyle(BookPressStyle())
                .shelfContextMenu(preview.shelf) {
                    Task { await load(force: true) }
                }
                .accessibilityIdentifier("shelf-card-\(preview.shelf.id)")
            }
        }
        .screenPadding()
        .accessibilityIdentifier("shelves-group-\(group.owner.id)")
    }

    private func load(force: Bool = false) async {
        // No cache-clear on the way in, even for a pull. `Cache.live` refetches
        // on every read regardless, and offline a delete threw away the only
        // copy of the shelves there was.
        do {
            for try await read in UserDataService.shelfPreviews() {
                previews = read.value
                error = nil
                isLoading = false
            }
        } catch {
            if previews.isEmpty {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
        isLoading = false
    }
}

/// An owner filter: their avatar, the name, and how many shelves they keep.
private struct OwnerChip: View {
    let owner: ShelfOwner
    let isOn: Bool

    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 6) {
            UserAvatar(id: owner.id, name: owner.name, hasAvatar: owner.hasAvatar, size: 22)
            Text(owner.shortName)
            Text("\(owner.shelfCount)")
                .font(.monoUI(11))
                .foregroundStyle(isOn ? palette.accentInk.color.opacity(0.7) : palette.ink3Color)
        }
        .font(.ui(13, weight: .medium))
        .foregroundStyle(isOn ? palette.accentInk.color : palette.ink1Color)
        .padding(.leading, 3)
        .padding(.trailing, 11)
        .padding(.vertical, 3)
        .background(Capsule().fill(isOn ? palette.accentColor : palette.bg2Color))
        .overlay(Capsule().strokeBorder(isOn ? .clear : palette.line2.color, lineWidth: 0.5))
    }
}
