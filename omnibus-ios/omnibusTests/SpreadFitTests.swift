//  SpreadFitTests.swift
//  Where the reader offers Two Pages: only on a screen whose page can be wide
//  enough for two columns, and said so where it will be.
//
//  The screens are the figures from the iOS simulator profiles, not values the
//  rule is derived from — a phone held upright is as wide as its short side
//  less the safe areas, and a Dynamic Island puts 62pt of safe area on the
//  sensor's edge in whichever way the phone is turned.

import Foundation
import Testing
import UIKit

@testable import omnibus

/// A phone with a Dynamic Island, held upright: the sensor inset is `top`.
private func upright(_ width: CGFloat, _ height: CGFloat, bottom: CGFloat = 34) -> ReaderScreen {
    ReaderScreen(
        size: CGSize(width: width, height: height),
        insets: UIEdgeInsets(top: 62, left: 0, bottom: bottom, right: 0)
    )
}

/// The same phone on its side: the sensor inset lands on both `left` and `right`.
private func sideways(_ width: CGFloat, _ height: CGFloat) -> ReaderScreen {
    ReaderScreen(
        size: CGSize(width: width, height: height),
        insets: UIEdgeInsets(top: 0, left: 62, bottom: 21, right: 62)
    )
}

private let iPhone18Pro = (upright: upright(402, 874), sideways: sideways(874, 402))
private let iPhone18ProMax = (upright: upright(440, 956), sideways: sideways(956, 440))
private let iPhoneDuoOuter = (upright: upright(466, 678), sideways: sideways(678, 466))
private let iPhoneDuoInner = (upright: upright(669, 951), sideways: sideways(951, 669))

@Suite("Where Two Pages fits")
struct SpreadFitTests {
    @Test("a stage is the window less its safe areas and the stage's gutter")
    func stageWidthIsTheWindowLessSafeAreaAndGutter() {
        #expect(iPhone18Pro.upright.stageWidth == 382)
        #expect(iPhone18Pro.sideways.stageWidth == 730)
    }

    @Test("the landscape stage is the long side less the sensor inset at both ends")
    func landscapeStageIsTheLongSideLessTheSensorInset() {
        #expect(iPhone18Pro.upright.landscapeStageWidth == 730)
        #expect(iPhone18Pro.sideways.landscapeStageWidth == 730)
        #expect(iPhone18ProMax.upright.landscapeStageWidth == 812)
        #expect(iPhone18ProMax.sideways.landscapeStageWidth == 812)
    }

    @Test("an 18 Pro never reaches two columns, so the choice is not offered")
    func smallPhoneNeverFits() {
        #expect(SpreadFit(screen: iPhone18Pro.upright) == .never)
        #expect(SpreadFit(screen: iPhone18Pro.sideways) == .never)
        #expect(SpreadFit.never.note == nil)
    }

    @Test("an 18 Pro Max is offered Two Pages upright, with a note that it needs landscape")
    func largePhoneFitsInLandscape() {
        let fit = SpreadFit(screen: iPhone18ProMax.upright)

        #expect(fit == .inLandscape)
        #expect(fit.note == "Two pages appear in landscape.")
    }

    @Test("an 18 Pro Max on its side lays out two columns, so there is nothing to explain")
    func largePhoneOnItsSideFitsNow() {
        let fit = SpreadFit(screen: iPhone18ProMax.sideways)

        #expect(fit == .now)
        #expect(fit.note == nil)
    }

    @Test("an iPad held upright lays out two columns")
    func padFitsNow() {
        let pad = ReaderScreen(
            size: CGSize(width: 820, height: 1180),
            insets: UIEdgeInsets(top: 24, left: 0, bottom: 20, right: 0)
        )

        #expect(SpreadFit(screen: pad) == .now)
        #expect(SpreadFit(screen: pad).note == nil)
    }

    @Test("a folded Duo says two pages appear when it is unfolded, held either way")
    func foldedPhoneSaysUnfold() {
        let upright = SpreadFit(screen: iPhoneDuoOuter.upright, folded: true)
        let sideways = SpreadFit(screen: iPhoneDuoOuter.sideways, folded: true)

        #expect(upright == .whenUnfolded)
        #expect(sideways == .whenUnfolded)
        #expect(upright.note == "Two pages appear when the phone is unfolded.")
    }

    @Test("an unfolded Duo upright notes landscape, and on its side lays out two columns")
    func unfoldedDuoFollowsItsInnerScreen() {
        #expect(iPhoneDuoInner.upright.stageWidth == 649)
        #expect(SpreadFit(screen: iPhoneDuoInner.upright) == .inLandscape)
        #expect(SpreadFit(screen: iPhoneDuoInner.sideways) == .now)
        #expect(SpreadFit(screen: iPhoneDuoInner.sideways).note == nil)
    }

    @Test("a phone that fits two columns sideways says so before it says to unfold")
    func foldedDoesNotOutrankWhatFits() {
        #expect(SpreadFit(screen: iPhone18ProMax.upright, folded: true) == .inLandscape)
        #expect(SpreadFit(screen: iPhone18ProMax.sideways, folded: true) == .now)
    }

    @Test("the Duo's outer screen with no fold reported never fits")
    func outerScreenWithoutAFoldNeverFits() {
        #expect(SpreadFit(screen: iPhoneDuoOuter.upright) == .never)
    }

    /// epub.js pairs at `>=`, so 800 is two columns and 799 is one.
    @Test("a stage of exactly 800 fits and one of 799 does not")
    func thresholdIsInclusive() {
        func screen(stage: CGFloat) -> ReaderScreen {
            ReaderScreen(
                size: CGSize(width: stage + 20, height: 700),
                insets: UIEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
            )
        }

        #expect(SpreadFit(screen: screen(stage: 800)) == .now)
        #expect(SpreadFit(screen: screen(stage: 799)) == .never)
    }
}

@Suite("Where the status bar joins the reader's chrome")
struct StatusBarFitTests {
    private let padMini = (
        upright: ReaderScreen(
            size: CGSize(width: 744, height: 1133),
            insets: UIEdgeInsets(top: 0, left: 0, bottom: 20, right: 0)
        ),
        sideways: ReaderScreen(
            size: CGSize(width: 1133, height: 744),
            insets: UIEdgeInsets(top: 0, left: 0, bottom: 20, right: 0)
        )
    )
    private let iPhoneSE = ReaderScreen(
        size: CGSize(width: 375, height: 667),
        insets: UIEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
    )

    @Test("an iPad has no inset to hold the status bar, upright or on its side")
    func padHasNoRoomForTheStatusBar() {
        #expect(!padMini.upright.statusBarFitsInTopInset)
        #expect(!padMini.sideways.statusBarFitsInTopInset)
    }

    @Test("a Dynamic Island phone's sensor inset holds the status bar upright, not on its side")
    func islandPhoneHoldsItUprightOnly() {
        #expect(iPhone18Pro.upright.statusBarFitsInTopInset)
        #expect(!iPhone18Pro.sideways.statusBarFitsInTopInset)
    }

    @Test("a Home-button phone has no inset for the status bar to sit in")
    func homeButtonPhoneHasNoRoom() {
        #expect(!iPhoneSE.statusBarFitsInTopInset)
    }
}

@Suite("Reader controller spread fit")
@MainActor
struct ReaderSpreadFitTests {
    @Test("a controller offers Two Pages until it has been told what screen it is on")
    func unknownScreenKeepsTheRowShown() {
        let controller = ReaderController(settings: ReaderSettings())

        #expect(controller.screen == nil)
        #expect(controller.spreadFit == .now)
    }

    @Test("a controller re-decides as the screen turns")
    func fitFollowsTheScreen() {
        let controller = ReaderController(settings: ReaderSettings())

        controller.screen = iPhone18ProMax.upright
        #expect(controller.spreadFit == .inLandscape)

        controller.screen = iPhone18ProMax.sideways
        #expect(controller.spreadFit == .now)
    }

    @Test("a controller re-decides as the phone folds and unfolds")
    func fitFollowsTheFold() {
        let controller = ReaderController(settings: ReaderSettings())
        controller.screen = iPhoneDuoOuter.upright

        controller.isFolded = true
        #expect(controller.spreadFit == .whenUnfolded)

        controller.isFolded = false
        #expect(controller.spreadFit == .never)
    }

    @Test("a controller keeps the status bar hidden until it has been told what screen it is on")
    func unknownScreenKeepsTheStatusBarHidden() {
        let controller = ReaderController(settings: ReaderSettings())

        #expect(controller.screen == nil)
        #expect(!controller.showsStatusBarWithChrome)
    }

    @Test("a controller shows the status bar with the chrome as the screen turns")
    func statusBarFollowsTheScreen() {
        let controller = ReaderController(settings: ReaderSettings())

        controller.screen = iPhone18Pro.upright
        #expect(controller.showsStatusBarWithChrome)

        controller.screen = iPhone18Pro.sideways
        #expect(!controller.showsStatusBarWithChrome)
    }
}
