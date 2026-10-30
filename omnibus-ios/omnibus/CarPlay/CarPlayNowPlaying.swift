//  CarPlayNowPlaying.swift
//  CarPlay's Now Playing: the speed, bookmark and chapter buttons, the Chapters list, and the "further elsewhere" sheet.
//
//  The template is the system's shared one, filled from the same Now Playing
//  info the lock screen reads — `AudioPlayer` already reports the chapter as
//  the title and a chapter-scoped scrubber. What it adds is the button row
//  (`CarPlayContent.nowPlayingButtons`), the top-right list button retitled
//  Chapters, and a sheet for the sync offers the phone shows as banners: in
//  the car there is no banner, and a silent jump would lose the listener. It
//  is an action sheet rather than an alert because a car may hold an alert to
//  one button (`CPAlertTemplate.maximumActionCount`), and the offer needs two.
//  The car holds one presented template at a time, so the sheets and the
//  controller's alerts share one queue here: each waits for the last
//  dismissal to finish, and no offer is raised before the car shows the tabs.

#if canImport(CarPlay)
import CarPlay
import Observation

@MainActor
final class CarPlayNowPlaying: NSObject, CPNowPlayingTemplateObserver {
    private let interface: CPInterfaceController
    private let player = AudioPlayer.shared
    private var template: CPNowPlayingTemplate { .shared }

    private var isStopped = false
    /// Set for a couple of seconds after a bookmark lands — the car has no
    /// toast, so the filled icon is the confirmation.
    private var bookmarkConfirmed = false
    private var bookmarkReset: Task<Void, Never>?
    /// The sheet for the offer on the table, from raising it until it's closed.
    private var offerSheet: CPActionSheetTemplate?
    /// The offer the driver last saw, so an answer that doesn't clear it
    /// straight away can't raise the same sheet twice.
    private var shownOffer: CarPlayContent.Offer?
    /// Whether the car's root is the signed-in tabs. Presenting before there is
    /// a root is refused, and an offer over the sign-in message would act on
    /// a signed-out session.
    private var offersAllowed = false
    /// The template that should be presented, and the one that is.
    private var wantedModal: CPTemplate?
    private var presentedModal: CPTemplate?
    /// Presents and dismissals in order, each after the last has finished.
    private var modalQueue: Task<Void, Never>?

    init(interface: CPInterfaceController) {
        self.interface = interface
        super.init()
    }

    func start() {
        template.add(self)
        template.upNextTitle = "Chapters"
        template.isAlbumArtistButtonEnabled = false
        refresh()
        observePlayer()
    }

    func stop() {
        isStopped = true
        template.remove(self)
        bookmarkReset?.cancel()
        modalQueue?.cancel()
    }

    /// Bring Now Playing to the front: back to it when it's already in the
    /// stack — CarPlay refuses a template pushed twice — else pushed.
    func show() {
        guard !isStopped, interface.topTemplate !== template else { return }
        if interface.templates.contains(where: { $0 === template }) {
            interface.pop(to: template, animated: true, completion: nil)
        } else {
            interface.pushTemplate(template, animated: true, completion: nil)
        }
    }

    /// The car's root was set or replaced. Whatever was presented is taken
    /// down, and an offer still on the table is raised again over the tabs.
    func rootDidChange(signedIn: Bool) {
        offersAllowed = signedIn
        wantedModal = nil
        offerSheet = nil
        shownOffer = nil
        enqueueModal { [weak self] in
            guard let self, self.presentedModal != nil else { return }
            self.presentedModal = nil
            _ = try? await self.interface.dismissTemplate(animated: false)
        }
        presentOffer()
    }

    /// Tell the driver a book couldn't be opened, with the one button a car's
    /// alert is sure to hold.
    func showLoadFailure(_ reason: String) {
        let handle = WeakTemplate()
        let ok = CPAlertAction(title: CarPlayContent.ok, style: .cancel) { [weak self] _ in
            MainActor.assumeIsolated {
                if let self, let alert = handle.template { self.closeModal(alert) }
            }
        }
        let alert = CPAlertTemplate(titleVariants: CarPlayContent.loadFailed(reason), actions: [ok])
        handle.template = alert
        presentModal(alert)
    }

    // MARK: - State

    private func observePlayer() {
        withObservationTracking {
            _ = player.book?.uuid
            _ = player.hasChapters
            _ = player.rate
            _ = player.error
            _ = player.syncOffer
            _ = player.crossFormatOffer
        } onChange: { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                guard !self.isStopped else { return }
                self.refresh()
                self.observePlayer()
            }
        }
    }

    private func refresh() {
        template.isUpNextButtonEnabled = player.hasChapters
        template.updateNowPlayingButtons(buttons())
        presentOffer()
    }

    // MARK: - Buttons

    private func buttons() -> [CPNowPlayingButton] {
        CarPlayContent.nowPlayingButtons(hasChapters: player.hasChapters).map { kind in
            switch kind {
            case .rate:
                button(CarPlayGlyph.text(Format.rate(player.rate))) { $0.cycleRate() }
            case .bookmark:
                button(CarPlayGlyph.symbol(bookmarkConfirmed ? "bookmark.fill" : "bookmark")) {
                    $0.addBookmark()
                }
            case .previousChapter:
                button(CarPlayGlyph.symbol("backward.end.fill")) { $0.player.previousChapter() }
            case .nextChapter:
                button(CarPlayGlyph.symbol("forward.end.fill")) { $0.player.nextChapter() }
            }
        }
    }

    private func button(
        _ image: UIImage, action: @escaping (CarPlayNowPlaying) -> Void
    ) -> CPNowPlayingImageButton {
        CPNowPlayingImageButton(image: image) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                action(self)
            }
        }
    }

    private func cycleRate() {
        // Saved per book, like a change on the phone — `rate`'s own setter does that.
        player.rate = CarPlayContent.nextRate(after: player.rate)
    }

    /// Bookmark the current position the way the phone's player does.
    private func addBookmark() {
        guard player.addBookmark() != nil else { return }
        bookmarkConfirmed = true
        refresh()
        bookmarkReset?.cancel()
        bookmarkReset = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled, !isStopped else { return }
            bookmarkConfirmed = false
            refresh()
        }
    }

    // MARK: - Chapters

    func nowPlayingTemplateUpNextButtonTapped(_ nowPlayingTemplate: CPNowPlayingTemplate) {
        showChapters()
    }

    func nowPlayingTemplateAlbumArtistButtonTapped(_ nowPlayingTemplate: CPNowPlayingTemplate) {}

    /// The previous chapter, the current one, and on to the end; a tap plays
    /// from there and goes back to Now Playing.
    private func showChapters() {
        guard let book = player.book else { return }
        let chapters = player.chapters
        let current = player.currentChapterIndex
        let window = CarPlayContent.chapterWindow(count: chapters.count, current: current)
        let items = window.prefix(CPListTemplate.maximumItemCount).map { index in
            let chapter = chapters[index]
            let item = CPListItem(
                text: chapter.title, detailText: Format.duration(player.chapterLength(at: index))
            )
            item.isPlaying = index == current
            item.playingIndicatorLocation = .trailing
            item.handler = { [weak self] _, completion in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.player.seekToChapter(chapter)
                    // Picking a chapter is asking to hear it, so a paused book starts.
                    if !self.player.isPlaying { self.player.play() }
                    self.interface.popTemplate(animated: true, completion: nil)
                }
                completion()
            }
            return item
        }
        let list = CPListTemplate(title: book.displayTitle, sections: [CPListSection(items: items)])
        interface.pushTemplate(list, animated: true, completion: nil)
    }

    // MARK: - Offers

    /// An offer with the player calls that answer it.
    private struct PendingOffer {
        var offer: CarPlayContent.Offer
        var accept: @MainActor () async -> Void
        var dismiss: @MainActor () async -> Void
    }

    /// The offer on the table, in the order the phone's banner slot picks:
    /// none while playback is failing, then another device, then the ebook.
    private func currentOffer() -> PendingOffer? {
        guard player.error == nil else { return nil }
        if let seconds = player.syncOffer {
            return PendingOffer(
                offer: CarPlayContent.syncOffer(at: seconds),
                accept: { await self.player.acceptSyncOffer() },
                dismiss: { self.player.dismissSyncOffer() }
            )
        }
        if let cross = player.crossFormatOffer, let seconds = cross.audioPositionSeconds {
            return PendingOffer(
                offer: CarPlayContent.crossFormatOffer(at: seconds, ahead: cross.sourceAhead != false),
                accept: { await self.player.acceptCrossFormatOffer() },
                dismiss: { await self.player.dismissCrossFormatOffer() }
            )
        }
        return nil
    }

    /// Raise the sheet for a new offer; take it down when the offer goes,
    /// whichever screen answered it.
    private func presentOffer() {
        guard offersAllowed, !isStopped else { return }
        guard let pending = currentOffer() else {
            shownOffer = nil
            closeOffer()
            return
        }
        let offer = pending.offer
        guard offer != shownOffer else { return }
        shownOffer = offer
        let handle = WeakTemplate()
        let answer = { [weak self] (choice: @escaping @MainActor () async -> Void) in
            MainActor.assumeIsolated {
                if let self, let sheet = handle.template { self.closeModal(sheet) }
            }
            Task { @MainActor in await choice() }
        }
        let sheet = CPActionSheetTemplate(
            title: offer.title, message: nil,
            actions: [
                CPAlertAction(title: offer.jump, style: .default) { _ in answer(pending.accept) },
                CPAlertAction(title: CarPlayContent.Offer.stay, style: .cancel) { _ in
                    answer(pending.dismiss)
                },
            ]
        )
        handle.template = sheet
        offerSheet = sheet
        presentModal(sheet)
    }

    private func closeOffer() {
        guard let sheet = offerSheet else { return }
        offerSheet = nil
        closeModal(sheet)
    }

    // MARK: - Presented templates

    /// A presented template its own buttons can name without keeping it alive.
    private final class WeakTemplate {
        weak var template: CPTemplate?
    }

    /// Run `step` once every present and dismissal queued before it is done.
    private func enqueueModal(_ step: @escaping @MainActor () async -> Void) {
        let previous = modalQueue
        modalQueue = Task { @MainActor in
            await previous?.value
            guard !Task.isCancelled else { return }
            await step()
        }
    }

    /// Present `modal`, in place of whatever is presented. Raised from the
    /// dismissal's completion: CarPlay refuses a present that races one.
    private func presentModal(_ modal: CPTemplate) {
        wantedModal = modal
        enqueueModal { [weak self] in
            guard let self, !self.isStopped, self.wantedModal === modal else { return }
            if self.presentedModal != nil {
                self.presentedModal = nil
                _ = try? await self.interface.dismissTemplate(animated: true)
                guard self.wantedModal === modal else { return }
            }
            let shown = (try? await self.interface.presentTemplate(modal, animated: true)) ?? false
            if shown {
                self.presentedModal = modal
            } else {
                self.refused(modal)
            }
        }
    }

    /// Take `modal` down, if it's still up or still on its way.
    private func closeModal(_ modal: CPTemplate) {
        if wantedModal === modal { wantedModal = nil }
        if offerSheet === modal { offerSheet = nil }
        enqueueModal { [weak self] in
            guard let self, self.presentedModal === modal else { return }
            self.presentedModal = nil
            _ = try? await self.interface.dismissTemplate(animated: true)
        }
    }

    /// A present the car refused: forget it, so the offer can be raised again.
    private func refused(_ modal: CPTemplate) {
        if wantedModal === modal { wantedModal = nil }
        if offerSheet === modal {
            offerSheet = nil
            shownOffer = nil
        }
    }
}
#endif
