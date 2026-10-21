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
}
