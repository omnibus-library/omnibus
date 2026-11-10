//  RequestLane.swift
//  One request's card on the request page: its format, who asked, the stepper,
//  and the body for the state it is in. The unrequested lane is its dashed twin.

import SwiftUI

/// A card's ground and hairline, shared by the lanes and the cards inside them.
private extension View {
    func laneCard(_ palette: Palette, radius: CGFloat = Radius.lg, fill: Color? = nil, accented: Bool = false) -> some View {
        padding(Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(fill ?? palette.bg2Color))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(accented ? palette.accentColor.opacity(0.55) : palette.line2Color, lineWidth: 0.5))
    }
}

/// The format a lane is for, boxed in mono.
private struct KindChip: View {
    let kind: RequestKind
    @Environment(\.palette) private var palette

    var body: some View {
        Text(BookRequestFlow.kindChip(kind))
            .font(.monoUI(9.5, weight: .medium))
            .foregroundStyle(palette.ink2Color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2.5)
            .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(palette.line2Color, lineWidth: 0.5))
            .accessibilityHidden(true)
    }
}

struct RequestLane: View {
    let model: BookRequestModel
    let lane: BookRequest

    @Environment(\.palette) private var palette

    private var listing: RequestListing? { model.listing(for: lane) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            head
            if let steps = BookRequestFlow.steps(lane) {
                stepper(steps)
            } else {
                stateNote
            }
            content
        }
        .laneCard(palette)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("request-lane-\(lane.kind.rawValue)")
    }

    private var head: some View {
        HStack(spacing: Spacing.sm) {
            KindChip(kind: lane.kind)
            Text(BookRequestFlow.kindLabel(lane.kind))
                .font(.ui(16, weight: .medium))
                .foregroundStyle(palette.ink0Color)
            if let listing {
                UserAvatar(id: lane.userID, name: listing.requesterName, hasAvatar: listing.requesterHasAvatar, size: 20)
                Text(BookRequestFlow.askedBy(listing, viewer: model.viewer.id, now: model.now()))
                    .font(.ui(12.5))
                    .foregroundStyle(palette.ink3Color)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    private func stepper(_ steps: [BookRequestFlow.Step]) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(steps, id: \.label) { step in
                HStack(spacing: Spacing.sm) {
                    Circle().fill(tint(step.status)).frame(width: 8, height: 8)
                    Text(step.label)
                        .font(.ui(14, weight: step.status == .current ? .medium : .regular))
                        .foregroundStyle(step.status == .todo ? palette.ink3Color : step.status == .current ? palette.accentColor : palette.ink1Color)
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(step.status == .current ? "Current step" : step.status == .done ? "Done" : "Still to come")
            }
        }
    }

    private func tint(_ status: BookRequestFlow.Step.Status) -> Color {
        switch status {
        case .done: palette.okColor
        case .current: palette.accentColor
        case .todo: palette.ink3Color
        }
    }

    /// A stuck or cancelled lane says so in words: the heading, and the error or general line under it.
    @ViewBuilder
    private var stateNote: some View {
        let view = BookRequestFlow.stateView(lane.state, stuckReason: lane.stuckReason, kind: lane.kind, stuckDetail: lane.stuckDetail)
        VStack(alignment: .leading, spacing: 3) {
            Text(view.heading)
                .font(.ui(14.5, weight: .medium))
                .foregroundStyle(lane.state == .stuck ? palette.badColor : palette.ink1Color)
            if let note = view.note {
                Text(note).font(.ui(13)).foregroundStyle(palette.ink2Color)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var content: some View {
        switch lane.state {
        case .looking:
            LoadingView(label: BookRequestFlow.lookingLabel(lane, now: model.now()))
                .frame(height: 96)
                .laneCard(palette, radius: Radius.md, fill: palette.bg1Color)
        case .choose:
            VersionList(model: model, lane: lane)
        case .chosen:
            PickedCard(lane: lane, meta: nil)
        case .onItsWay:
            DownloadCard(lane: lane, left: BookRequestFlow.timeLeft(lane, now: model.now()))
        case .ready:
            if BookRequestFlow.pickedVersion(lane) != nil {
                PickedCard(
                    lane: lane,
                    meta: [BookRequestFlow.pickedVersion(lane)?.indexer, "added \(BookRequestFlow.recency(since: lane.updatedAt, now: model.now()))"]
                        .compactMap { $0 }.joined(separator: BookRequestFlow.sep))
            }
        case .stuck, .cancelled:
            EmptyView()
        }
    }
}

// MARK: - Versions

/// The versions found, best first, four at a time.
private struct VersionList: View {
    let model: BookRequestModel
    let lane: BookRequest

    @Environment(\.palette) private var palette
    @State private var showAll = false

    var body: some View {
        let collapsed = BookRequestFlow.firstShown(lane.versions)
        let hidden = lane.versions.count - collapsed.count
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if let note = lane.note {
                Text(note).font(.ui(13)).foregroundStyle(palette.ink2Color)
            }
            Text(BookRequestFlow.versionsFound(lane.versions).uppercased())
                .font(.monoUI(10))
                .tracking(1)
                .foregroundStyle(palette.ink3Color)
            if !model.viewer.canChoose {
                Text("Waiting for someone who can pick versions.").font(.ui(13)).foregroundStyle(palette.ink2Color)
            }
            ForEach(showAll ? lane.versions : collapsed, id: \.id) { version in
                VersionRow(version: version)
            }
            if hidden > 0 {
                Button(showAll ? "Show fewer" : "Show \(hidden) more") { withAnimation(Motion.snap) { showAll.toggle() } }
                    .font(.ui(13.5, weight: .medium))
                    .foregroundStyle(palette.ink1Color)
                    .accessibilityHint(showAll ? "Hides the extra versions" : "Shows the extra versions")
            }
        }
    }
}

/// One version found: its name (a link to the source's page when it gave one), its source line and its tags.
private struct VersionRow: View {
    let version: RequestVersion

    @Environment(\.palette) private var palette

    private var best: Bool { version.bestMatch && !version.rejected }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            name
            Text(BookRequestFlow.versionSource(version))
                .font(.ui(12.5))
                .foregroundStyle(palette.ink2Color)
            if version.rejected {
                tag("Didn\u{2019}t work", palette.ink3Color)
            } else if best {
                tag("Best match", palette.accentColor)
            }
            if BookRequestFlow.convertsToEpub(version) && !version.rejected {
                tag("We\u{2019}ll convert it to EPUB", palette.ink3Color)
            }
        }
        .laneCard(palette, radius: Radius.md, fill: palette.bg1Color, accented: best)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var name: some View {
        let title = Text(version.title).font(.ui(15, weight: .medium)).foregroundStyle(palette.ink0Color)
        if let url = version.infoURL.flatMap(Self.sourcePage) {
            Link(destination: url) {
                (title + Text(" \u{2060}") + Text(Image(systemName: "arrow.up.right")).font(.system(size: 11)).foregroundColor(palette.ink3Color))
                    .multilineTextAlignment(.leading)
            }
            .accessibilityHint("Opens the source\u{2019}s page")
        } else {
            title
        }
    }

    /// Only an http or https page is opened.
    private static func sourcePage(_ raw: String) -> URL? {
        guard let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased()) else { return nil }
        return url
    }

    private func tag(_ text: String, _ color: Color) -> some View {
        Text(text.uppercased()).font(.monoUI(9.5)).tracking(0.8).foregroundStyle(color)
    }
}

// MARK: - Picked, downloading, added

/// The version a request picked: its format and size over its name.
private struct PickedCard: View {
    let lane: BookRequest
    /// The line under the name; the pick's size and source when nil.
    let meta: String?

    @Environment(\.palette) private var palette

    var body: some View {
        let picked = BookRequestFlow.pickedVersion(lane)
        VStack(alignment: .leading, spacing: 4) {
            Text(picked.map(BookRequestFlow.pickedHeading) ?? "Your pick")
                .font(.ui(17, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
            if let picked {
                Text(picked.title).font(.ui(12)).foregroundStyle(palette.ink3Color)
            }
            if let line = meta ?? picked.map(BookRequestFlow.pickedMeta), !line.isEmpty {
                Text(line).font(.ui(12.5)).foregroundStyle(palette.ink2Color)
            }
        }
        .laneCard(palette, radius: Radius.md, fill: palette.bg1Color)
        .accessibilityElement(children: .combine)
    }
}

/// A download: the pick over its bar, then its percent and time left.
private struct DownloadCard: View {
    let lane: BookRequest
    let left: String?

    @Environment(\.palette) private var palette

    var body: some View {
        let picked = BookRequestFlow.pickedVersion(lane)
        let percent = BookRequestFlow.downloadPercent(lane)
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(picked.map(BookRequestFlow.pickedHeading) ?? "Your pick")
                .font(.ui(17, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
            if let picked {
                Text(picked.title).font(.ui(12)).foregroundStyle(palette.ink3Color)
            }
            if (lane.progress ?? 0) >= 1 {
                LoadingView(label: "Adding it to the library\u{2026}").frame(height: 64)
            } else {
                ProgressBar(fraction: lane.progress ?? 0, tint: palette.accentColor)
                    .animation(Motion.settle, value: lane.progress)
            }
            let line = [percent.map { "\($0)%" }, left].compactMap { $0 }.joined(separator: BookRequestFlow.sep)
            if !line.isEmpty {
                Text(line).font(.ui(12.5)).foregroundStyle(palette.ink2Color)
            }
        }
        .laneCard(palette, radius: Radius.md, fill: palette.bg1Color)
    }
}

// MARK: - Unrequested

/// A format the book has neither in the library nor among its requests.
struct UnrequestedLane: View {
    let kind: RequestKind

    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: Spacing.sm) {
            KindChip(kind: kind)
            Text(BookRequestFlow.kindLabel(kind))
                .font(.ui(16, weight: .medium))
                .foregroundStyle(palette.ink0Color)
            Text("not requested").font(.ui(12.5)).foregroundStyle(palette.ink3Color)
            Spacer(minLength: 0)
        }
        .padding(Spacing.md)
        .overlay(
            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .strokeBorder(palette.line2Color, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        )
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("request-unrequested-\(kind.rawValue)")
    }
}
