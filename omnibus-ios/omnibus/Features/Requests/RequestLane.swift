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

/// The lanes' buttons: filled accent for the one action to take, a raised ground for the rest, bare text for quiet ones.
struct RequestButtonStyle: ButtonStyle {
    enum Emphasis { case primary, secondary, ghost }

    var emphasis: Emphasis = .secondary
    var fullWidth = false

    @Environment(\.palette) private var palette
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(14, weight: .semibold))
            .foregroundStyle(emphasis == .primary ? palette.accentInkColor : emphasis == .ghost ? palette.ink1Color : palette.ink0Color)
            .padding(.horizontal, emphasis == .ghost ? 4 : 16)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 40)
            .background(
                Capsule().fill(emphasis == .primary ? palette.accentColor : emphasis == .secondary ? palette.bg3Color : .clear))
            .contentShape(Rectangle())
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
            .animation(Motion.lift, value: configuration.isPressed)
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
            if BookRequestFlow.offersLookingRetry(lane, viewer: model.viewer, now: model.now()) {
                Text(BookRequestFlow.stillLooking).font(.ui(13)).foregroundStyle(palette.ink2Color)
                tryAgain
            }
        case .choose:
            VersionList(model: model, lane: lane)
        case .chosen:
            PickedCard(lane: lane, meta: nil)
        case .onItsWay:
            DownloadCard(lane: lane, left: BookRequestFlow.timeLeft(lane, now: model.now()))
            if model.viewer.canChoose && BookRequestFlow.isDownloading(lane) { chooseAnother }
        case .ready:
            if BookRequestFlow.pickedVersion(lane) != nil {
                PickedCard(
                    lane: lane,
                    meta: [BookRequestFlow.pickedVersion(lane)?.indexer, "added \(BookRequestFlow.recency(since: lane.updatedAt, now: model.now()))"]
                        .compactMap { $0 }.joined(separator: BookRequestFlow.sep))
            }
            if model.viewer.canChoose, let offer = lane.coverOffer {
                CoverOfferCard(model: model, lane: lane, offer: offer)
            }
        case .stuck:
            if model.viewer.canChoose {
                tryAgain
            } else {
                Text("Waiting for someone who can pick versions to try again.")
                    .font(.ui(13)).foregroundStyle(palette.ink2Color)
            }
        case .cancelled:
            EmptyView()
        }
    }

    /// Commands never queue offline (rule 08), so every button waits for the server to be reachable.
    private var locked: Bool { model.busy != nil || !Connectivity.shared.isOnline }

    private var tryAgain: some View {
        Button(model.busy == .retrying(lane.id) ? "Trying\u{2026}" : "Try again") { Task { await model.retry(lane) } }
            .buttonStyle(RequestButtonStyle(emphasis: .primary))
            .disabled(locked)
    }

    private var chooseAnother: some View {
        Button(model.busy == .swapping(lane.id) ? "Choosing\u{2026}" : "Choose another") { Task { await model.swap(lane) } }
            .buttonStyle(RequestButtonStyle(emphasis: .ghost))
            .disabled(locked)
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
                VersionRow(
                    version: version,
                    onChoose: model.viewer.canChoose ? { Task { await model.choose(lane, version: version.id) } } : nil,
                    choosing: model.busy == .choosing(request: lane.id, version: version.id),
                    locked: model.busy != nil || !Connectivity.shared.isOnline)
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
    /// Nil when the viewer may not pick versions.
    let onChoose: (() -> Void)?
    /// This is the version being chosen.
    let choosing: Bool
    /// Some write is running or the server is out of reach, so none can start.
    let locked: Bool

    @Environment(\.palette) private var palette

    private var best: Bool { version.bestMatch && !version.rejected }

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.md) {
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
            Spacer(minLength: 0)
            if let onChoose, !version.rejected {
                Button(choosing ? "Choosing\u{2026}" : "Choose", action: onChoose)
                    .buttonStyle(RequestButtonStyle(emphasis: best ? .primary : .secondary))
                    .disabled(locked)
                    .accessibilityLabel(choosing ? "Choosing" : "Choose \(version.title)")
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

// MARK: - Cover offer

/// The sharper cover a finished download brought, beside the book's own, with Use and Keep.
private struct CoverOfferCard: View {
    let model: BookRequestModel
    let lane: BookRequest
    let offer: CoverOffer

    @Environment(\.palette) private var palette

    private var locked: Bool { model.busy != nil || !Connectivity.shared.isOnline }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .top, spacing: Spacing.lg) {
                figure("Now") {
                    if let book = model.book { BookCover(identity: CoverIdentity(book), size: .sm, cornerRadius: 4) }
                }
                figure("From the download") {
                    RemoteImage(path: RequestService.path(id: lane.id, action: "cover")) { palette.bg3Color }
                        .aspectRatio(2.0 / 3.0, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("The download has a sharper cover")
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                Text(BookRequestFlow.coverSizesLine(offer)).font(.ui(12.5)).foregroundStyle(palette.ink2Color)
            }
            VStack(spacing: Spacing.xs) {
                Button(model.busy == .takingCover(lane.id) ? "Using\u{2026}" : "Use the downloaded cover") {
                    Task { await model.takeCover(lane) }
                }
                .buttonStyle(RequestButtonStyle(emphasis: .primary, fullWidth: true))
                Button(model.busy == .keepingCover(lane.id) ? "Keeping\u{2026}" : "Keep this one") {
                    Task { await model.keepCover(lane) }
                }
                .buttonStyle(RequestButtonStyle(emphasis: .ghost, fullWidth: true))
            }
            .disabled(locked)
        }
        .laneCard(palette, radius: Radius.md, fill: palette.bg1Color)
        .accessibilityElement(children: .contain)
    }

    private func figure(_ caption: String, @ViewBuilder _ cover: () -> some View) -> some View {
        VStack(spacing: 6) {
            cover().frame(width: 64)
            Text(caption).font(.ui(12)).foregroundStyle(palette.ink3Color)
        }
        .accessibilityElement(children: .combine)
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
