//  PlayerView.swift
//  The immersive audiobook player, plus the mini bar docked in the tab bar.

import SwiftUI

struct PlayerView: View {
    let book: Book
    let fileID: Int64?

    init(book: Book, fileID: Int64? = nil) {
        self.book = book
        self.fileID = fileID
    }

    @Environment(AudioPlayer.self) private var player
    @Environment(\.palette) private var theme
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.sideBarEdge) private var sideBarEdge
    private let downloads = DownloadManager.shared

    /// The in-flight download of the book currently loaded, if any — the only
    /// one worth naming here, since it is the one sharing this stream's link.
    private var activeDownload: DownloadRecord? {
        guard let uuid = player.book?.uuid else { return nil }
        return [DownloadKind.audio, .ebook]
            .compactMap { downloads.record(for: uuid, kind: $0) }
            .first { $0.state == .running || $0.state == .queued }
    }

    /// The screen's palette, book-toned like `BookDetailView`'s — the backdrop
    /// bloom already came from this book, and every control over it reading the
    /// theme's accent instead is what made one screen disagree with itself.
    ///
    /// Shadows the environment value the theme supplies, so `palette` means the
    /// toned one everywhere below and a later accent can't pick up the wrong
    /// source by spelling.
    private var palette: Palette { theme.accented(byCoverOf: book) }

    /// Offset inside the scrubbed span while a drag is in flight.
    @State private var scrubOffset: Double?
    /// How far the swipe-to-minimize drag has carried the surface down.
    @State private var dismissDrag: CGFloat = 0
    @State private var showChapters = false
    @State private var showSleepTimer = false
    @State private var showSpeed = false
    @State private var showBookmarks = false
    @State private var syncedHere = false
    @State private var showCarMode = false

    /// The artwork region's centre, as a share of the whole player.
    static func bloom(over arrangement: PlayerArrangement) -> UnitPoint {
        let bounds = arrangement.artwork.union(arrangement.controls)
        guard bounds.width > 0, bounds.height > 0 else { return UnitPoint(x: 0.5, y: 0.32) }
        return UnitPoint(
            x: arrangement.artwork.midX / bounds.width,
            y: (arrangement.artwork.minY + arrangement.artwork.height * 0.4) / bounds.height
        )
    }

    /// The top bar's row: minimize, then the reader and bookmark discs.
    static let topBarHeight: CGFloat = 40
    /// Widest the transport and utility rows run: past a phone's width their
    /// buttons drift apart until they stop reading as one control.
    static let controlsMaxWidth: CGFloat = 460
    /// Shortest side-by-side controls pane whose controls centre rather than sit low for the thumb.
    static let centredControlsHeight: CGFloat = 560

    /// Share of the band between the two insets the artwork may take.
    ///
    /// It tapers on a short screen. The transport's height is fixed, so on a
    /// 4.7" phone it eats a much larger fraction of the screen than on a 6.3"
    /// one, and holding the artwork at the tall-screen share there leaves the
    /// title with nothing — which is the squeeze this whole layout exists to
    /// avoid.
    private static func coverShare(in bandHeight: CGFloat) -> CGFloat {
        bandHeight < 380 ? 0.66 : 0.76
    }

    var body: some View {
        ZStack {
            // An opaque floor the drag cannot take with it. The gap the swipe
            // opens has to stay filled, and what sits behind this view is not
            // the same thing from the tab root as from either reader. A sibling
            // rather than a `.background` on the offset surface, so nothing
            // rests on whether the transform reaches it.
            palette.bg0Color.ignoresSafeArea()

            surface
                .offset(y: dismissDrag)
                .opacity(1 - PlayerDismissDrag.progress(at: dismissDrag) * 0.3)
        }
        .task { await player.load(book: book, fileID: fileID) }
        .sheet(isPresented: $showChapters) { ChapterSheet() }
        .sheet(isPresented: $showBookmarks) { BookmarksSheet(book: book, isAudio: true) }
        .fullScreenCover(isPresented: $showCarMode) { CarModeView(book: book) }
        .sheet(isPresented: $showSpeed) { SpeedSheet() }
        .sheet(isPresented: $showSleepTimer) { SleepSheet() }
        // Outermost, so the chapter, speed, sleep and bookmark sheets above —
        // and Car Mode — are drawn in the book's tone rather than staying amber
        // over a player that isn't. Same placement as `BookDetailView`.
        .environment(\.palette, palette)
        .tint(palette.accentColor)
    }

    /// Everything the dismiss drag carries: the wash, the stage, and the two
    /// inset rows, so the whole player travels as one sheet would.
    private var surface: some View {
        GeometryReader { geometry in
            let arrangement = PlayerArrangement.resolve(
                in: CGRect(origin: .zero, size: geometry.size),
                fold: geometry.activeFold
            )
            if arrangement.kind == .stacked {
                stackedSurface(width: geometry.size.width)
            } else {
                arrangedSurface(arrangement)
            }
        }
        // No tab bar ever shows here, so an iPhone Duo's bar column is the
        // player's too, bar the status bar and camera the top bar keeps off.
        .reclaimsSideColumn()
    }

    /// Artwork in one region and controls in the other: a wide screen, or
    /// either side of a partly folded hinge.
    private func arrangedSurface(_ arrangement: PlayerArrangement) -> some View {
        let sideBySide = arrangement.kind == .sideBySide
        // Side by side, the bar spans both panes as it does upright, so the
        // way out stays in the corner; above a fold it tops the artwork half.
        let barClearance = sideBySide ? Self.topBarHeight + Spacing.xs * 2 : 0

        let artwork = VStack(spacing: Spacing.md) {
            if !sideBySide { topBar.clearsOcclusions() }
            Spacer(minLength: 0)
            cover(maxHeight: max(120, (arrangement.artwork.height - barClearance) * 0.66))
            titles
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.screen)
        .padding(.top, barClearance)
        .padding(.vertical, Spacing.xs)
        .frame(width: arrangement.artwork.width, height: arrangement.artwork.height)
        .contentShape(Rectangle())
        .gesture(dismissGesture)

        // Beside the artwork on a phone the transport sits low, where the thumb
        // is; on a tablet-tall screen, or below a fold, the controls centre
        // level with the artwork rather than leave the half above them empty.
        // Centred too beside an iPhone Duo's bar column, whose foot holds the
        // status bar and camera when the phone is on its side.
        let centred = !sideBySide || arrangement.controls.height >= Self.centredControlsHeight
            || sideBarEdge != nil
        let controlPane = VStack(spacing: 0) {
            Spacer(minLength: Spacing.sm)
            controls
                .frame(maxWidth: Self.controlsMaxWidth)
                .clearsOcclusions()
            if centred { Spacer(minLength: Spacing.sm) }
        }
        .padding(.horizontal, Spacing.screen)
        .padding(.top, barClearance)
        .padding(.vertical, Spacing.xs)
        .frame(width: arrangement.controls.width, height: arrangement.controls.height)

        return ZStack(alignment: .top) {
            backdrop(bloom: Self.bloom(over: arrangement))
            if sideBySide {
                HStack(spacing: 0) {
                    artwork
                    Color.clear.frame(width: max(0, arrangement.controls.minX - arrangement.artwork.maxX))
                    controlPane
                }
                topBar
                    .clearsOcclusions()
                    .padding(.horizontal, Spacing.screen)
                    .padding(.vertical, Spacing.xs)
            } else {
                VStack(spacing: 0) {
                    artwork
                    Color.clear.frame(height: max(0, arrangement.controls.minY - arrangement.artwork.maxY))
                    controlPane
                }
            }
            statusLayers
        }
        .background(ScreenBackground())
    }

    private func stackedSurface(width: CGFloat) -> some View {
        ZStack {
            backdrop
            stage
            statusLayers
        }
        // `width`, the surface's own, pins these rows to a definite width.
        // Without one they inherit an unbounded proposal from the cover stack,
        // and every `Spacer` / `maxWidth: .infinity` child expands past the
        // screen edge — which silently pushed the transport ends and the top
        // bar out of view. `containerRelativeFrame` measured the safe area
        // instead, which on an iPhone Duo slid both rows off the left edge.
        .safeAreaInset(edge: .top, spacing: 0) {
            topBar
                .clearsOcclusions()
                .padding(.horizontal, Spacing.screen)
                .padding(.vertical, Spacing.xs)
                .frame(width: width)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            controls
                .frame(maxWidth: Self.controlsMaxWidth)
                .padding(.horizontal, Spacing.screen)
                .padding(.top, Spacing.sm)
                .padding(.bottom, Spacing.xs)
                .frame(width: width)
        }
        .background(ScreenBackground())
    }

    /// Loading, buffering, the download in flight and the banner slot, over either arrangement.
    @ViewBuilder
    private var statusLayers: some View {
        ZStack {
            if player.isLoading {
                LoadingView(label: "Preparing audio")
                    .background(palette.bg0Color.opacity(0.6))
            }

            // Starved but armed: AVFoundation re-arms the item itself, so this
            // is a spinner over a live player, not a failure.
            if player.isBuffering {
                LoadingView(label: "Buffering")
                    .background(palette.bg0Color.opacity(0.4))
            }

            // The state that was invisible during #2409: this book's download
            // is in flight over the same link the stream is buffering on, so
            // say so rather than leaving the listener to infer it from the
            // rebuffering. Top overlay, so it sits clear of the banner slot.
            if let record = activeDownload {
                VStack {
                    DownloadProgressView(
                        record: record,
                        activity: downloads.activity(of: record),
                        showsParts: false
                    )
                    .padding(.horizontal, Spacing.md)
                    .padding(.top, Spacing.sm)
                    Spacer(minLength: 0)
                }
            }

            if let message = player.error {
                // Takes the banner slot ahead of the offers: an offer to jump
                // somewhere is noise while nothing is playing.
                PlaybackErrorBanner(message: message) { player.play() }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else if let offer = player.syncOffer {
                SyncOfferBanner(
                    title: "Listened further elsewhere",
                    detail: "Another device left off at \(Format.duration(offer)).",
                    onGo: { Task { await player.acceptSyncOffer() } },
                    onDismiss: { player.dismissSyncOffer() }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
            } else if let cross = player.crossFormatOffer,
                      let seconds = cross.audioPositionSeconds {
                SyncOfferBanner(
                    title: cross.sourceAhead == false
                        ? "Re-reading earlier in the ebook"
                        : "Read further in the ebook",
                    detail: "Your reading maps to about \(Format.duration(seconds)).",
                    onGo: { Task { await player.acceptCrossFormatOffer() } },
                    onDismiss: { Task { await player.dismissCrossFormatOffer() } }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    /// A blurred, saturated wash of the cover behind the controls.
    ///
    /// The tone bloom sits under the artwork rather than instead of it: a book
    /// with no cover art used to get a flat black player while the book itself
    /// was drawn in its own colour everywhere else in the app, and a cover that
    /// is mostly dark washed out to the same black.
    private var backdrop: some View { backdrop(bloom: UnitPoint(x: 0.5, y: 0.32)) }

    /// `bloom` is where the tone glows from: behind the artwork, wherever it stands.
    private func backdrop(bloom: UnitPoint) -> some View {
        let tone = CoverIdentity(book).tone

        return ZStack {
            palette.bg0Color

            RadialGradient(
                colors: [
                    OKLCH(0.45, max(0.06, tone.c) * 1.05, tone.h).color,
                    OKLCH(0.24, tone.c * 0.7, tone.h).color.opacity(0.5),
                    .clear,
                ],
                center: bloom,
                startRadius: 0,
                endRadius: 460
            )

            if book.coverURL != nil {
                // Held inside a flexible `Color` rather than sat in the stack
                // directly. An aspect-*fill* image reports a size bigger than
                // the box it fills — that is what filling means — and as a bare
                // `ZStack` sibling that grew the stack past the screen, at which
                // point `safeAreaInset` hung the top bar under the status bar and
                // pushed the utility row's labels off the bottom edge. An
                // overlay can't grow its parent, which is the same reason
                // `BookCover` puts its art in one.
                //
                // Only books with real artwork could hit it; a generated plate
                // is gradients all the way down, and those are flexible.
                Color.clear
                    .overlay {
                        RemoteImage(path: "/api/thumbs/\(book.uuid)/md") { Color.clear }
                            .blur(radius: 70, opaque: true)
                            .saturation(1.5)
                            .opacity(0.4)
                    }
                    .clipped()
            }

            LinearGradient(
                colors: [palette.bg0Color.opacity(0.2), palette.bg0Color],
                startPoint: .top, endPoint: .bottom
            )
        }
        .ignoresSafeArea()
    }

    /// Artwork and titles, in the band the two insets leave.
    ///
    /// The cover takes a definite share of that band rather than *being* what's
    /// left of it. As the remainder it resized between books — a title that
    /// wrapped to two lines cost it 30pt of height — and on a short phone it
    /// drove both spacers to zero, so the artwork sat wedged against the
    /// scrubber with no margin anywhere on the screen.
    private var stage: some View {
        GeometryReader { band in
            VStack(spacing: Spacing.md) {
                Spacer(minLength: 0)
                cover(maxHeight: max(140, band.size.height * Self.coverShare(in: band.size.height)))
                titles
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(.horizontal, Spacing.screen)
        // The whole band takes the drag, not just the artwork.
        .contentShape(Rectangle())
        .gesture(dismissGesture)
    }

    /// Swipe down to minimize into the mini bar, the gesture the top bar's
    /// `chevron.down` has always advertised.
    ///
    /// Deliberately scoped to `stage`: `controls` carries the scrubber, whose
    /// own `DragGesture(minimumDistance: 0)` owns every touch in its band, and
    /// a dismiss gesture reaching over it would turn a seek into a dismissal.
    private var dismissGesture: some Gesture {
        DragGesture(minimumDistance: PlayerDismissDrag.minimumDistance)
            .onChanged { value in
                dismissDrag = PlayerDismissDrag.offset(for: value.translation)
            }
            .onEnded { value in
                let minimize = PlayerDismissDrag.shouldDismiss(
                    translation: value.translation,
                    predictedEnd: value.predictedEndTranslation
                )
                if minimize {
                    // Left where the finger dropped it: the presentation's own
                    // dismissal carries it the rest of the way, and snapping
                    // back to zero first would read as a bounce.
                    dismiss()
                } else if reduceMotion {
                    // Following the finger is direct manipulation, so Reduce
                    // Motion leaves that alone; the spring back is the
                    // animation it asks us to drop.
                    dismissDrag = 0
                } else {
                    withAnimation(Motion.glide) { dismissDrag = 0 }
                }
            }
    }

    private var topBar: some View {
        HStack(spacing: Spacing.md) {
            circleButton("chevron.down", label: "Minimize player") { dismiss() }

            Spacer()

            // Countdown only while time actually remains, mirroring the web
            // pill — an end-of-chapter timer armed at the boundary shows
            // nothing rather than a frozen 0:00.
            if let remaining = player.sleepRemainingSeconds, remaining > 0 {
                Label(Format.duration(Double(remaining)), systemImage: "moon.zzz.fill")
                    .font(.ui(12, weight: .medium))
                    .foregroundStyle(palette.accentColor)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(palette.bg2Color))
            }

            if book.hasEbook {
                circleButton("book", label: "Read the ebook") { Presentation.shared.openReader(book) }
            }
            circleButton("bookmark", label: "Bookmarks") { showBookmarks = true }
        }
        .frame(height: Self.topBarHeight)
    }

    private func circleButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(palette.ink1Color)
                .frame(width: 38, height: 38)
                .background(Circle().fill(palette.bg2Color))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    /// Takes the whole `CoverIdentity`, accent included, so the generated plate
    /// can't disagree with the wash `backdrop` derives from the same book.
    private func cover(maxHeight: CGFloat) -> some View {
        BookCover(identity: CoverIdentity(book), size: .lg, cornerRadius: Radius.lg)
            .frame(maxWidth: 300, maxHeight: maxHeight)
            .shadow(color: .black.opacity(0.5), radius: 28, x: 0, y: 16)
            .scaleEffect(player.isPlaying ? 1 : 0.94)
            .animation(Motion.glide, value: player.isPlaying)
    }

    private var titles: some View {
        VStack(spacing: 4) {
            Text(book.displayTitle)
                .font(.display(28))
                .foregroundStyle(palette.ink0Color)
                .multilineTextAlignment(.center)
                .lineLimit(2)
            Text(book.authorDisplay)
                .font(.ui(14))
                .foregroundStyle(palette.ink2Color)
                .lineLimit(1)
        }
    }

    // MARK: - Controls

    /// Chapter, scrubber and transport read as one block; the utility row is a
    /// separate one, so its gap is the widest here. At the same `sm` step as
    /// the rest, the play disc — 74pt inside a 78pt row — came within 14pt of
    /// the Speed glyph and the whole bottom of the screen read as smushed.
    private var controls: some View {
        VStack(spacing: 0) {
            chapterRow
            scrubber
                .padding(.top, Spacing.sm)
            transport
                .padding(.top, Spacing.sm)
            utilityRow
                .padding(.top, Spacing.xl)
        }
    }

    /// The chapter name, above the scrubber and tappable straight into the
    /// chapter list. It carries the most weight of anything down here because
    /// "where am I" is a chapter name before it's a timestamp.
    @ViewBuilder
    private var chapterRow: some View {
        if let chapter = player.currentChapter {
            Button { showChapters = true } label: {
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "list.bullet")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(palette.ink2Color)
                    Text(chapter.title)
                        .font(.ui(17, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .frame(height: 38)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    /// Scoped to the current chapter: one bar width is one chapter, which is the
    /// span you can actually aim inside — on a twelve-hour book a whole-book bar
    /// puts every chapter boundary within a couple of points of its neighbours.
    ///
    /// A book with no chapter marks falls back to the whole book, which is what
    /// `chapterStart` / `chapterDuration` report in that case.
    private var scrubber: some View {
        VStack(spacing: Spacing.xs) {
            PlayerScrubber(
                fraction: displayedOffset / spanUpperBound,
                tint: palette.accentColor,
                onScrub: { scrubOffset = $0 * spanUpperBound },
                onCommit: { target in
                    let seconds = target * spanUpperBound
                    scrubOffset = seconds
                    Task {
                        await player.seekWithinChapter(to: seconds)
                        scrubOffset = nil
                    }
                }
            )

            // Chapter elapsed, book remaining, chapter remaining — all three at
            // once. The middle one is the whole-book context that a
            // chapter-scoped bar would otherwise cost you.
            //
            // The position is BOOK time; only the two "left" figures are
            // rate-adjusted wall clock. That is the convention #2344 settled
            // on the web (superseding #2246, which had rescaled positions
            // too), and iOS was still on the old one: at 1.5x this readout
            // said 22:57 into a chapter its own contents panel called
            // 1:16:11, and disagreed with every bookmark stamp (#2521).
            HStack(spacing: Spacing.sm) {
                Text(Format.duration(displayedOffset))
                    .frame(maxWidth: .infinity, alignment: .leading)

                if player.hasChapters {
                    Text(Format.humanDuration(Int64(Format.atRate(bookRemaining, rate: player.rate))) + " left")
                }

                Text(chapterRemainingLabel)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .font(.ui(12))
            .monospacedDigit()
            .foregroundStyle(palette.ink2Color)
            .frame(height: 16)
        }
    }

    /// What the thumb and the left readout should show: the drag in flight when
    /// there is one, otherwise where playback actually is.
    private var displayedOffset: Double {
        min(scrubOffset ?? player.chapterOffset, spanUpperBound)
    }

    /// The span is 0 until the asset resolves, and it divides the scrubber's
    /// fraction, so the upper bound never drops below one second.
    private var spanUpperBound: Double {
        max(player.chapterDuration, 1)
    }

    private var bookRemaining: Double {
        max(0, player.duration - (player.chapterStart + displayedOffset))
    }

    private var chapterRemainingLabel: String {
        // Rate-adjusted: "time left" is what the listener will wait through,
        // not the 1x runtime of the rest of the chapter.
        let left = Format.atRate(max(0, player.chapterDuration - displayedOffset), rate: player.rate)
        // No sign at the end of a chapter: "-0:00" reads as a broken clock.
        // Named, not just signed: it sits beside a book-time position, and a
        // bare "- 27:51" gives a listener no way to tell the two apart.
        return left < 1 ? "0:00 left" : Format.duration(left) + " left"
    }

    /// Five slots: chapter back, skip back, play/pause, skip forward, chapter
    /// forward. The play disc is intrinsically sized rather than taking an equal
    /// fifth, so the four steppers split what's left and it can't be squeezed.
    private var transport: some View {
        HStack(spacing: 0) {
            transportButton("backward.end.fill", size: 26, enabled: player.canGoPreviousChapter) {
                player.previousChapter()
            }
            transportButton("gobackward.15", size: 32) { player.skip(-RemoteTransport.backSeconds) }

            Button { player.toggle() } label: {
                // Solid rather than hierarchical: hierarchical renders the disc
                // at a fraction of the ink, which left the one control the
                // thumb reaches for as the dimmest thing in the transport.
                Image(systemName: player.isPlayingOrStarting ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 74))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(palette.bg0Color, palette.ink0Color)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.plain)

            transportButton("goforward.30", size: 32) { player.skip(RemoteTransport.forwardSeconds) }
            transportButton("forward.end.fill", size: 26, enabled: player.canGoNextChapter) {
                player.nextChapter()
            }
        }
        .frame(height: 78)
    }

    private func transportButton(
        _ icon: String, size: CGFloat, enabled: Bool = true, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size))
                .foregroundStyle(enabled ? palette.ink0Color : palette.ink3Color)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    /// Speed · Car Mode · Sleep · Bookmark. Every entry is a plain `Button`
    /// driving a sheet or a cover — a `Menu` here silently dropped out of
    /// the row.
    private var utilityRow: some View {
        HStack(spacing: 0) {
            utilityCell("Speed") { showSpeed = true } glyph: {
                // The rate reads as the icon, so the current speed is legible
                // without opening anything.
                Text(Format.rate(player.rate)).font(.ui(19, weight: .semibold))
            }
            utilityCell("Car Mode") { showCarMode = true } glyph: {
                Image(systemName: "car").font(.system(size: 22))
            }
            utilityCell("Sleep") { showSleepTimer = true } glyph: {
                Image(systemName: "moon.zzz").font(.system(size: 22))
            }
            utilityCell("Bookmark") { addBookmark() } glyph: {
                Image(systemName: "bookmark").font(.system(size: 22))
            }
            // "Synced here" (rule 08: direct call, disabled offline) —
            // dual-format books only; others have nothing to pair with.
            if book.hasEbook {
                utilityCell(syncedHere ? "Synced ✓" : "Sync here") {
                    guard Connectivity.shared.isOnline else { return }
                    Task { syncedHere = await player.declareSyncPoint() }
                } glyph: {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 22))
                }
                .opacity(Connectivity.shared.isOnline ? 1 : 0.4)
            }
        }
    }

    private func utilityCell<Glyph: View>(
        _ label: String,
        action: @escaping () -> Void,
        @ViewBuilder glyph: () -> Glyph
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                glyph()
                    .frame(height: 26)
                Text(label)
                    .font(.ui(11))
                    .lineLimit(1)
            }
            .foregroundStyle(palette.ink2Color)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func addBookmark() {
        guard let bookmark = player.addBookmark() else { return }
        Task {
            await bookmark.value
            Haptics.success()
        }
    }
}


// MARK: - Chapter sheet

private struct ChapterSheet: View {
    @Environment(AudioPlayer.self) private var player
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                // Keyed on position rather than `ordinal`: the ordinal comes out
                // of the audio container and isn't guaranteed unique, which a
                // `List` id has to be.
                List(Array(player.chapters.enumerated()), id: \.offset) { index, chapter in
                    row(index: index, chapter: chapter)
                        .listRowBackground(palette.bg1Color)
                        .id(index)
                }
                .scrollContentBackground(.hidden)
                .background(palette.bg0Color)
                .onAppear {
                    guard let current = player.currentChapterIndex else { return }
                    proxy.scrollTo(current, anchor: .center)
                }
            }
            .navigationTitle("Chapters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        // Full height, matching the reader's contents sheet — same job, and a
        // half-height sheet shows four rows of a book that can have a hundred
        // chapters, which is not enough to navigate by.
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func row(index: Int, chapter: ChapterInfo) -> some View {
        let isCurrent = player.currentChapterIndex == index

        return Button {
            player.seekToChapter(chapter)
            dismiss()
        } label: {
            HStack(spacing: Spacing.md) {
                Text("\(index + 1)")
                    .font(.monoUI(12))
                    .foregroundStyle(isCurrent ? palette.accentColor : palette.ink3Color)
                    .frame(width: 24, alignment: .trailing)

                VStack(alignment: .leading, spacing: 5) {
                    Text(chapter.title)
                        .font(.ui(15, weight: isCurrent ? .semibold : .regular))
                        .foregroundStyle(isCurrent ? palette.ink0Color : palette.ink1Color)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    // Only the chapter you're in gets a bar. On the others the
                    // number that answers "should I start this now?" is how
                    // long it runs, which is the column on the right.
                    if isCurrent {
                        ProgressBar(fraction: fraction, tint: palette.accentColor, height: 2)
                            .frame(height: 2)
                    }
                }

                Spacer(minLength: Spacing.sm)

                Text(Format.duration(player.chapterLength(at: index)))
                    .font(.monoUI(11))
                    .foregroundStyle(palette.ink3Color)
            }
            .padding(.vertical, 3)
            // Without this only the drawn glyphs take the tap, so the gap
            // between a short chapter title and its duration was dead — the row
            // looked tappable across its width and wasn't.
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var fraction: Double {
        guard player.chapterDuration > 0 else { return 0 }
        return min(1, max(0, player.chapterOffset / player.chapterDuration))
    }
}

// MARK: - Mini player

/// Sits directly above the tab bar. It supplies its own material and rule —
/// as a plain view in the bar stack it no longer inherits the chrome the
/// system accessory slot used to provide, and without them the page scrolls
/// visibly through it.
struct MiniPlayerBar: View {
    @Environment(AudioPlayer.self) private var player
    @Environment(\.palette) private var theme
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    /// Toned from the book that is *playing*, not the screen the bar is docked
    /// on — the bar outlives any one screen, and a rail in the library's accent
    /// would disagree with the player it expands into.
    private var palette: Palette {
        guard let book = player.book else { return theme }
        return theme.accented(byCoverOf: book)
    }

    /// Overrides what tapping the bar body does. The default expands into the
    /// app-global full-screen player; the reader passes its own handler so the
    /// book underneath stays open.
    var onExpand: (() -> Void)? = nil
    /// Drawn in the system tab bar's accessory slot, which lays its own glass
    /// capsule under it: no rule, material or rail, and the position as a ring
    /// round the play button instead.
    var inAccessory = false

    /// Width the cover is pinned to in the accessory's shorter capsule.
    private static let accessoryCoverWidth: CGFloat = 24
    /// The docked row's cover and padding on a short screen, a phone on its
    /// side, where the full bar took a fifth of the height from the page.
    private static let shortCoverWidth: CGFloat = 26
    private static let shortRowVerticalPadding: CGFloat = 5
    /// The ring round the accessory's play button.
    private static let ringDiameter: CGFloat = 30

    /// Height of the hairline progress rail along the top edge.
    private static let progressRailHeight: CGFloat = 2
    /// Top and bottom padding around the button row's content.
    private static let buttonRowVerticalPadding: CGFloat = 9
    /// Width the cover is pinned to in the button row.
    private static let coverWidth: CGFloat = 34
    /// `BookCover`'s fixed width:height aspect (see `BookCover`'s
    /// `.aspectRatio(2.0 / 3.0, contentMode: .fit)`) — the cover is the
    /// button row's tallest element, so this is what actually sets its height.
    private static let coverAspectRatio: CGFloat = 2.0 / 3.0

    /// The bar's own on-screen height, derived from the same constants its
    /// `body` lays out with — the progress rail, the button row's vertical
    /// padding, and the cover's height at its fixed aspect ratio — so a later
    /// tweak to any of those moves this with it instead of drifting out of
    /// sync. Screens that reserve their own clearance for the docked bar
    /// rather than trusting an ancestor `safeAreaInset` to reach them (see
    /// `BookDetailView`, #1482) use this.
    static let reservedHeight: CGFloat =
        progressRailHeight
        + buttonRowVerticalPadding * 2
        + coverWidth / coverAspectRatio

    var body: some View {
        if let book = player.book {
            if inAccessory { accessoryRow(book) } else { dockedBar(book) }
        }
    }

    private var isShort: Bool { verticalSizeClass == .compact }

    /// Whole-book progress, which the player's own chapter-scoped bar doesn't show.
    private var fraction: Double {
        player.duration > 0 ? min(1, max(0, player.position / player.duration)) : 0
    }

    private func expand(_ book: Book) {
        // The file already playing, so expanding cannot reload it.
        if let onExpand {
            onExpand()
        } else {
            Presentation.shared.openPlayer(book, fileID: player.fileID)
        }
    }

    private func accessoryRow(_ book: Book) -> some View {
        Button { expand(book) } label: {
            // A narrow capsule gives up the skip back before the title.
            ViewThatFits(in: .horizontal) {
                accessoryContent(book, skips: true)
                accessoryContent(book, skips: false)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func accessoryContent(_ book: Book, skips: Bool) -> some View {
        HStack(spacing: 10) {
            BookCover(identity: CoverIdentity(book), size: .sm, cornerRadius: 3)
                .frame(width: Self.accessoryCoverWidth)

            VStack(alignment: .leading, spacing: 0) {
                Text(book.displayTitle)
                    .font(.ui(13, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(1)
                Text(player.currentChapter?.title ?? book.authorDisplay)
                    .font(.ui(10.5))
                    .foregroundStyle(palette.ink3Color)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if skips {
                control("gobackward.15") { player.skip(-RemoteTransport.backSeconds) }
            }
            ringedToggle
            control("xmark") { player.close() }
                .accessibilityLabel("Stop playback")
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
    }

    /// Play or pause inside a ring that fills with the book.
    private var ringedToggle: some View {
        Button { player.toggle() } label: {
            Image(systemName: player.isPlayingOrStarting ? "pause.fill" : "play.fill")
                .font(.system(size: 12))
                .foregroundStyle(palette.ink0Color)
                .frame(width: Self.ringDiameter, height: Self.ringDiameter)
                .overlay {
                    Circle().stroke(palette.ink0Color.opacity(0.16), lineWidth: 2)
                    Circle()
                        .trim(from: 0, to: fraction)
                        .stroke(palette.accentColor, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(player.isPlayingOrStarting ? "Pause" : "Play")
    }

    private func dockedBar(_ book: Book) -> some View {
        VStack(spacing: 0) {
            // A hairline of progress along the top edge — the only place
            // position is visible without opening the player. Whole-book,
            // deliberately: the player's own bar is chapter-scoped, so this
            // is where the other half of the picture lives.
            ProgressBar(fraction: fraction, tint: palette.accentColor, height: Self.progressRailHeight)
                // Edge to edge like the bar's material, past a side column or sensor inset.
                .ignoresSafeArea(.container, edges: .horizontal)

            Button { expand(book) } label: {
                HStack(spacing: 11) {
                    BookCover(identity: CoverIdentity(book), size: .sm, cornerRadius: 4)
                        .frame(width: isShort ? Self.shortCoverWidth : Self.coverWidth)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(book.displayTitle)
                            .font(.ui(13.5, weight: .semibold))
                            .foregroundStyle(palette.ink0Color)
                            .lineLimit(1)
                        Text(player.currentChapter?.title ?? book.authorDisplay)
                            .font(.ui(11))
                            .foregroundStyle(palette.ink3Color)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 0)

                    control("gobackward.15") { player.skip(-RemoteTransport.backSeconds) }
                    control(player.isPlayingOrStarting ? "pause.fill" : "play.fill") { player.toggle() }
                    // The bar had no way out, so `close()` — which is what
                    // flushes the position and reports the listening
                    // session — was unreachable and never ran.
                    control("xmark") { player.close() }
                        .accessibilityLabel("Stop playback")
                }
                .padding(.horizontal, Spacing.screen)
                .padding(.vertical, isShort ? Self.shortRowVerticalPadding : Self.buttonRowVerticalPadding)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .background(palette.bg1Color.opacity(0.92))
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) {
            Rectangle().fill(palette.line2.color).frame(height: 0.5)
        }
    }

    private func control(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 17))
                .foregroundStyle(palette.ink0Color)
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
