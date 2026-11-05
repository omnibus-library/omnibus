//  ReaderSideColumnTests.swift
//  The reader taking back an iPhone Duo's side bar column while its bars are
//  hidden, clearing only the camera. The regions are the ones the iPhone Duo
//  simulator reports on its outer display: the camera, and the status bar's
//  housing around it.

import Testing
import UIKit

@testable import omnibus

private let upright = CGSize(width: 466, height: 678)
private let uprightSafe = UIEdgeInsets(top: 0, left: 0, bottom: 34, right: 96)
private let uprightCamera = CGRect(x: 399.67, y: 29.33, width: 37, height: 37)
private let uprightHousing = CGRect(x: 382, y: 0, width: 84, height: 174)

private let sideways = CGSize(width: 678, height: 466)
private let sidewaysSafe = UIEdgeInsets(top: 0, left: 0, bottom: 34, right: 84)
private let sidewaysCamera = CGRect(x: 611.67, y: 399.67, width: 37, height: 37)
private let sidewaysHousing = CGRect(x: 594, y: 384, width: 84, height: 82)

@Test func reclaimingSideColumnDropsTheStageBelowACameraDippingIntoItsTop() {
    let insets = ReaderScreen.reclaimingSideColumn(
        .right, safe: uprightSafe, size: upright, occlusions: [uprightCamera, uprightHousing]
    )
    #expect(insets.right == 0)
    // The stage's top clears the camera by the clearance, rather than the side staying in.
    #expect(insets.top + ReaderScreen.stageBand == uprightCamera.maxY + ReaderScreen.sensorClearance)
    #expect(insets.bottom == uprightSafe.bottom)
}

@Test func reclaimingSideColumnTakesItAllWhenTheCameraSitsBelowTheProse() {
    let insets = ReaderScreen.reclaimingSideColumn(
        .right, safe: sidewaysSafe, size: sideways, occlusions: [sidewaysCamera, sidewaysHousing]
    )
    #expect(insets == UIEdgeInsets(top: 0, left: 0, bottom: 34, right: 0))
}

@Test func reclaimingSideColumnKeepsRoomForASensorBesideTheProse() {
    let beside = CGRect(x: 420, y: 300, width: 37, height: 37)
    let insets = ReaderScreen.reclaimingSideColumn(.right, safe: uprightSafe, size: upright, occlusions: [beside])
    // The stage ends the clearance short of the sensor.
    let stageRight = upright.width - insets.right - ReaderScreen.stageGutter
    #expect(stageRight == beside.minX - ReaderScreen.sensorClearance)
    #expect(insets.top == 0)
}

@Test func reclaimingSideColumnLeavesTheSafeAreaWithoutAColumnOnThatEdge() {
    #expect(ReaderScreen.reclaimingSideColumn(.left, safe: uprightSafe, size: upright, occlusions: []) == uprightSafe)
}

@Test func stageWidthReadsTheReclaimedInsets() {
    let screen = ReaderScreen(
        size: upright, insets: uprightSafe,
        stageInsets: UIEdgeInsets(top: 14, left: 0, bottom: 34, right: 0)
    )
    #expect(screen.stageWidth == upright.width - 2 * ReaderScreen.stageGutter)
}

@Test func stageCentreShiftMovesTheLabelsHalfTheColumnTakenBack() {
    let reclaimed = ReaderScreen(
        size: upright, insets: uprightSafe,
        stageInsets: UIEdgeInsets(top: 14, left: 0, bottom: 34, right: 0)
    )
    #expect(reclaimed.stageCentreShift == uprightSafe.right / 2)
    #expect(ReaderScreen(size: upright, insets: uprightSafe).stageCentreShift == 0)
}

@Test func stageInsetsScriptSetsTheOverridesAndClearsThemForNil() {
    let set = ReaderController.stageInsetsScript(UIEdgeInsets(top: 14, left: 0, bottom: 34, right: 0))
    #expect(set.contains("'--rd-inset-top','14.0px'"))
    #expect(set.contains("'--rd-inset-right','0.0px'"))
    #expect(!set.contains("bottom"))
    #expect(ReaderController.stageInsetsScript(nil).contains("removeProperty"))
}

@Test func landscapeStageWidthLosesOnlyTheSensorClearanceOnceTheColumnIsTakenBack() {
    // Tall enough that two columns fit sideways only with the column given back.
    let tall = CGSize(width: 669, height: 951)
    let kept = ReaderScreen(size: tall, insets: uprightSafe)
    let reclaimed = ReaderScreen(
        size: tall, insets: uprightSafe,
        stageInsets: UIEdgeInsets(top: 14, left: 0, bottom: 34, right: 0)
    )
    #expect(kept.landscapeStageWidth == tall.height - 2 * uprightSafe.right - 2 * ReaderScreen.stageGutter)
    #expect(reclaimed.landscapeStageWidth == tall.height - 14 - 2 * ReaderScreen.stageGutter)
    #expect(SpreadFit(screen: kept) == .never)
    #expect(SpreadFit(screen: reclaimed) == .inLandscape)
}
