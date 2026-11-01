//  AudioPlayer.swift
//  AVPlayer-backed audiobook playback.
//
//  Replaces the WebView's hls.js path entirely: AVPlayer speaks HLS natively,
//  and routing through `MPNowPlayingInfoCenter` / `MPRemoteCommandCenter` gets
//  lock-screen, Control Center, AirPlay, and CarPlay transport for free —
//  none of which the hybrid build could offer.

import AVFoundation
import Combine
import MediaPlayer
import Observation
import OSLog
import SwiftUI

/// Each remote seek command as it arrives. A car's buttons can't be watched any
/// other way, and this says whether a press reached a seek handler at all.
private let remoteCommandLog = Logger(subsystem: "com.omnibus.mobile", category: "RemoteCommands")

/// Sleep-timer state, mirroring the web mobile player's `SleepState` so the
/// two clients' sleep sheets offer the same contract.
enum SleepTimer: Equatable {
    case off
    /// Wall-clock countdown: `remaining` seconds tick down once per second;
    /// `preset` is the option (in seconds) that armed it, for the sheet
    /// highlight.
    case countdown(remaining: Int, preset: Int)
    /// Pause when playback reaches `atSeconds` (the current chapter's end at
    /// arm time).
    case endOfChapter(atSeconds: Double)
}

@Observable
@MainActor
final class AudioPlayer {
    static let shared = AudioPlayer()

    /// The cross-format candidate on offer ("you read further"), shown by
    /// the same banner slot as [`syncOffer`].
    private(set) var crossFormatOffer: CrossFormatCandidate?

    private(set) var book: Book?
    private(set) var manifest: AudiobookManifest?
    /// The `book_files` row playback was built against. Resolved on load —
    /// an explicit pick, else the file the saved position was taken in, else
    /// the server's default — and carried on every position write so a
    /// resume reopens this file rather than the book's first one.
    private(set) var fileID: Int64?
    private(set) var isPlaying = false
    /// What a play/pause control draws and does: playing, or a start still owed
    /// that a press takes back. `isPlaying` alone says whether there is audio.
    var isPlayingOrStarting: Bool { pendingStarts.togglePauses(isPlaying: isPlaying) }
    /// Whether a load is still awaiting its item and opening position.
    var isLoading: Bool { loadingGeneration != nil }
    /// The generation of the load in flight. Not a flag: a load superseded by
    /// another still runs to its end, and must not mark the newer one done.
    private var loadingGeneration: Int?
    private(set) var duration: Double = 0
    /// Whether the loaded item reads from the network rather than from
    /// downloaded files. Downloads stand down while this and `isPlaying` are
    /// both true — they share the phone's uplink (#2409).
    private(set) var isStreaming = false
    private(set) var error: String?
    /// Automatic read-status transitions for the loaded book — the same
    /// tracker the readers use, so listening and reading move a book through
    /// the lifecycle identically. Rebuilt on every load; `nil` between books.
    private var autoStatus: ReadStatusAuto?
    /// Whether this load has already claimed the `unread` → `reading`
    /// transition. `play()` runs on every resume from pause; the book is only
    /// started once.
    private var markedReading = false

    /// Current position on the whole-book timeline, in seconds.
    var position: Double = 0

    var rate: Double = 1.0 {
        didSet {
            guard rate != oldValue, !isAdoptingRate else { return }
            if isPlaying { player?.rate = Float(rate) }
            Task { await persistRate() }
        }
    }

    /// Set while a rate that came *out* of storage is being applied, so the
    /// `didSet` above doesn't write it straight back.
    ///
    /// `rate` is a preference the listener sets, and the `didSet` is how that
    /// reaches the server — but `load` assigns to the same property, and `rate`
    /// is singleton state that `teardown` leaves alone, so opening a second
    /// book fired it with the first book's value still in `oldValue`. Online
    /// that was a redundant echo of what had just been read. Offline it was
    /// destructive: with no cached rate for the new book, `loadRate` falls back
    /// to 1.0, and the echo queued a write that reset a speed the listener had
    /// set on another device to 1.0 the moment the device reconnected.
    private var isAdoptingRate = false

    /// Sleep-timer state; `.off` when disarmed.
    private(set) var sleepTimer: SleepTimer = .off

    /// A further position another device reached, waiting on the listener to
    /// accept it. Never applied on its own.
    private(set) var syncOffer: Double?

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    /// Item-scoped health observers. Rebuilt with every item — including the
    /// replacements `recoverFromFailure` installs — so they always describe
    /// the item actually loaded rather than the one that failed.
    private var itemStatusObservation: NSKeyValueObservation?
    private var stallObserver: NSObjectProtocol?
    private var failedToEndObserver: NSObjectProtocol?
    /// Player-scoped, so it survives an item swap.
    private var timeControlObservation: NSKeyValueObservation?
    private var health = PlaybackHealth()
    private var recoveryTask: Task<Void, Never>?

    /// Starts owed but not yet made: a recovery, load or remote resume that
    /// will start playing when it lands, or a pause or start a call holds
    /// until it ends.
    ///
    /// A rebuild backs off for a second or more before it resumes, and the
    /// listener may well press pause inside that window — having given up on a
    /// book that just went silent. Without this, the recovery landed and
    /// started playing anyway, overriding a deliberate pause. Any pause of the
    /// listener's own clears every one; a play, in the app or from outside it,
    /// clears a call's hold and re-arms the start of a load or resume still in
    /// flight.
    private var pendingStarts = PendingStarts()
    private var interruptionObserver: NSObjectProtocol?
    private var routeChangeObserver: NSObjectProtocol?
    /// Whether a play with no player to start is still finding the book to
    /// load, so a second press can't load it twice. Cleared as the load takes
    /// the start over.
    private var isFindingLoad = false
    /// Set by a resume a call is holding, right before the `load` it asks for,
    /// which consumes it: that load's autoplay waits for the call to end.
    private var callHoldsNextLoad = false
    /// What the loaded book was asked to open with, so a play after its load
    /// failed loads the same again — the resume point and file included.
    private var loadRequest: LoadRequest?

    /// Whether the item is alive but starved. Distinct from `isPlaying`,
    /// which stays true across a buffering stall — the listener has not
    /// paused anything, the data just hasn't arrived.
    private(set) var isBuffering = false
    private var sleepTask: Task<Void, Never>?
    private var sessionStart: Date?
    private var listenedSeconds: Double = 0
    /// Governs whether a tick is also pushed over the network, on top of the
    /// unconditional local write every one of them gets (#1666). No echoed
    /// restore position to suppress here — ticks begin only once real
    /// playback has resumed — so it opts out of `suppressFirst`.
    private var pushThrottle = PositionPushThrottle(interval: 5, suppressFirst: false)

    /// Governs how often listening also rebuilds the Home Screen snapshot.
    ///
    /// The widget is the one surface that keeps rendering a position after the
    /// app stops running — `LifecycleSync.didEnterBackground` refreshes it once
    /// on the way out, and playback then carries on behind the lock screen for
    /// however long the listener keeps going, with nothing rewriting the
    /// snapshot. That is the drift between the in-app player and the Home
    /// Screen (#2421). A minute is coarse enough that the replica read and the
    /// rail pull behind `refresh()` stay off the playback path, and fine enough
    /// that a glance at the Home Screen agrees with the transport.
    private var widgetThrottle = PositionPushThrottle(interval: 60, suppressFirst: false)

    /// Whether the opening position has been settled against the server.
    ///
    /// The periodic observer starts firing as soon as the player has an item,
    /// and every write it makes carries a clock newer than anything already
    /// stored — so a write made before this is true would push a position the
    /// reconcile was still in the middle of correcting, and win.
    private var positionSettled = false

    /// Count of `seek(to:)` calls currently awaiting AVPlayer, incremented
    /// before the frame-accurate seek starts and decremented once it
    /// resolves — a count rather than a flag so two overlapping seeks (a
    /// second tap landing before the first settles) can't have the first
    /// one's completion re-arm the observer while the second is still in
    /// flight.
    ///
    /// `seek(to:)` sets `position` optimistically before awaiting AVPlayer,
    /// but the periodic time observer below fires regardless, on the
    /// player's *actual* (pre-seek) time — unguarded, it would overwrite the
    /// optimistic value right back to stale on its very next 0.5s tick,
    /// which for a seek that takes longer than that to settle (HLS
    /// especially) reintroduces the exact staleness the optimism was meant
    /// to close (#1746). The observer checks this count and skips its write
    /// while it's nonzero.
    private var pendingSeekCount = 0

    /// Bumped by every `teardown()` — a book switch or `close()`. A
    /// `seek(to:)` in flight when that happens is abandoned: its `player`
    /// local still resolves once AVPlayer gets around to it, but by then
    /// `pendingSeekCount` belongs to whatever book loaded next. Each seek
    /// captures the generation live when it started and only decrements the
    /// count if that generation is still current, so an orphaned seek's late
    /// completion can't under- or over-count the next book's own in-flight
    /// seeks. `teardown()` separately zeroes the count itself — without that,
    /// a seek abandoned mid-flight would leave it permanently elevated, since
    /// this guard is precisely what stops that seek from ever decrementing it.
    private var loadGeneration = 0

    /// Chapter geometry for the book that's open. Rebuilt once per load — every
    /// lookup on it runs off a half-second time observer, so it can't afford to
    /// re-sort per tick.
    private(set) var timeline = ChapterTimeline()

    private init() {
        configureRemoteCommands()
        observeAudioSession()
    }

    var isActive: Bool { book != nil }

    // MARK: - Chapters

    var chapters: [ChapterInfo] { timeline.chapters }

    var hasChapters: Bool { !timeline.isEmpty }

    var currentChapterIndex: Int? { timeline.index(at: position) }

    var currentChapter: ChapterInfo? { timeline.chapter(at: position) }

    /// Start of the span the scrubber covers: the current chapter, or the whole
    /// book when there are no chapters to scope it to.
    var chapterStart: Double { timeline.span(at: position).start }

    /// Length of that span.
    var chapterDuration: Double { timeline.span(at: position).duration }

    /// How far into the span playback has got.
    var chapterOffset: Double { max(0, position - chapterStart) }

    func chapterLength(at index: Int) -> Double { timeline.length(at: index) }

    var canGoNextChapter: Bool {
        guard let index = currentChapterIndex else { return false }
        return index + 1 < timeline.count
    }

    /// Previous is available in the first chapter too — there it restarts,
    /// which is the verb the button has in every other player.
    var canGoPreviousChapter: Bool { hasChapters }

    // MARK: - Loading

    /// `known` is a position the caller already holds — a resume point — and
    /// competes on its clock with the replica's and the server's, so a cold
    /// replica can't open the book at the start.
    func load(
        book: Book, fileID requestedFileID: Int64? = nil, autoplay: Bool = true,
        known: ProgressRecord? = nil
    ) async {
        let heldByCall = callHoldsNextLoad
        callHoldsNextLoad = false
        // Re-opening the book that's already loaded should not restart it —
        // unless a different file of it was explicitly asked for. A `nil`
        // request means "whatever is right", and what's already playing is.
        // A failed item is not "already loaded". Returning early here and
        // calling `play()` set a rate on a dead player, which is what made a
        // force-quit the only way back (#2408) — so a re-open of the book
        // whose item has failed falls through and rebuilds it.
        if PlaybackHealth.canReuseLoadedItem(
            sameBook: self.book?.uuid == book.uuid,
            hasPlayer: player != nil,
            itemFailed: player?.currentItem?.status == .failed,
            sameFileRequested: requestedFileID == nil || requestedFileID == fileID
        ) {
            if autoplay, !isPlaying { play() }
            return
        }

        // Captured before `teardown`, which clears the book this session
        // belongs to. Sent without waiting — switching books shouldn't stall
        // behind a report for the one being left.
        if let pending = takePendingReport() {
            Task { await UserDataService.reportSessions([pending]) }
        }
        teardown()
        let generation = loadGeneration
        loadingGeneration = generation
        pendingStarts = PendingStarts.opening(load: generation, autoplay: autoplay, heldByCall: heldByCall)
        loadRequest = LoadRequest(book: book, fileID: requestedFileID, known: known)
        self.book = book
        autoStatus = ReadStatusAuto(uuid: book.uuid)
        markedReading = false
        // Backgrounding mid-chapter has to persist the position the same way
        // pausing does — the player keeps running behind the lock screen, so
        // "the app went away" is not the same event as "playback stopped".
        //
        // The session is checkpointed here too. Playback survives backgrounding,
        // so this is not the end of listening — but it is the last moment the
        // app is guaranteed to run before the system may kill it, and a report
        // covering only what has been listened to so far is exactly what makes
        // the eventual total right either way.
        LifecycleSync.shared.register(self) { [weak self] in
            await self?.persistPosition(force: true)
            await self?.checkpointSession()
        }
        LifecycleSync.shared.didOpenBook()
        error = nil
        position = 0
        duration = 0
        // The car and the lock screen hear of the start now, not when it lands.
        updateNowPlaying()

        // The default file, the offer's file match and `isDefaultFileSelected`
        // all read the book's files, which a resume point's mirror book lacks.
        let book = await Self.withFiles(book)
        guard generation == loadGeneration else { return }
        self.book = book

        // The saved position is read before the manifest because it also
        // names the file to open: an explicit pick wins, else the file the
        // position was taken in, else the server's default (first by
        // ordinal). Resolved up front — the manifest is built per file.
        let local = PositionSync.newest(
            await UserDataService.localProgress(uuid: book.uuid, format: .audio), known
        )
        fileID = requestedFileID ?? local?.bookFileID ?? book.audioFiles.first?.id

        do {
            let manifest = try await loadManifest(for: book)
            self.manifest = manifest
            let item = try await makeItem(for: manifest, uuid: book.uuid)

            let player = AVPlayer(playerItem: item)
            player.automaticallyWaitsToMinimizeStalling = true
            self.player = player

            if let total = manifest.totalDuration {
                duration = total
            } else if let assetDuration = try? await item.asset.load(.duration) {
                duration = assetDuration.seconds
            } else {
                duration = 0
            }
            if !duration.isFinite { duration = 0 }

            // Built after `duration`, not with the manifest: a chapter that ships
            // no length of its own measures to the next chapter's start, and the
            // last one has only the end of the book to measure to.
            timeline = ChapterTimeline(chapters: manifest.chapters, bookDuration: duration)

            adoptRate(await loadRate(uuid: book.uuid))

            // Where this book is up to, settled before a single frame plays.
            //
            // This used to read the replica and nothing else, which made the
            // player the one surface with no idea another device existed — and
            // not merely behind, but destructive: the periodic observer below
            // starts writing within half a second, stamped with a clock newer
            // than anything already on the server, so a position reached
            // elsewhere was overwritten by a stale local one before the
            // listener had heard a word. Reading first is what makes the
            // handoff work in the direction it was always claimed to.
            let remote = Task { @MainActor in
                await PositionSync.newerRemote(uuid: book.uuid, format: .audio, than: local)
            }
            let opening = await firstResult(of: remote, within: PositionSync.openDeadline) ?? local
            if let saved = opening?.audioPositionSeconds, saved > 1, matchesLoadedFile(opening) {
                await seek(to: saved)
            }
            // Only now may the observer write. Before this the position is
            // still 0 or a stale resume, and either would win on the wire.
            positionSettled = true

            observe(player: player)
            finishLoad(generation)
            // Only a start this load still owns: a disconnect or a call during
            // the awaits above cancels it, and a newer load owns its own.
            if pendingStarts.afterLoad == generation {
                pendingStarts.afterLoad = nil
                play()
            }
            updateNowPlaying()

            // Anything that lands after the deadline is not applied — yanking
            // the timeline out from under someone already listening is worse
            // than being behind — but it is offered, the same way the reader
            // offers it.
            offerLatePosition(from: remote, uuid: book.uuid)
            offerCrossFormat()
        } catch {
            finishLoad(generation)
            if pendingStarts.afterLoad == generation { pendingStarts.afterLoad = nil }
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            updateNowPlaying()
        }
    }

    /// Mark load `generation` done, unless a newer load has taken over.
    private func finishLoad(_ generation: Int) {
        guard loadingGeneration == generation else { return }
        loadingGeneration = nil
        pendingStarts.loadEnded()
    }

    /// `book` with its files, from the replica or the server; bare when
    /// neither has it.
    private static func withFiles(_ book: Book) async -> Book {
        guard book.bookFiles.isEmpty else { return book }
        return await LibraryService.firstBook(uuid: book.uuid) ?? book
    }

    /// Apply a rate that came out of storage without writing it back. See
    /// [`isAdoptingRate`].
    private func adoptRate(_ value: Double) {
        isAdoptingRate = true
        rate = value
        isAdoptingRate = false
    }

    /// Apply a rate audibly without persisting it — the speed slider's live
    /// drag path, where per-tick writes would spam the server. Pair with
    /// [`commitRate`] on drag end.
    func setRateLive(_ value: Double) {
        isAdoptingRate = true
        rate = value
        isAdoptingRate = false
        if isPlaying { player?.rate = Float(value) }
    }

    /// Persist the current rate — the drag-end commit for [`setRateLive`].
    func commitRate() {
        Task { await persistRate() }
    }

    /// The manifest for the resolved file, falling back to the server's
    /// default when a remembered id has gone stale — `book_files` rows churn
    /// on reindex, so a position saved before one can name a file the book
    /// no longer has.
    private func loadManifest(for book: Book) async throws -> AudiobookManifest {
        do {
            return try await LibraryService.audiobookManifest(uuid: book.uuid, fileID: fileID)
        } catch let error as APIError {
            guard case .http(status: 404, message: _) = error, fileID != nil else { throw error }
            fileID = book.audioFiles.first?.id
            return try await LibraryService.audiobookManifest(uuid: book.uuid)
        }
    }

    /// Whether a stored position belongs to the file being played. A record
    /// carrying no file id predates selection (or came from an older server)
    /// and applies to whatever is loaded — the pre-selection behaviour.
    private func matchesLoadedFile(_ record: ProgressRecord?) -> Bool {
        guard let recorded = record?.bookFileID, let fileID else { return true }
        return recorded == fileID
    }

    /// Whether the resolved file is the one the server picks with no
    /// `file_id` at all — the first audio file by ordinal. Answered `true`
    /// when the cached `Book` doesn't carry its files: refusing the local
    /// copy on missing data would break offline playback of a downloaded
    /// book, which is worse than opening a mis-remembered selection.
    private var isDefaultFileSelected: Bool {
        guard let fileID, let defaultID = book?.audioFiles.first?.id else { return true }
        return fileID == defaultID
    }

    /// Surface a position that landed after the open deadline, if it is still
    /// ahead of where this listener has got to.
    ///
    /// Applied silently it would be a seek out of nowhere, seconds into a
    /// chapter someone is already following. Left unmentioned it would be lost
    /// the moment this device's own position write goes out. So it is offered,
    /// and the offer is withdrawn on its own if the listener plays past it.
    private func offerLatePosition(from remote: Task<ProgressRecord?, Never>, uuid: String) {
        Task { @MainActor in
            guard let record = await remote.value,
                  let seconds = record.audioPositionSeconds,
                  book?.uuid == uuid,
                  matchesLoadedFile(record),
                  seconds > position + 1
            else { return }
            withAnimation(Motion.settle) { syncOffer = seconds }
        }
    }

    /// Take the offered position. Seeking is enough — the next periodic write
    /// carries it, and it now has this device's clock behind it.
    func acceptSyncOffer() async {
        guard let seconds = syncOffer else { return }
        dismissSyncOffer()
        await seek(to: seconds)
        await persistPosition(force: true)
    }

    /// Declining is as final as accepting: re-offering on the next tick would
    /// nag through the whole chapter.
    func dismissSyncOffer() {
        withAnimation(Motion.settle) { syncOffer = nil }
    }

    /// Fetch the cross-format candidate for the loaded book (best-effort
    /// network read; rule 08 — nothing here ever queues). Offered with the
    /// same banner mechanics as the same-format late-position offer, and
    /// only when the mapped file is the one playing — the candidate's
    /// seconds are within that file alone.
    func offerCrossFormat() {
        guard let uuid = book?.uuid else { return }
        Task { @MainActor in
            guard let resume = try? await UserDataService.crossFormatResume(uuid: uuid, target: .audio),
                  resume.state == .candidate,
                  let candidate = resume.candidate,
                  book?.uuid == uuid,
                  syncOffer == nil,
                  SyncPromptStore.fileMatches(
                      selected: fileID,
                      defaultID: book?.audioFiles.first?.id,
                      candidate: candidate.bookFileID
                  )
            else { return }
            if resume.follow == true, let seconds = candidate.audioPositionSeconds {
                // Follow mode: resolve-at-open — apply the mapped position
                // silently, no banner, no dismissal bookkeeping.
                await seek(to: seconds)
                return
            }
            let seen = await SyncPromptStore.dismissedClock(uuid: uuid, target: .audio)
            guard SyncPromptStore.shouldOffer(
                sourceClock: candidate.sourceClientUpdatedAt,
                dismissed: seen
            ) else { return }
            withAnimation(Motion.settle) { crossFormatOffer = candidate }
        }
    }

    /// "Synced here": declare the current listening position as a sync
    /// point (rule 08 — direct call, never queued; the control is disabled
    /// offline). Returns whether the declaration was accepted.
    func declareSyncPoint() async -> Bool {
        guard let uuid = book?.uuid else { return false }
        let decl = DeclareSyncPoint(
            bookUUID: uuid,
            format: .audio,
            ebookFraction: nil,
            audioBookFileID: fileID ?? book?.audioFiles.first?.id,
            audioSeconds: position
        )
        do {
            try await UserDataService.declareSyncPoint(decl)
            return true
        } catch {
            return false
        }
    }

    /// Bookmark where playback is, named after the chapter — the one-tap
    /// bookmark of the phone's player and the car's. `nil` with no book loaded.
    @discardableResult
    func addBookmark() -> Task<Void, Never>? {
        guard let book else { return nil }
        let bookmark = CreateBookmark(
            bookUUID: book.uuid, position: String(position), title: currentChapter?.title
        )
        return Task { _ = await UserDataService.createBookmark(bookmark) }
    }

    /// Take the cross-format offer: seek, then force a write so the jump
    /// carries this device's clock (the normal position path).
    func acceptCrossFormatOffer() async {
        guard let candidate = crossFormatOffer,
              let seconds = candidate.audioPositionSeconds
        else { return }
        await dismissCrossFormatOffer()
        await seek(to: seconds)
        await persistPosition(force: true)
    }

    /// Declining stores the source clock so the prompt re-arms only after
    /// the reading position advances. Never a progress write.
    func dismissCrossFormatOffer() async {
        if let candidate = crossFormatOffer, let uuid = book?.uuid {
            await SyncPromptStore.storeDismissedClock(
                candidate.sourceClientUpdatedAt,
                uuid: uuid,
                target: .audio
            )
        }
        withAnimation(Motion.settle) { crossFormatOffer = nil }
    }

    /// The saved playback rate, from the replica when the server can't be
    /// reached.
    ///
    /// This was a bare network read with a `1.0` fallback, so opening a
    /// downloaded audiobook offline silently threw away the speed the listener
    /// had set — while the *write* path queued correctly. Settled rather than
    /// live for the same reason as the manifest: the rate is applied to a
    /// player being built, not to a view that can update underneath itself.
    private func loadRate(uuid: String) async -> Double {
        let record: AudiobookPlaybackRateRecord? = try? await Cache.settled(
            CacheKey.playbackRate(uuid)
        ) {
            try await APIClient.shared.get("/api/audiobooks/\(uuid)/playback-rate")
        }
        guard let record else { return 1.0 }
        return min(3.0, max(0.5, record.playbackRate))
    }

    /// Whether the files on this device cover the whole of what `manifest`
    /// describes.
    ///
    /// The count is the whole check. `/download` serves one part per request,
    /// so a device can hold fewer files than the book has parts — and an item
    /// built from those physically ends at part 1 while the manifest-driven
    /// timeline still shows the whole book. Every resume or seek past that
    /// point clamped to the item's real end, fired
    /// `AVPlayerItemDidPlayToEndTime`, marked the book `finished`, and wrote
    /// the clamped position back over the real one.
    ///
    /// An HLS manifest never qualifies: it names no parts, so there is
    /// nothing to check a local copy against, and the book is one the server
    /// has to transcode as it plays anyway.
    nonisolated static func localCovers(manifest: AudiobookManifest, localFileCount: Int) -> Bool {
        guard case let .direct(parts, _, _) = manifest else { return false }
        return !parts.isEmpty && parts.count == localFileCount
    }

    /// Build the player item. A downloaded book plays from disk; a single
    /// part plays directly; multiple parts are stitched into one composition
    /// so the timeline and seeking stay continuous.
    private func makeItem(for manifest: AudiobookManifest, uuid: String) async throws -> AVPlayerItem {
        // The downloaded copy is the server's default file (the download
        // endpoint takes no file id), so it can only stand in for that
        // selection — any other file of the book streams.
        if isDefaultFileSelected {
            let local = DownloadManager.shared.localFiles(for: uuid, kind: .audio)
            if Self.localCovers(manifest: manifest, localFileCount: local.count) {
                isStreaming = false
                return try await item(from: local.map { AVURLAsset(url: $0) })
            }
        }
        isStreaming = true

        let headers = await APIClient.shared.authHeaders()
        let options: [String: Any] = headers.isEmpty ? [:] : ["AVURLAssetHTTPHeaderFieldsKey": headers]

        switch manifest {
        case let .hls(playlistURL):
            guard let url = await APIClient.shared.absoluteURL(playlistURL) else {
                throw APIError.notConfigured
            }
            return AVPlayerItem(asset: AVURLAsset(url: url, options: options))

        case let .direct(parts, _, _):
            guard !parts.isEmpty else { throw APIError.http(status: 404, message: "No audio parts.") }
            var assets: [AVURLAsset] = []
            for part in parts.sorted(by: { $0.ordinal < $1.ordinal }) {
                guard let url = await APIClient.shared.absoluteURL(part.url) else {
                    throw APIError.notConfigured
                }
                assets.append(AVURLAsset(url: url, options: options))
            }
            return try await item(from: assets)
        }
    }

    /// One player item spanning `assets` in order — a single asset plays as
    /// itself, several are stitched into a composition.
    ///
    /// A part that yields no audio track is an error rather than something to
    /// skip past. Dropping it silently produces exactly the item this whole
    /// change exists to prevent: one shorter than the book, whose real end
    /// arrives mid-timeline and reads as having finished it.
    private func item(from assets: [AVURLAsset]) async throws -> AVPlayerItem {
        guard let first = assets.first else {
            throw APIError.http(status: 404, message: "No audio parts.")
        }
        if assets.count == 1 { return AVPlayerItem(asset: first) }

        let composition = AVMutableComposition()
        guard let track = composition.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid
        ) else { throw APIError.http(status: 500, message: "Could not build the audio timeline.") }

        var cursor = CMTime.zero
        for asset in assets {
            guard let source = try await asset.loadTracks(withMediaType: .audio).first else {
                throw APIError.http(status: 500, message: "An audio part could not be read.")
            }
            let assetDuration = try await asset.load(.duration)
            try track.insertTimeRange(
                CMTimeRange(start: .zero, duration: assetDuration), of: source, at: cursor
            )
            cursor = CMTimeAdd(cursor, assetDuration)
        }
        return AVPlayerItem(asset: composition)
    }

    // MARK: - Transport

    /// Start playback — or, with a load in flight, owe it the start, and with
    /// a book whose load failed, load it again.
    func play() {
        pendingStarts.overruleCall()
        // Nothing to start yet: the load makes the start once it lands.
        if let loadingGeneration {
            pendingStarts.afterLoad = loadingGeneration
            updateNowPlaying()
            return
        }
        guard let player else {
            // A failed load leaves its book with no player and nothing in
            // flight, where a play would otherwise be a dead end.
            if let loadRequest { loadOwed(retrying: loadRequest) }
            return
        }
        // Setting a rate on a failed item does nothing at all — the silent
        // dead end #2408 is named for. A manual tap is also the listener
        // telling us to try again, and so is a call ending on a start it held,
        // so both refill the budget an automatic run may have spent before
        // giving up.
        if player.currentItem?.status == .failed {
            health.reset()
            error = nil
            pendingStarts.afterRecovery = true
            updateNowPlaying()
            recoverFromFailure(attempt: 1)
            return
        }
        startPlayback(on: player)
    }

    /// Start the transport on an item believed good.
    ///
    /// Split from `play()` so the automatic recovery path can reach it without
    /// passing through that method's failed-item branch. Going through `play()`
    /// there was an unbounded loop: `recoverFromFailure` awaits a seek, during
    /// which the rebuilt item can itself reach `.failed`, and `play()` would
    /// then reset the budget and start recovery over at attempt 1 forever.
    /// Automatic retries must stay inside `PlaybackHealth`'s budget; only a
    /// play the listener asked for refills it.
    private func startPlayback(on player: AVPlayer) {
        player.rate = Float(rate)
        isPlaying = true
        if sessionStart == nil { sessionStart = Date() }
        updateNowPlaying()
        publishStreamingState()
        // Listening to a book is starting it, the audio counterpart of the
        // readers' mark-on-open. Off the critical path — the fetch behind it
        // may cost a round trip and playback has already begun.
        if !markedReading {
            markedReading = true
            // Resolved now, not inside the task. Reading `self.autoStatus`
            // when the task eventually runs would pick up whatever `load`
            // has installed by then, marking a book the listener switched to
            // — and never played — as started.
            let tracker = autoStatus
            Task { await tracker?.bookOpened() }
        }
    }

    func pause() {
        // A pause during a rebuild's back-off or a load is the listener
        // overruling it.
        pendingStarts = PendingStarts()
        stopTransport()
    }

    /// Stop the transport and checkpoint, leaving `pendingStarts` to the caller.
    private func stopTransport() {
        player?.pause()
        isPlaying = false
        // Cleared here as well as from `timeControlStatus`: the observer is
        // asynchronous, and the overlay should go the moment the tap does.
        isBuffering = false
        updateNowPlaying()
        publishStreamingState()
        Task {
            await persistPosition(force: true)
            // Stopping is the one moment listening time is definitely complete.
            // Reporting only from `close()` meant reporting never — nothing
            // calls it — so every listening session this app has ever recorded
            // was lost and the stats screen counted audiobooks as zero.
            await checkpointSession()
            Presentation.shared.noteProgressPersisted()
        }
    }

    func toggle() {
        Haptics.tap()
        togglePlayback(start: play)
    }

    /// A press of play/pause, in the app or from outside it, which starts the
    /// way its caller does. Mid-load it pauses: `play()` would re-arm the start
    /// the listener means to cancel.
    private func togglePlayback(start: @MainActor () -> Void) {
        isPlayingOrStarting ? pause() : start()
    }

    func seek(to seconds: Double) async {
        guard let player else { return }
        let clamped = max(0, duration > 0 ? min(seconds, duration) : seconds)
        // Applied before the frame-accurate AVPlayer seek resolves, not after.
        // `toleranceBefore/After: .zero` can take real wall-clock time to
        // settle (HLS especially), and every reader of `position` — the
        // chapter-scoped scrubber's own `chapterOffset` included, everywhere
        // it isn't shadowed by the drag-local `scrubOffset` — was reading the
        // pre-seek value for that whole window. The mini bar has no such
        // shadow, so a skip or chapter jump left its whole-book rail visibly
        // behind the position the rest of the player already claimed to be
        // at (#1746).
        position = clamped
        updateNowPlaying()
        // Guards the observer for the rest of this function, however it
        // exits. The generation is captured now, not read fresh in the
        // `defer` — see `loadGeneration`.
        let generation = loadGeneration
        pendingSeekCount += 1
        defer {
            if generation == loadGeneration { pendingSeekCount -= 1 }
        }
        await player.seek(
            to: CMTime(seconds: clamped, preferredTimescale: 600),
            toleranceBefore: .zero, toleranceAfter: .zero
        )
    }

    func skip(_ delta: Double) {
        Haptics.tap()
        Task { await seek(to: position + delta) }
    }

    func seekToChapter(_ chapter: ChapterInfo) {
        Haptics.tap()
        Task { await seek(to: chapter.startSeconds) }
    }

    /// Seek to an offset inside the current chapter — what the chapter-scoped
    /// scrubber hands back.
    func seekWithinChapter(to offset: Double) async {
        await seek(to: chapterStart + offset)
    }

    func nextChapter() {
        guard let index = currentChapterIndex, index + 1 < chapters.count else { return }
        seekToChapter(chapters[index + 1])
    }

    func previousChapter() {
        // Within the first few seconds of a chapter, go to the one before it;
        // otherwise restart the current chapter — the usual player convention.
        guard let index = currentChapterIndex else { return }
        let current = chapters[index]
        if position - current.startSeconds > 3 || index == 0 {
            seekToChapter(current)
        } else {
            seekToChapter(chapters[index - 1])
        }
    }

    // MARK: - Sleep timer

    /// Arm a wall-clock countdown; `seconds <= 0` disarms.
    func startSleepTimer(seconds: Int) {
        sleepTask?.cancel()
        sleepTask = nil
        guard seconds > 0 else {
            sleepTimer = .off
            return
        }
        sleepTimer = .countdown(remaining: seconds, preset: seconds)
        sleepTask = Task { [weak self] in
            for remaining in stride(from: seconds - 1, through: 0, by: -1) {
                try? await Task.sleep(for: .seconds(1))
                if Task.isCancelled { return }
                await MainActor.run {
                    self?.sleepTimer = .countdown(remaining: remaining, preset: seconds)
                }
            }
            await MainActor.run {
                self?.pause()
                self?.sleepTimer = .off
            }
        }
    }

    /// Arm the timer to pause at `atSeconds` — the current chapter's end,
    /// frozen at arm time. The periodic observer enforces the boundary.
    func startSleepTimer(endOfChapterAt atSeconds: Double) {
        sleepTask?.cancel()
        sleepTask = nil
        sleepTimer = .endOfChapter(atSeconds: atSeconds)
    }

    func cancelSleepTimer() {
        sleepTask?.cancel()
        sleepTask = nil
        sleepTimer = .off
    }

    /// Seconds left on the sleep timer for display, deriving the
    /// end-of-chapter variant from the playback position. `nil` when off.
    /// Mirrors the web sheet's `sleep_remaining`.
    nonisolated static func sleepRemaining(_ timer: SleepTimer, position: Double) -> Int? {
        switch timer {
        case .off:
            return nil
        case .countdown(let remaining, _):
            return max(0, remaining)
        case .endOfChapter(let atSeconds):
            return Int(max(0, atSeconds - position).rounded(.up))
        }
    }

    var sleepRemainingSeconds: Int? { Self.sleepRemaining(sleepTimer, position: position) }

    // MARK: - Lifecycle

    /// Whether a close-time flush is safe to write, mirroring the guard
    /// `persistPosition` applies on every tick: nothing may leave this device
    /// before the opening position has been reconciled against the server,
    /// because every write carries a clock newer than anything already
    /// stored and would beat a genuinely further-along position still in
    /// flight from another device.
    nonisolated static func shouldPersistOnClose(settled: Bool, finalPosition: Double) -> Bool {
        settled && finalPosition > 0
    }

    /// Stop playback and put the player away — what the mini bar's dismiss
    /// means. The position and the session are flushed before the book is
    /// released, since both are keyed on it.
    func close() {
        // Everything the flush needs, captured before the teardown clears it.
        // Doing the flush inside a `Task` and tearing down around it doesn't
        // work in either order: the `Task` body only runs once this synchronous
        // frame ends, so putting the teardown first leaves the flush with no
        // book to attribute, and putting it last leaves the mini bar on screen
        // until the network answers.
        let closing = book
        let finalPosition = position
        let finalFileID = fileID
        // Captured before `teardown`, which resets it — matching the same
        // guard `persistPosition` applies on every tick. Without it, closing
        // during the open-time reconcile window stamps whatever the player
        // happened to be sitting at (0, or a stale resume) with a fresh
        // clock, which can beat — and coalesce-delete — a genuinely newer
        // position still in flight from another device.
        let settled = positionSettled
        let pending = takePendingReport()

        teardown()
        book = nil
        loadRequest = nil
        manifest = nil
        fileID = nil
        position = 0
        duration = 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPNowPlayingInfoCenter.default().playbackState = .stopped

        guard let closing else { return }
        Task {
            if Self.shouldPersistOnClose(settled: settled, finalPosition: finalPosition) {
                await UserDataService.saveProgress(
                    ProgressUpdate(
                        bookUUID: closing.uuid, format: .audio,
                        epubCFI: nil, audioPositionSeconds: finalPosition,
                        bookFileID: finalFileID
                    )
                )
            }
            if let pending { await UserDataService.reportSessions([pending]) }
            Presentation.shared.noteProgressPersisted()
            LifecycleSync.shared.didCloseBook()
        }
    }

    /// Tell `DownloadManager` whether the uplink is carrying a stream right
    /// now. Only a *streamed* item competes — playing downloaded files touches
    /// the network not at all.
    private func publishStreamingState() {
        let streaming = isStreaming && isPlaying
        Task { await DownloadManager.shared.setStreaming(streaming) }
    }

    private func teardown() {
        LifecycleSync.shared.unregister(self)
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        timeObserver = nil
        teardownItemObservers()
        timeControlObservation = nil
        recoveryTask?.cancel()
        recoveryTask = nil
        // Failures on the book being closed must not spend the next book's
        // rebuild budget.
        health.reset()
        isBuffering = false
        player?.pause()
        player = nil
        isPlaying = false
        // Whatever these held belonged to the book being torn down; callers
        // checkpoint first, and anything left is not the next book's.
        sessionStart = nil
        listenedSeconds = 0
        // Tracks one book's lifecycle, so it must not outlive it — a stale
        // tracker would apply the previous book's status to the next one.
        autoStatus = nil
        markedReading = false
        // Cleared with the player, not with the book: `load` awaits the next
        // manifest, and leaving this up means the chapter bar spends that window
        // offering to seek inside the book that was just closed.
        timeline = ChapterTimeline()
        // A start owed to the last book must not start the next.
        pendingStarts = PendingStarts()
        loadingGeneration = nil
        // Closed again so the next book cannot be written to before its own
        // opening position has been settled — this is the one flag whose stale
        // value would be silently destructive rather than merely wrong.
        positionSettled = false
        syncOffer = nil
        // Answered against the book that's loaded, so one left from the last
        // book would seek this one to the last one's position.
        crossFormatOffer = nil
        cancelSleepTimer()
        // Bumped first so a seek belonging to the book being torn down —
        // still holding its own `defer`, due to land whenever AVPlayer gets
        // around to it — finds a mismatched generation and skips its
        // decrement instead of under-counting whatever book loads next. The
        // explicit reset is still required alongside it: that guard is
        // exactly what stops the orphaned seek from ever decrementing this,
        // so without the reset a seek abandoned mid-flight would leave the
        // count permanently elevated and the observer permanently skipped.
        loadGeneration += 1
        pendingSeekCount = 0
        isStreaming = false
        // Closing the book releases the gate — a download held back by it must
        // not stay held back by a player that is no longer playing anything.
        publishStreamingState()
    }

    private func observe(player: AVPlayer) {
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main
        ) { [weak self] time in
            Task { @MainActor in
                guard let self else { return }
                // Skipped while a `seek(to:)` is still resolving: `time` is
                // AVPlayer's actual (pre-seek) position until then, and
                // writing it here would clobber the optimistic target right
                // back to stale for as long as the seek takes to settle.
                guard self.pendingSeekCount == 0 else { return }
                self.position = time.seconds
                // An armed end-of-chapter sleep timer fires the moment
                // playback crosses the boundary it was armed against.
                if case .endOfChapter(let atSeconds) = self.sleepTimer,
                    self.position >= atSeconds
                {
                    self.pause()
                    self.sleepTimer = .off
                }
                // The periodic observer ticks every 0.5 *media* seconds — at
                // 2x that's twice per wall second — so each tick is converted
                // to wall-clock before it accrues. Listening stats count the
                // listener's real time, not the book time covered.
                if self.isPlaying { self.listenedSeconds += Format.atRate(0.5, rate: self.rate) }
                await self.persistPosition(force: false)
                self.updateNowPlaying()
            }
        }

        // Player-scoped, so an item swap doesn't lose it. `timeControlStatus`
        // is the only signal that distinguishes "paused" from "trying to play
        // and getting nothing", which is exactly the state the old
        // unconditional `isPlaying` flag rendered as healthy playback.
        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) {
            [weak self] player, _ in
            Task { @MainActor in self?.observedTimeControl(of: player) }
        }

        observeItem(player.currentItem)

        try? AVAudioSession.sharedInstance().setActive(true)
    }

    /// Arm the item-scoped health observers. Called for the item `load` built
    /// and again for every replacement `recoverFromFailure` installs, so the
    /// observers never describe an item that is no longer loaded.
    private func observeItem(_ item: AVPlayerItem?) {
        teardownItemObservers()
        guard let item else { return }

        // Bound to this load, like the observer itself: reading
        // `self.autoStatus` from inside the task would resolve it after a
        // teardown or a book switch had already replaced it, and mark a book
        // nobody listened to `finished` — which now also drops it off the
        // Continue rail.
        let tracker = autoStatus
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.isPlaying = false
                self?.updateNowPlaying()
                await self?.persistPosition(force: true)
                await self?.checkpointSession()
                // The item spans every part of the book, so this fires once
                // the last file has played out — finishing an audiobook is the
                // strongest completion signal we get, and it goes through the
                // same tracker as the readers rather than writing `finished`
                // blind.
                //
                // That the item really is the whole book is a load-bearing
                // precondition, not an observation: a downloaded copy holding
                // fewer files than the manifest names ends mid-book, and this
                // handler had no way to tell that apart from a listener
                // reaching the end. `localCovers` is what keeps it true.
                await tracker?.positionChanged(atEnd: true)
            }
        }


        itemStatusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in
                switch item.status {
                case .failed: self?.handle(.failed)
                case .readyToPlay: self?.handle(.playing)
                default: break
                }
            }
        }

        // Alive but out of data. AVFoundation re-arms the item itself, so this
        // is a display state — rebuilding here would discard a recovery
        // already underway.
        stallObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemPlaybackStalled, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.handle(.starved) }
        }

        // Terminal: AVFoundation has stopped trying.
        failedToEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.handle(.failed) }
        }
    }

    private func teardownItemObservers() {
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        if let stallObserver { NotificationCenter.default.removeObserver(stallObserver) }
        stallObserver = nil
        if let failedToEndObserver {
            NotificationCenter.default.removeObserver(failedToEndObserver)
        }
        failedToEndObserver = nil
        itemStatusObservation = nil
    }

    /// Translate `AVPlayer.timeControlStatus` into a health signal.
    ///
    /// `waitingToPlayAtSpecifiedRate` is only a stall when the player is
    /// actually trying to play — the same status covers a player that is
    /// simply paused, and treating that as starvation would show a buffering
    /// spinner over a book the listener paused on purpose.
    private func observedTimeControl(of player: AVPlayer) {
        switch player.timeControlStatus {
        case .playing:
            handle(.playing)
        case .waitingToPlayAtSpecifiedRate where isPlaying:
            handle(.starved)
        case .paused:
            // A stall that the listener then pauses is no longer buffering —
            // without this the overlay outlived the transport state that
            // raised it.
            isBuffering = false
        default:
            break
        }
    }

    /// Fold a signal into `health` and apply whatever it asks for.
    private func handle(_ signal: PlaybackSignal) {
        switch health.observed(signal) {
        case .healthy:
            isBuffering = false
            error = nil
        case .buffering:
            isBuffering = true
        case .rebuild(let attempt):
            isBuffering = false
            // The failure interrupted playback that was under way, so the
            // rebuild should resume it — unless the listener pauses first. A
            // rebuild already in flight has stopped playback but still owes it.
            pendingStarts.afterRecovery = pendingStarts.afterRecovery || isPlaying
            isPlaying = false
            updateNowPlaying()
            recoverFromFailure(attempt: attempt)
        case .surrender:
            isBuffering = false
            isPlaying = false
            // Nothing is left to land, so nothing may start.
            pendingStarts.afterRecovery = false
            error = "Playback stopped and could not be resumed. Tap play to try again."
            updateNowPlaying()
        }
    }

    /// Rebuild the current item at the position already reached and resume.
    ///
    /// Backs off by the attempt number so a server that is restarting is not
    /// hammered, and leaves the player paused-with-error if the rebuild itself
    /// throws — a working play button is the floor, since `load`'s same-book
    /// short circuit now falls through for a failed item.
    private func recoverFromFailure(attempt: Int) {
        guard let book, let manifest else { return }
        recoveryTask?.cancel()
        let resume = position
        let generation = loadGeneration
        recoveryTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(Double(attempt)))
            guard let self, !Task.isCancelled, generation == self.loadGeneration else { return }
            // Only the current task is uncancelled: a newer recovery or a
            // teardown cancels this one before replacing it.
            defer { if !Task.isCancelled { self.recoveryTask = nil } }
            do {
                let item = try await self.makeItem(for: manifest, uuid: book.uuid)
                guard !Task.isCancelled, generation == self.loadGeneration else { return }
                self.player?.replaceCurrentItem(with: item)
                self.observeItem(item)
                await self.seek(to: resume)
                // Replaced during the seek: the start belongs to the newer
                // recovery, and this item is the one it is replacing.
                guard !Task.isCancelled, generation == self.loadGeneration else { return }
                self.error = nil
                // Not `play()`: see `startPlayback`. A rebuild that fails
                // again must spend the next attempt, not reset the count.
                if self.pendingStarts.afterRecovery, let player = self.player {
                    self.pendingStarts.afterRecovery = false
                    self.startPlayback(on: player)
                }
            } catch {
                guard !Task.isCancelled else { return }
                self.pendingStarts.afterRecovery = false
                self.error = (error as? APIError)?.errorDescription
                    ?? error.localizedDescription
                self.updateNowPlaying()
            }
        }
    }

    // MARK: - Persistence

    /// Record where the listener is. The write into the replica and the
    /// outbox happens on every tick, unconditionally — cheap even at twice a
    /// second, since `SyncEngine.record` coalesces on kind (#1666). `force`
    /// decides only whether this tick is also worth a round trip of its own —
    /// a pause, a backgrounding, a close — as opposed to the steady ticks,
    /// which still queue immediately but push at most once every five
    /// seconds.
    private func persistPosition(force: Bool) async {
        // Nothing may be written before the opening position has been settled
        // against the server: every write carries a fresh clock and would beat
        // the very position the reconcile is fetching.
        guard let book, position > 0, positionSettled else { return }
        let push = pushThrottle.shouldPush(force: force)
        await UserDataService.saveProgress(
            ProgressUpdate(
                bookUUID: book.uuid, format: .audio, epubCFI: nil,
                audioPositionSeconds: position, bookFileID: fileID
            ),
            push: push
        )
        // After the replica write, never before: the snapshot is composed from
        // the replica, so refreshing first would republish the position this
        // call was about to replace.
        if widgetThrottle.shouldPush(force: force) {
            Task { await WidgetSnapshotWriter.shared.refresh() }
        }
    }

    private func persistRate() async {
        guard let book else { return }
        let update = AudiobookPlaybackRateUpdate(playbackRate: rate)
        // Write through to the replica first, so the rate survives a relaunch
        // made offline rather than reverting to 1.0 on the next open.
        await Cache.write(
            CacheKey.playbackRate(book.uuid),
            AudiobookPlaybackRateRecord(
                bookUUID: book.uuid,
                playbackRate: rate,
                updatedAt: Int64(Date().timeIntervalSince1970)
            )
        )
        await SyncEngine.shared.write(
            kind: OpKind.playbackRate(book.uuid),
            path: "/api/audiobooks/\(book.uuid)/playback-rate",
            method: "PUT", body: update, coalesce: true
        )
    }

    /// Take the listening accumulated so far as a report, closing the window.
    ///
    /// Taking is split from sending so a caller about to tear the player down
    /// can capture the values first — everything here is cleared by `teardown`,
    /// and reading it afterwards finds nothing to attribute.
    ///
    /// Under five seconds is left to accumulate rather than discarded: a pause
    /// four seconds in should carry into the next stretch, not vanish.
    private func takePendingReport() -> SessionReport? {
        guard let book, sessionStart != nil, listenedSeconds >= 5 else { return nil }
        let ended = Int64(Date().timeIntervalSince1970)
        let units = Int64(listenedSeconds)
        // The span is derived from the listening rather than from when the
        // window opened. `listenedSeconds` counts only the time the player was
        // actually running, and a window that returns nothing (under five
        // seconds) is deliberately left open to keep accumulating — so the
        // opening timestamp drifts arbitrarily far back behind a few paused
        // hours, and a report claiming to start before the app launched buckets
        // into the wrong day. "This much listening, ending now" is the honest
        // shape, and it matches what the reader already reports.
        let report = SessionReport(
            bookUUID: book.uuid,
            format: .audio,
            startedAt: ended - units,
            endedAt: ended,
            progressUnits: units,
            deviceId: nil
        )
        // Cleared here, before any await a caller adds: a second checkpoint
        // racing this one — a pause landing while the backgrounding flush is in
        // flight — would otherwise report the same seconds twice under two
        // client ids, the one shape the server's idempotency can't collapse.
        sessionStart = isPlaying ? Date() : nil
        listenedSeconds = 0
        return report
    }

    /// Report the listening accumulated so far and start a fresh window.
    ///
    /// A checkpoint rather than an end, because there is no single moment that
    /// reliably *is* the end: playback outlives the foreground, and the system
    /// can kill a backgrounded app without warning. Reporting at every point
    /// where listening definitely pauses — a pause, a backgrounding, a book
    /// switch, the end of the book — means the worst a lost app costs is the
    /// seconds since the last checkpoint. Each report covers a disjoint slice
    /// of `listenedSeconds` and carries its own client id, so replaying one
    /// can't double-count either.
    private func checkpointSession() async {
        guard let report = takePendingReport() else { return }
        await UserDataService.reportSessions([report])
    }

    // MARK: - Now Playing / remote commands

    /// Reports the current chapter's span, not the book's, so the lock screen
    /// scrubber is chapter-scoped like the in-app one; a book without chapter
    /// marks falls back to the whole-book span.
    private func updateNowPlaying() {
        guard let book else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: currentChapter?.title ?? book.displayTitle,
            MPMediaItemPropertyAlbumTitle: book.displayTitle,
            MPMediaItemPropertyArtist: book.authorDisplay,
            MPMediaItemPropertyPlaybackDuration: chapterDuration,
            // A gap between chapters would read past the total; 0 is an unknown length.
            MPNowPlayingInfoPropertyElapsedPlaybackTime: chapterDuration > 0
                ? min(chapterOffset, chapterDuration) : chapterOffset,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? rate : 0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
        if let index = currentChapterIndex {
            info[MPNowPlayingInfoPropertyChapterNumber] = index + 1
            info[MPNowPlayingInfoPropertyChapterCount] = chapters.count
        }
        if let artwork = currentArtwork {
            info[MPMediaItemPropertyArtwork] = artwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        // Stated rather than left to the system to infer: CarPlay's Now Playing
        // stayed on its play button through playback no remote command started.
        // A start still owed reads as playing, as on the app's own controls; the
        // rate above stays real, or the system runs the scrubber on with no audio.
        MPNowPlayingInfoCenter.default().playbackState = isPlayingOrStarting ? .playing : .paused
    }

    /// The book's artwork; not `isFinal` while it is the plate standing in
    /// for art that didn't load.
    private var artworkCache: (uuid: String, artwork: MPMediaItemArtwork, isFinal: Bool)?
    /// The book whose artwork is loading. Now Playing updates twice a second,
    /// and each would otherwise start another fetch and render of the cover.
    private var artworkLoading: String?
    /// Whether a plate waits on the connection to try its art again.
    private var artworkAwaitsConnection = false

    private var currentArtwork: MPMediaItemArtwork? {
        guard let book else { return nil }
        let cached = artworkCache?.uuid == book.uuid ? artworkCache : nil
        if let cached, cached.isFinal { return cached.artwork }
        // Offline, each tick's attempt would wait out a request timeout.
        guard artworkLoading != book.uuid, cached == nil || Connectivity.shared.isOnline else {
            return cached?.artwork
        }
        artworkLoading = book.uuid
        Task {
            await loadArtwork(for: book)
            if artworkLoading == book.uuid { artworkLoading = nil }
        }
        return cached?.artwork
    }

    private func loadArtwork(for book: Book) async {
        if let cached = artworkCache, cached.uuid == book.uuid, cached.isFinal { return }
        var art: UIImage?
        if book.coverURL != nil {
            art = await ImageCache.shared.image(for: "/api/thumbs/\(book.uuid)/lg")
            if art == nil, Connectivity.shared.isOnline,
               let data = try? await APIClient.shared.data(for: "/api/covers/\(book.uuid)") {
                art = UIImage(data: data)
            }
        }
        // Art that didn't load shows the plate meanwhile, and is tried again on
        // a later update — offline, once the connection is back.
        let isFinal = art != nil || book.coverURL == nil
        if isFinal || artworkCache?.uuid != book.uuid,
           let image = Self.artworkImage(for: book, art: art) {
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            artworkCache = (book.uuid, artwork, isFinal)
            updateNowPlaying()
        }
        if !isFinal, !Connectivity.shared.isOnline { retryArtworkOnceOnline() }
    }

    /// Update Now Playing once the connection is back, which tries the art
    /// again — a paused book sends no updates of its own.
    private func retryArtworkOnceOnline() {
        guard !artworkAwaitsConnection else { return }
        artworkAwaitsConnection = true
        withObservationTracking {
            _ = Connectivity.shared.isOnline
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.artworkAwaitsConnection = false
                if Connectivity.shared.isOnline {
                    self.updateNowPlaying()
                } else {
                    self.retryArtworkOnceOnline()
                }
            }
        }
    }

    /// The cover the lock screen and the car show: the art over the player's
    /// plate, at the art's own shape, else the plate alone, square.
    private static func artworkImage(for book: Book, art: UIImage?) -> UIImage? {
        var size = CGSize(width: 600, height: 600)
        if let art, art.size.width > 0, art.size.height > 0 {
            let scale = min(1, 1024 / max(art.size.width, art.size.height))
            size = CGSize(width: art.size.width * scale, height: art.size.height * scale)
        }
        return CoverBitmap.render(CoverIdentity(book), art: art, size: size, scale: 1)
    }

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.remotePlay() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.togglePlayback(start: self.remotePlay)
            }
            return .success
        }
        // The intervals are what CarPlay and the lock screen draw; a hardware
        // press can arrive on any of these commands (see `RemoteTransport`).
        center.skipForwardCommand.preferredIntervals = [NSNumber(value: RemoteTransport.forwardSeconds)]
        center.skipBackwardCommand.preferredIntervals = [NSNumber(value: RemoteTransport.backSeconds)]
        let transports: [(MPRemoteCommand, RemoteTransport)] = [
            (center.skipForwardCommand, .skipForward),
            (center.skipBackwardCommand, .skipBackward),
            (center.nextTrackCommand, .nextTrack),
            (center.previousTrackCommand, .previousTrack),
            (center.seekForwardCommand, .seekForward),
            (center.seekBackwardCommand, .seekBackward),
        ]
        for (command, transport) in transports {
            command.addTarget { [weak self] event in
                // Read before the hop, so a main-thread stall can't change the decision.
                let now = ContinuousClock.now
                let seekType = (event as? MPSeekCommandEvent)?.type
                let began = seekType == .beginSeeking
                let phase = seekType == nil ? "" : began ? " begin" : " end"
                remoteCommandLog.notice("\(transport.rawValue + phase, privacy: .public)")
                // A seek command is a begin and an end: it moves once, on release.
                Task { @MainActor in
                    if began {
                        self?.remotePresses.began(transport, at: now)
                    } else {
                        self?.remoteSeek(transport, at: now)
                    }
                }
                return .success
            }
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            // Chapter-relative: `updateNowPlaying` reports the chapter's span.
            Task { @MainActor in await self?.seekWithinChapter(to: event.positionTime) }
            return .success
        }
    }

    /// Which remote commands are one press.
    private var remotePresses = RemotePressFilter()

    /// Move for a remote seek command, unless it's the second command of one press.
    private func remoteSeek(_ transport: RemoteTransport, at now: ContinuousClock.Instant) {
        guard remotePresses.shouldMove(transport, at: now) else {
            remoteCommandLog.notice("\(transport.rawValue, privacy: .public) suppressed, same press")
            return
        }
        skip(transport.seekDelta)
    }

    /// A play command from outside the app — a car's auto-play on connect, its
    /// play button, AirPods. With nothing loaded it resumes the most recent
    /// audiobook, as Audible does in the car, rather than doing nothing.
    private func remotePlay() {
        // A book, or a load bringing one: `play()` starts it, or loads it
        // again if its load failed.
        guard book == nil else { return play() }
        loadOwed(retrying: nil)
    }

    /// Load what a play with no player to start owes: `failed` again, else
    /// the most recent audiobook.
    ///
    /// A pending start: a pause or a lost output while it is still finding its
    /// book takes it back, and a call holds it until it ends.
    private func loadOwed(retrying failed: LoadRequest?) {
        // A second press re-arms a resume a pause took back, without a second load.
        pendingStarts.armResume()
        updateNowPlaying()
        guard !isFindingLoad else { return }
        isFindingLoad = true
        Task {
            let target = await resumeTarget(failed: failed)
            isFindingLoad = false
            // Something else loaded, or the book was closed: the starts are its.
            guard player == nil, loadingGeneration == nil, book?.uuid == failed?.book.uuid else {
                pendingStarts.afterResume = false
                updateNowPlaying()
                return
            }
            guard pendingStarts.resumeIsOwed, let target else {
                // A call's hold goes too, or its end would take the session for nothing.
                pendingStarts = PendingStarts()
                return
            }
            // No await between here and `load`'s teardown, which hands the
            // start to `afterLoad`, or to the call holding it — either still
            // revocable by a pause.
            callHoldsNextLoad = !pendingStarts.afterResume
            await load(book: target.book, fileID: target.fileID, known: target.known)
        }
    }

    /// What a play with no player loads: the book whose load failed, as it was
    /// first asked for, else the most recent audiobook if it can play right now.
    private func resumeTarget(failed: LoadRequest?) async -> LoadRequest? {
        if let failed { return failed }
        // The command may be what launched the process — a CarPlay
        // connect with the phone locked — so the replica may not be open.
        await Startup.prepare()
        // Signed out keeps downloads but not the session they belong to.
        guard ServerURLStore.load() != nil, await APIClient.shared.hasToken() else { return nil }
        // The server's list when it answers promptly: a book listened to on
        // another device since, or finished there, must win.
        let points = await UserDataService.settledRecentAudio()
        let point = Self.resumeCandidate(
            in: points, canPlay: { DownloadManager.shared.canOpen($0, kind: .audio) }
        )
        return point.map { LoadRequest(book: $0.book, fileID: nil, known: $0.record) }
    }

    /// The book a play command with nothing loaded resumes: the most recent
    /// audiobook, if it can play right now. Never an older one in its place —
    /// a car starting a book the listener didn't expect is worse than silence.
    nonisolated static func resumeCandidate(
        in points: [ResumePoint], canPlay: (Book) -> Bool
    ) -> ResumePoint? {
        guard let latest = points.first(where: \.isAudio), canPlay(latest.book) else { return nil }
        return latest
    }

    // MARK: - Audio session

    /// Follow interruptions and route changes for the life of the process —
    /// both stop AVPlayer underneath the transport state. Delivered on the
    /// main queue, so the handlers run on the main actor without a hop.
    private func observeAudioSession() {
        let session = AVAudioSession.sharedInstance()
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: session, queue: .main
        ) { [weak self] note in
            guard let event = AudioSessionEvent(interruption: note.userInfo) else { return }
            MainActor.assumeIsolated { self?.respond(to: event) }
        }
        routeChangeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: session, queue: .main
        ) { [weak self] note in
            guard let event = AudioSessionEvent(routeChange: note.userInfo) else { return }
            MainActor.assumeIsolated { self?.respond(to: event) }
        }
    }

    private func respond(to event: AudioSessionEvent) {
        var response = pendingStarts.response(to: event, isPlaying: isPlaying)
        // The interruption deactivated the session, and AVPlayer won't sound
        // until it is active again; one that refuses (a second call ringing as
        // the first ends) would leave Now Playing claiming a silent session.
        if response == .resume, (try? AVAudioSession.sharedInstance().setActive(true)) == nil {
            response = .pause
        }
        let stopping = isPlayingOrStarting
        // Settled before the transport moves: `play()` may arm a rebuild.
        pendingStarts = pendingStarts.settled(
            by: response, loading: loadingGeneration, recovering: recoveryTask != nil,
            resuming: isFindingLoad
        )
        switch response {
        case .pauseUntilResumed, .pause:
            if stopping { stopTransport() }
        case .resume:
            // A load, rebuild or resume in flight has no item to play yet, so
            // `settled` handed it the start, and `play()` would refill that
            // rebuild's budget. With nothing in flight the start is `play()`'s,
            // and its retry of a load or item that failed under the call is
            // meant: the listener asked for this book before the call.
            if pendingStarts.startIsPending { updateNowPlaying() } else { play() }
        case .ignore:
            break
        }
    }
}

/// What `AudioPlayer.load` was asked to open: the book, the file explicitly
/// picked, and a resume point the caller already held.
private struct LoadRequest {
    let book: Book
    let fileID: Int64?
    let known: ProgressRecord?
}
