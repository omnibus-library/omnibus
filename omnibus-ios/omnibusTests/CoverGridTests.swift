//  CoverGridTests.swift
//  The layout every cover grid shares.

import SwiftUI
import Testing

@testable import omnibus

struct CoverGridTests {
    @Test func everyDensityAlignsCellsByTheTopOfTheirCover() {
        for density in CoverGridDensity.allCases {
            #expect(density.columns.allSatisfy { $0.alignment == .top })
        }
    }

    @Test func foldColumnsAlignCellsByTheTopOfTheirCoverToo() {
        let layout = FoldGridLayout(perSide: 3, span: FoldSpan(leading: 0, trailing: 0, gap: 25))
        for density in CoverGridDensity.allCases {
            #expect(layout.columns(density).allSatisfy { $0.alignment == .top })
        }
    }
}
