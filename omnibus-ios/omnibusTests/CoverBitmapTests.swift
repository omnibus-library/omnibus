//  CoverBitmapTests.swift
//  The cover bitmap CarPlay's rows and the Now Playing artwork are drawn from:
//  it fills the size asked for, and a transparent cover still shows the plate
//  under it — pinned by reading pixels, so a dropped plate fails.

import Testing
import UIKit

@testable import omnibus

private let book = Book(
    id: 1, filename: "song.m4b", title: "A Song Of Long Ago", uniqueIdentifier: "book-1", formats: ["m4b"]
)

/// The alpha of one pixel, `y` counted from the top.
private func alpha(of image: UIImage?, x: Int, y: Int) -> UInt8? {
    guard let cgImage = image?.cgImage else { return nil }
    var pixel = [UInt8](repeating: 0, count: 4)
    pixel.withUnsafeMutableBytes { buffer in
        let context = CGContext(
            data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
        let origin = CGPoint(x: -x, y: -(cgImage.height - 1 - y))
        context?.draw(cgImage, in: CGRect(origin: origin, size: CGSize(width: cgImage.width, height: cgImage.height)))
    }
    return pixel[3]
}

@MainActor
struct CoverBitmapTests {
    @Test func coverFillsTheSizeAskedForAtTheScaleAskedFor() {
        let image = CoverBitmap.render(
            CoverIdentity(book), art: nil, size: CGSize(width: 44, height: 44), scale: 2
        )
        #expect(image?.cgImage?.width == 88)
        #expect(image?.cgImage?.height == 88)
    }

    @Test func transparentCoverStillShowsThePlateUnderIt() {
        // Some covers are transparent PNGs; drawn alone, the car showed an empty slot.
        let clear = UIGraphicsImageRenderer(size: CGSize(width: 10, height: 10)).image { _ in }
        let image = CoverBitmap.render(
            CoverIdentity(book), art: clear, size: CGSize(width: 40, height: 40), scale: 1
        )
        #expect(alpha(of: image, x: 20, y: 30) == 255)
    }
}
