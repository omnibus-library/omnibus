//  QuoteCardTests.swift
//  The quote card's shapes, type, backgrounds and cover palette — the parts
//  of the editor that are decisions rather than drawing.

import Foundation
import SwiftUI
import Testing

@testable import omnibus

private func oklch(_ hex: String) -> OKLCH {
    OKLCH.parse(cssValue: hex)!
}

private func isClose(_ a: Double, _ b: Double) -> Bool {
    abs(a - b) < 0.001
}

@Suite("Quote card shapes")
struct QuoteRatioTests {
    @Test("the shapes come in the order the editor shows them")
    func ratiosAreOrderedSquarePostPortraitStory() {
        #expect(QuoteRatio.allCases == [.square, .post, .portrait, .story])
    }

    @Test("each shape keeps its name and the ratio beneath it", arguments: [
        (QuoteRatio.square, 1.0, "Square", "1:1"),
        (QuoteRatio.post, 4.0 / 5.0, "Post", "4:5"),
        (QuoteRatio.portrait, 3.0 / 4.0, "Portrait", "3:4"),
        (QuoteRatio.story, 9.0 / 16.0, "Story", "9:16"),
    ])
    func ratioCarriesValueLabelAndDetail(
        _ ratio: QuoteRatio, _ value: Double, _ label: String, _ detail: String
    ) {
        #expect(abs(Double(ratio.value) - value) < 0.001)
        #expect(ratio.label == label)
        #expect(ratio.detail == detail)
    }
}

@Suite("Quote card type")
struct QuoteTypeTests {
    @Test("the passage steps down at each length boundary", arguments: [
        (89, 82.0), (90, 66.0), (179, 66.0), (180, 52.0),
        (319, 52.0), (320, 42.0), (519, 42.0), (520, 34.0),
    ])
    func passageSizeStepsAtLengthBoundaries(_ characters: Int, _ expected: Double) {
        let size = QuoteCard.passageSize(characters: characters, width: 1000, size: .m)
        #expect(abs(Double(size) - expected) < 0.001)
    }

    @Test("the S and L sizes scale the stepped size")
    func passageSizeScalesWithTheSizeControl() {
        let small = QuoteCard.passageSize(characters: 50, width: 1000, size: .s)
        let large = QuoteCard.passageSize(characters: 50, width: 1000, size: .l)
        #expect(abs(Double(small) - 69.7) < 0.001)
        #expect(abs(Double(large) - 96.76) < 0.001)
    }

    @Test("Sans italic is a skewed Instrument Sans, so the slant is in the font itself")
    func sansFontSkewsTheDescriptorWhenItalic() throws {
        let font = try #require(QuoteType(face: .sans, italic: true).sansFont(40))
        // `UIFont.fontDescriptor` drops the matrix; CoreText keeps it.
        let matrix = CTFontGetMatrix(font as CTFont)
        #expect(matrix.a == 1 && matrix.d == 1)
        #expect(isClose(Double(matrix.c), 0.2))
    }

    @Test("upright Sans carries no skew")
    func sansFontIsUprightWhenNotItalic() throws {
        let font = try #require(QuoteType(face: .sans).sansFont(40))
        #expect(CTFontGetMatrix(font as CTFont).isIdentity)
    }

    @Test("bold Sans picks the SemiBold cut, upright or italic", arguments: [false, true])
    func sansFontPicksTheRealCutForWeight(_ italic: Bool) throws {
        let bold = try #require(QuoteType(face: .sans, bold: true, italic: italic).sansFont(40))
        let regular = try #require(QuoteType(face: .sans, bold: false, italic: italic).sansFont(40))
        #expect(bold.fontName == Font.UIFace.semibold)
        #expect(regular.fontName == Font.UIFace.regular)
    }

    @Test("a new card is Serif, M, upright and not bold")
    func quoteTypeDefaultsToUprightMediumSerif() {
        let type = QuoteType()
        #expect(type.face == .serif)
        #expect(type.size == .m)
        #expect(!type.bold)
        #expect(!type.italic)
    }
}

@Suite("Quote card backgrounds")
struct QuoteStyleTests {
    @Test("a light-ink solid drifts darker toward the next hue")
    func solidDriftsDarkerUnderLightInk() throws {
        let sea = try #require(QuoteStyle.solids.first(where: { $0.name == "Sea" }))
        #expect(isClose(sea.from.l, 0.40))
        #expect(isClose(sea.to.l, 0.30))
        #expect(isClose(sea.to.c, 0.06375))
        #expect(isClose(sea.to.h, 242))
        #expect(sea.lightInk)
    }

    @Test("a dark-ink solid drifts lighter")
    func solidDriftsLighterUnderDarkInk() throws {
        let paper = try #require(QuoteStyle.solids.first(where: { $0.name == "Paper" }))
        #expect(isClose(paper.to.l, 0.98))
        #expect(!paper.lightInk)
    }

    @Test("a very dark solid stops drifting at the floor")
    func solidDriftStopsAtTheFloor() {
        let style = QuoteStyle.solid("Floor", OKLCH(0.12, 0.05, 100), lightInk: true)
        #expect(isClose(style.to.l, 0.06))
    }

    @Test("the solids are the six washes and only Paper takes dark ink")
    func solidsListTheSixWashes() {
        #expect(QuoteStyle.solids.map(\.name) == ["Ink", "Paper", "Moss", "Rose", "Dusk", "Sea"])
        #expect(QuoteStyle.solids.filter { !$0.lightInk }.map(\.name) == ["Paper"])
    }

    @Test("a solid's ink takes the ground's hue")
    func solidInkFollowsTheBaseHue() throws {
        let moss = try #require(QuoteStyle.solids.first(where: { $0.name == "Moss" }))
        #expect(isClose(moss.inkTone.l, 0.95))
        #expect(isClose(moss.inkTone.c, 0.012))
        #expect(isClose(moss.inkTone.h, 155))
        let paper = try #require(QuoteStyle.solids.first(where: { $0.name == "Paper" }))
        #expect(isClose(paper.inkTone.l, 0.24))
        #expect(isClose(paper.inkTone.c, 0.02))
    }

    @Test("the book's tone is held inside the range a light ink can read on")
    func bookClampsItsTone() {
        let bright = QuoteStyle.book(OKLCH(0.9, 0.01, 100))
        #expect(isClose(bright.from.l, 0.46))
        #expect(isClose(bright.from.c, 0.05))
        #expect(isClose(bright.from.h, 100))
        #expect(bright.lightInk)
        #expect(isClose(QuoteStyle.book(OKLCH(0.1, 0.2, 100)).from.l, 0.28))
    }

    @Test("the gradients are the five presets and only Dawn takes dark ink")
    func gradientsListTheFivePresets() {
        #expect(QuoteStyle.gradients.map(\.name) == ["Ember", "Dusk", "Lagoon", "Grove", "Dawn"])
        #expect(QuoteStyle.gradients.filter { !$0.lightInk }.map(\.name) == ["Dawn"])
    }

    @Test("a gradient preset renders exactly its two stops")
    func gradientKeepsItsStopsWithoutDrift() throws {
        let ember = try #require(QuoteStyle.gradients.first(where: { $0.name == "Ember" }))
        #expect(ember.from.hex == "#7a1f16")
        #expect(ember.to.hex == "#a24c16")
        let dawn = try #require(QuoteStyle.gradients.first(where: { $0.name == "Dawn" }))
        #expect(dawn.from.hex == "#f7e1c8")
        #expect(dawn.to.hex == "#eeb0a8")
    }

    @Test("a gradient's ink is the web's light or dark hex")
    func gradientInkUsesTheHexInks() throws {
        let ember = try #require(QuoteStyle.gradients.first(where: { $0.name == "Ember" }))
        #expect(ember.inkTone.hex == "#f5f0e8")
        let dawn = try #require(QuoteStyle.gradients.first(where: { $0.name == "Dawn" }))
        #expect(dawn.inkTone.hex == "#221d18")
    }

    @Test("a gradient with an unreadable stop is not made")
    func gradientIsNilForABadHex() {
        #expect(QuoteStyle.gradient("Bad", from: "#7a1f16", to: "nope", lightInk: true)?.name == nil)
    }

    @Test("every swatch has its own id, even when a solid and a gradient share a name")
    func styleIDsAreUnique() {
        let all = [QuoteStyle.book(OKLCH(0.5, 0.1, 200))] + QuoteStyle.solids + QuoteStyle.gradients
        #expect(Set(all.map(\.id)).count == all.count)
    }
}

@Suite("Quote card ink")
struct QuoteInkTests {
    private let light = oklch("#f5f0e8")
    private let dark = oklch("#221d18")

    @Test("light ground stops take dark ink")
    func prefersDarkInkOverDawn() {
        let stops = [oklch("#f7e1c8"), oklch("#eeb0a8")]
        #expect(!QuoteStyle.prefersLightInk(over: stops, light: light, dark: dark))
    }

    @Test("dark ground stops take light ink")
    func prefersLightInkOverEmber() {
        let stops = [oklch("#7a1f16"), oklch("#a24c16")]
        #expect(QuoteStyle.prefersLightInk(over: stops, light: light, dark: dark))
    }

    @Test("the worst stop decides, not the lightest one on its own")
    func worstCaseStopDecides() {
        let stops = [oklch("#808080"), oklch("#000000")]
        #expect(QuoteStyle.prefersLightInk(over: stops, light: light, dark: dark))
    }
}

@Suite("Quote card colour maths")
struct QuoteColourTests {
    @Test("white and black are the extremes of luminance and contrast")
    func luminanceAndContrastSpanTheirRange() {
        let white = OKLCH(1, 0, 0)
        let black = OKLCH(0, 0, 0)
        #expect(abs(white.luminance - 1) < 0.01)
        #expect(abs(black.luminance) < 0.01)
        #expect(abs(white.contrast(with: black) - 21) < 0.2)
        #expect(abs(black.contrast(with: white) - 21) < 0.2)
    }

    @Test("hex is lowercase and round-trips a parsed colour")
    func hexRoundTripsAParsedColour() {
        #expect(oklch("#7A1F16").hex == "#7a1f16")
        #expect(OKLCH(1, 0, 0).hex == "#ffffff")
    }
}

@Suite("Quote card gradient direction")
struct QuoteDirectionTests {
    @Test("135 degrees runs top-leading to bottom-trailing")
    func pointsAt135RunCornerToCorner() {
        let points = QuoteStyle.points(135)
        #expect(points.start == .topLeading)
        #expect(points.end == .bottomTrailing)
    }

    @Test("90 degrees runs left to right")
    func pointsAt90RunLeadingToTrailing() {
        let points = QuoteStyle.points(90)
        #expect(points.start == .leading)
        #expect(points.end == .trailing)
    }

    @Test("an angle past a full turn wraps")
    func pointsWrapPastAFullTurn() {
        #expect(QuoteStyle.points(495).start == QuoteStyle.points(135).start)
        #expect(QuoteStyle.points(495).end == QuoteStyle.points(135).end)
    }
}

@Suite("Quote card custom backgrounds")
struct QuoteCustomStyleTests {
    @Test("a pale custom colour takes dark ink")
    func customSolidTakesDarkInkOnAPaleColour() {
        let style = QuoteStyle.customSolid(OKLCH(0.93, 0.017, 80))
        #expect(style.name == "Custom colour")
        #expect(style.kind == .solid)
        #expect(!style.lightInk)
        #expect(isClose(style.inkTone.l, 0.24))
    }

    @Test("a deep custom colour takes light ink and the usual drift")
    func customSolidTakesLightInkOnADeepColour() {
        let style = QuoteStyle.customSolid(OKLCH(0.19, 0.012, 70))
        #expect(style.lightInk)
        #expect(isClose(style.inkTone.l, 0.95))
        #expect(isClose(style.to.l, 0.09))
    }

    @Test("a custom gradient keeps its stops and angle and picks ink by worst-case contrast")
    func customGradientKeepsStopsAngleAndInk() {
        let style = QuoteStyle.customGradient(from: oklch("#f7e1c8"), to: oklch("#eeb0a8"), angle: 225)
        #expect(style.name == "Custom gradient")
        #expect(style.kind == .gradient)
        #expect(style.from.hex == "#f7e1c8")
        #expect(style.to.hex == "#eeb0a8")
        #expect(style.angle == 225)
        #expect(!style.lightInk)
        #expect(style.inkTone.hex == "#221d18")
    }

    @Test("a picked sRGB colour converts to its hex")
    func oklchFromColorReadsSRGB() {
        #expect(OKLCH.from(Color(.sRGB, red: 1, green: 0, blue: 0)).hex == "#ff0000")
    }
}

@Suite("Quote card cover palette")
struct CoverPaletteTests {
    private func decodeStyles(from json: String) throws -> [QuoteStyle] {
        try JSONDecoder().decode(CoverPalette.self, from: Data(json.utf8)).styles
    }

    @Test("the server's pairs become Cover 1 to 4 in order, with dark ink only where asked")
    func stylesFollowTheServersPairs() throws {
        let styles = try decodeStyles(from: """
        {"pairs":[
          {"from":"#5d1f1c","to":"#c01a1a","ink":"light"},
          {"from":"#1e1b1b","to":"#ab2527","ink":"light"},
          {"from":"#1e1b1b","to":"#5d1f1c","ink":"light"},
          {"from":"#efe4e6","to":"#d5c2c9","ink":"dark"}
        ]}
        """)
        #expect(styles.map(\.name) == ["Cover 1", "Cover 2", "Cover 3", "Cover 4"])
        #expect(styles.first?.from.hex == "#5d1f1c")
        #expect(styles.map(\.lightInk) == [true, true, true, false])
        #expect(styles.allSatisfy { $0.kind == .gradient })
    }

    @Test("no pairs gives no swatches")
    func stylesAreEmptyForNoPairs() throws {
        let styles = try decodeStyles(from: "{\"pairs\":[]}")
        #expect(styles.isEmpty)
    }

    @Test("a pair with an unreadable hex is dropped and the rest renumber")
    func stylesDropAPairWithABadHex() throws {
        let styles = try decodeStyles(from: """
        {"pairs":[
          {"from":"nope","to":"#c01a1a","ink":"light"},
          {"from":"#1e1b1b","to":"#ab2527","ink":"light"}
        ]}
        """)
        #expect(styles.map(\.name) == ["Cover 1"])
        #expect(styles.first?.from.hex == "#1e1b1b")
    }

    @Test("an ink other than dark is light")
    func stylesTreatAnyOtherInkAsLight() throws {
        let styles = try decodeStyles(from: """
        {"pairs":[{"from":"#1e1b1b","to":"#ab2527","ink":"mystery"}]}
        """)
        #expect(styles.first?.lightInk == true)
    }
}
