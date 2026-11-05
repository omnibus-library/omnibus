//  DuoLayoutTests.swift
//  The foldable-iPhone geometry: how a fold splits a view, and where the player
//  puts its artwork and controls for every shape of screen it can be given.

import CoreGraphics
import SwiftUI
import Testing

@testable import omnibus

/// The iPhone Duo inner display opened flat in landscape, minus nothing.
private let innerWide = CGRect(x: 0, y: 0, width: 951, height: 669)
/// A vertical fold down the middle of `innerWide`: the book pose.
private let bookFold = Fold(frame: CGRect(x: 463, y: 0, width: 25, height: 669))
/// A horizontal fold across the inner display held tall: the laptop pose.
private let laptopFold = Fold(frame: CGRect(x: 0, y: 463, width: 669, height: 25))

@Test func foldIsVerticalWhenItRunsTopToBottom() {
    #expect(bookFold.isVertical)
    #expect(!laptopFold.isVertical)
}

@Test func foldHalvesSitEitherSideOfAVerticalFold() {
    let (leading, trailing) = bookFold.halves(of: innerWide)
    #expect(leading == CGRect(x: 0, y: 0, width: 463, height: 669))
    #expect(trailing == CGRect(x: 488, y: 0, width: 463, height: 669))
}

@Test func foldHalvesSitAboveAndBelowAHorizontalFold() {
    let tall = CGRect(x: 0, y: 0, width: 669, height: 951)
    let (top, bottom) = laptopFold.halves(of: tall)
    #expect(top == CGRect(x: 0, y: 0, width: 669, height: 463))
    #expect(bottom == CGRect(x: 0, y: 488, width: 669, height: 463))
}

@Test func playerArrangementStacksOnATallScreen() {
    // An iPhone 17 Pro, and the Duo's outer display held upright.
    for bounds in [CGRect(x: 0, y: 0, width: 402, height: 874), CGRect(x: 0, y: 0, width: 370, height: 678)] {
        #expect(PlayerArrangement.resolve(in: bounds, fold: nil).kind == .stacked)
    }
}

@Test func playerArrangementGoesSideBySideOnAWideScreen() {
    let wide = CGRect(x: 0, y: 0, width: 678, height: 370)
    let arrangement = PlayerArrangement.resolve(in: wide, fold: nil)
    #expect(arrangement.kind == .sideBySide)
    #expect(arrangement.artwork.maxX == arrangement.controls.minX)
    #expect(arrangement.controls.width >= PlayerArrangement.minControlsWidth)
}

@Test func playerArrangementStacksWhenTheControlsColumnWouldBeTooNarrow() {
    // Wide but short of room: a phone in landscape split-screen.
    let narrow = CGRect(x: 0, y: 0, width: 480, height: 320)
    #expect(PlayerArrangement.resolve(in: narrow, fold: nil).kind == .stacked)
}

@Test func playerArrangementSplitsAtAVerticalFold() {
    let arrangement = PlayerArrangement.resolve(in: innerWide, fold: bookFold)
    #expect(arrangement.kind == .sideBySide)
    #expect(arrangement.artwork.maxX == bookFold.frame.minX)
    #expect(arrangement.controls.minX == bookFold.frame.maxX)
}

@Test func playerArrangementPutsArtworkAboveAHorizontalFold() {
    let tall = CGRect(x: 0, y: 0, width: 669, height: 951)
    let arrangement = PlayerArrangement.resolve(in: tall, fold: laptopFold)
    #expect(arrangement.kind == .aboveFold)
    #expect(arrangement.artwork.maxY == laptopFold.frame.minY)
    #expect(arrangement.controls.minY == laptopFold.frame.maxY)
}

@Test func foldGridLayoutCentresAnEvenColumnCountOnTheFold() throws {
    // The book pose's grid, inset 20pt from each edge of the inner display.
    let fold = Fold(frame: CGRect(x: 443, y: 0, width: 25, height: 669))
    let layout = try #require(FoldGridLayout.resolve(width: 911, fold: fold, density: .regular))
    #expect(layout.perSide == 3)
    #expect(layout.span.leading == 0)
    #expect(layout.span.trailing == 0)
    #expect(layout.columns(.regular).count == 6)
    // The gutter after the last leading column is the fold itself.
    #expect(layout.columns(.regular)[2].spacing == 25)
    #expect(layout.columns(.regular)[0].spacing == CoverGridDensity.regular.spacing)
}

@Test func foldGridLayoutGivesUpTheWiderSideSoTheGridStaysSymmetric() throws {
    // Content pushed off-centre by a side bar: the leading side is the wider one.
    let fold = Fold(frame: CGRect(x: 463, y: 0, width: 25, height: 669))
    let layout = try #require(FoldGridLayout.resolve(width: 835, fold: fold, density: .regular))
    // The trailing side holds 347pt, so the leading one gives up 463 - 347.
    #expect(layout.span.leading == 116)
    #expect(layout.span.trailing == 0)
}

@Test func foldGridLayoutIsNilWhenTheFoldMissesTheGrid() {
    let horizontal = Fold(frame: CGRect(x: 0, y: 463, width: 669, height: 25))
    #expect(FoldGridLayout.resolve(width: 629, fold: horizontal, density: .regular) == nil)
    let outside = Fold(frame: CGRect(x: 700, y: 0, width: 25, height: 669))
    #expect(FoldGridLayout.resolve(width: 600, fold: outside, density: .regular) == nil)
}

@Test func paneSplitTakesAShareOfAWideFlatView() throws {
    let split = try #require(PaneSplit.resolve(size: innerWide.size, fold: nil, share: 0.42, minimumWidth: 760))
    #expect(split.leading == 399)
    #expect(split.gap == 0)
    #expect(split.leading + split.trailing == innerWide.width)
}

@Test func paneSplitDividesAtAVerticalFold() throws {
    let split = try #require(PaneSplit.resolve(size: innerWide.size, fold: bookFold, share: 0.42, minimumWidth: 760))
    #expect(split.leading == bookFold.frame.minX)
    #expect(split.gap == bookFold.frame.width)
    #expect(split.trailing == innerWide.width - bookFold.frame.maxX)
}

@Test func paneSplitIsNilForATallNarrowOrFoldedAcrossView() {
    // The outer display upright and on its side, and the inner display held tall and folded.
    #expect(PaneSplit.resolve(size: CGSize(width: 370, height: 678), fold: nil, share: 0.42, minimumWidth: 760) == nil)
    #expect(PaneSplit.resolve(size: CGSize(width: 520, height: 380), fold: nil, share: 0.42, minimumWidth: 560) == nil)
    #expect(PaneSplit.resolve(size: CGSize(width: 669, height: 951), fold: laptopFold, share: 0.42, minimumWidth: 760) == nil)
}

@Test func continueHeroShowsTwoCardsOnlyWhereTwoFitAndThereAreTwo() {
    #expect(ContinueHeroLayout.cardsPerPage(width: 402, count: 3) == 1)
    #expect(ContinueHeroLayout.cardsPerPage(width: 911, count: 3) == 2)
    // A lone card keeps the full width rather than half of it.
    #expect(ContinueHeroLayout.cardsPerPage(width: 911, count: 1) == 1)
}

@Test func continueHeroKeepsALoneCardToOneSideOfAFold() {
    #expect(ContinueHeroLayout.cardsPerPage(width: 855, count: 1, folded: true) == 2)
    // Too narrow for two up, folded or not, it stays one card wide.
    #expect(ContinueHeroLayout.cardsPerPage(width: 402, count: 1, folded: true) == 1)
}

@Test func continueHeroPageStartIsAStopPagingCanRestOn() {
    // Two up, a card at an odd index rests on the page it is part of.
    #expect(ContinueHeroLayout.pageStart(of: 1, count: 5, perPage: 2) == 0)
    #expect(ContinueHeroLayout.pageStart(of: 2, count: 5, perPage: 2) == 2)
    // The scroll ends short of a half-empty last page, on its last two cards.
    #expect(ContinueHeroLayout.pageStart(of: 4, count: 5, perPage: 2) == 3)
    #expect(ContinueHeroLayout.pageStart(of: 2, count: 3, perPage: 2) == 1)
    // A lone card two up, and one up every card, rest where they are.
    #expect(ContinueHeroLayout.pageStart(of: 0, count: 1, perPage: 2) == 0)
    #expect(ContinueHeroLayout.pageStart(of: 2, count: 3, perPage: 1) == 2)
}

@Test func continueHeroPageCountRoundsUpALastHalfPage() {
    #expect(ContinueHeroLayout.pageCount(count: 3, perPage: 2) == 2)
    #expect(ContinueHeroLayout.pageCount(count: 4, perPage: 2) == 2)
    #expect(ContinueHeroLayout.pageCount(count: 3, perPage: 1) == 3)
}

@Test func playerBloomSitsBehindTheArtworkWhereverItStands() {
    let wide = PlayerArrangement.resolve(in: CGRect(x: 0, y: 0, width: 678, height: 370), fold: nil)
    let bloom = PlayerView.bloom(over: wide)
    #expect(bloom.x == wide.artwork.midX / 678)
    #expect(bloom.x < 0.5)
    let folded = PlayerArrangement.resolve(in: CGRect(x: 0, y: 0, width: 669, height: 951), fold: laptopFold)
    #expect(PlayerView.bloom(over: folded).y < 0.5)
}

@Test func bookPageSplitsOnTheDuoOuterDisplayHeldSideways() {
    // 678pt wide, less the 81pt the outer camera's inset takes on its side.
    let sideways = CGSize(width: 597, height: 466)
    let split = PaneSplit.resolve(
        size: sideways, fold: nil,
        share: BookDetailView.stagePaneShare, minimumWidth: BookDetailView.twoPaneWidth
    )
    #expect(split != nil)
    // Upright it stays one column.
    #expect(PaneSplit.resolve(
        size: CGSize(width: 370, height: 678), fold: nil,
        share: BookDetailView.stagePaneShare, minimumWidth: BookDetailView.twoPaneWidth
    ) == nil)
}

@Test func stageCoverScaleShrinksTheCoverOnlyOnAShortPage() {
    // The folded Duo on its side: 466pt less the home indicator's 21.
    let short = BookDetailView.stageCoverScale(paneHeight: 445, underBar: false)
    #expect(short < 0.7)
    #expect(short >= 0.5)
    // The inner display, flat or folded: the cover stands whole.
    #expect(BookDetailView.stageCoverScale(paneHeight: 648, underBar: true) == 1)
}

@Test func stageFadeRaiseEndsTheFadeWhereAStageBetweenTheDiscsRests() {
    // Below the bar, the fade sits on the bar's edge like the trailing pane's.
    #expect(BookDetailView.stageFadeRaise(underBar: false) == 0)
    // Between the discs, the cover rests `stageTop` below the bar row's top; the fade is whole by there.
    let raise = BookDetailView.stageFadeRaise(underBar: true)
    let opaqueAt = -(BarEdgeFade.reach + raise) + BarEdgeFade.length
    #expect(opaqueAt == -BookDetailView.barRow + BookDetailView.stageTop)
}

@Test func continueHeroDotFollowsThePageTheCarouselEndsOn() {
    // Three books two up: the scroll ends on books two and three, the last page.
    #expect(ContinueHeroLayout.page(settledAt: 0, count: 3, perPage: 2) == 0)
    #expect(ContinueHeroLayout.page(settledAt: 1, count: 3, perPage: 2) == 1)
    #expect(ContinueHeroLayout.page(settledAt: 2, count: 4, perPage: 2) == 1)
    // One up, a page is a card.
    #expect(ContinueHeroLayout.page(settledAt: 1, count: 3, perPage: 1) == 1)
}

@Test func foldOutsideTheViewSplitsNothing() {
    // Split View on the inner display: the hinge is past this app's edge.
    let narrow = CGRect(x: 0, y: 0, width: 440, height: 669)
    let beyond = Fold(frame: CGRect(x: 463, y: 0, width: 25, height: 669))
    #expect(!beyond.divides(narrow))
    #expect(PaneSplit.resolve(size: narrow.size, fold: beyond, share: 0.42, minimumWidth: 560) == nil)
    #expect(PlayerArrangement.resolve(in: narrow, fold: beyond).kind == .stacked)
}

@Test func foldSpanCentresARowOnTheHinge() throws {
    // The book pose's measured hinge, 456–497pt, across content the side bar leaves 855pt of.
    let fold = Fold(frame: CGRect(x: 456, y: 0, width: 41, height: 669))
    let span = try #require(FoldSpan.resolve(width: 855, fold: fold))
    #expect(span.gap == 41)
    #expect(span.trailing == 0)
    #expect(span.leading == 98)
    // Centred: what's left either side of the fold is equal.
    #expect(span.side(of: 855) == 358)
}

@Test func foldSpanIsNilForAFoldAcrossOrOutsideTheRow() {
    #expect(FoldSpan.resolve(width: 669, fold: laptopFold) == nil)
    #expect(FoldSpan.resolve(width: 400, fold: Fold(frame: CGRect(x: 456, y: 0, width: 41, height: 669))) == nil)
}

@Test func spreadSplitsAPageOfSectionsOnlyWhereThereIsRoom() {
    // Folded like a book, the spread divides at the hinge.
    let folded = PaneSplit.spread(size: innerWide.size, fold: bookFold)
    #expect(folded == PaneSplit(leading: 463, gap: 25, trailing: 463))
    // Opened flat on its side, into two even pages.
    let flat = PaneSplit.spread(size: innerWide.size, fold: nil)
    #expect(flat.map { abs($0.leading - $0.trailing) <= 1 } == true)
    // The folded phone on its side, the laptop pose and the inner display held tall stay one column.
    #expect(PaneSplit.spread(size: CGSize(width: 597, height: 466), fold: nil) == nil)
    #expect(PaneSplit.spread(size: CGSize(width: 669, height: 951), fold: laptopFold) == nil)
}
