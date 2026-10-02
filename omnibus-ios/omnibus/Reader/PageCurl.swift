//  PageCurl.swift
//  What the page curl is made of: snapshots of the page in front of the reader
//  and its neighbours, the order UIKit turns through them, and the view each
//  side of a page shows. `PageCurlHost` drives these over the web view.

import UIKit

/// How the reader lays its pages out, as far as the curl is concerned. A single
/// column turns about its left edge; a spread — two columns on a landscape
/// phone, or one per screen on a two-screen device — turns a sheet about the
/// spine between them, as a book does. Any other layout slides.
enum CurlLayout: Equatable {
    case single
    case spread

    init?(columns: Int?) {
        switch columns {
        case 1: self = .single
        case 2: self = .spread
        default: return nil
        }
    }

    var spineLocation: UIPageViewController.SpineLocation {
        self == .single ? .min : .mid
    }

    /// Where the curl is drawn over a stage of `bounds`. UIKit puts a `.mid`
    /// spine in the middle of its view, so a spread's is the widest band
    /// centred on `spine`, where its columns meet.
    func frame(in bounds: CGRect, spine: CGFloat?) -> CGRect {
        guard self == .spread, let spine, spine > bounds.minX, spine < bounds.maxX else {
            return bounds
        }
        let half = min(spine - bounds.minX, bounds.maxX - spine)
        return CGRect(x: spine - half, y: bounds.minY, width: half * 2, height: bounds.height)
    }
}

/// One of a page's two sides, by offset from the page in front: a single
/// column's front and back, or a spread's left and right halves, which UIKit
/// reads in the same order.
struct CurlSide: Equatable {
    let offset: Int
    /// The back, or the right half.
    let isSecond: Bool
}

/// UIKit's double-sided reading order over the pages it has: each page's
/// first side, then its second, then the next page's first.
struct CurlSequence {
    let offsets: Set<Int>

    func after(_ side: CurlSide) -> CurlSide? {
        side.isSecond
            ? self.side(side.offset + 1, second: false) : self.side(side.offset, second: true)
    }

    func before(_ side: CurlSide) -> CurlSide? {
        side.isSecond
            ? self.side(side.offset, second: false) : self.side(side.offset - 1, second: true)
    }

    private func side(_ offset: Int, second: Bool) -> CurlSide? {
        offsets.contains(offset) ? CurlSide(offset: offset, isSecond: second) : nil
    }
}

/// Snapshots of the page in front of the reader (offset 0) and its neighbours.
struct CurlPages {
    private var images: [Int: UIImage] = [:]

    init() {}

    init(current: UIImage) {
        images[0] = current
    }

    subscript(offset: Int) -> UIImage? {
        get { images[offset] }
        set { images[offset] = newValue }
    }

    var sequence: CurlSequence { CurlSequence(offsets: Set(images.keys)) }

    /// The ring once a turn of `dir` has landed: the page turned to is in
    /// front, the one turned from is behind it, and the far side is unknown.
    /// A turn across a chapter has no neighbour snapshot, so it brings its own.
    func landed(_ dir: Int, destination: UIImage? = nil) -> CurlPages {
        var ring = CurlPages()
        ring[0] = destination ?? images[dir]
        ring[-dir] = images[0]
        return ring
    }
}

/// One side of a page in the curl. A single column's front is the snapshot and
/// its back the paper, with the print showing through mirrored as it does on a
/// page; a spread's sides are the halves of its snapshot.
final class CurlPageController: UIViewController {
    /// How much of the front shows through the back.
    static let showThrough: CGFloat = 0.14

    let side: CurlSide
    private let image: UIImage
    private let layout: CurlLayout
    private let paper: UIColor

    init(image: UIImage, side: CurlSide, layout: CurlLayout, paper: UIColor) {
        self.image = image
        self.side = side
        self.layout = layout
        self.paper = paper
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    private var isBack: Bool { layout == .single && side.isSecond }

    override func loadView() {
        let view = UIView()
        view.backgroundColor = paper
        let print = UIImageView(image: printed)
        print.contentMode = .scaleToFill
        // `init(image:)` sizes the view to the image; autoresizing grows it
        // from the superview's frame, so both have to start at the same size.
        print.frame = view.bounds
        print.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        print.alpha = isBack ? Self.showThrough : 1
        view.addSubview(print)
        self.view = view
    }

    private var printed: UIImage {
        switch layout {
        case .single: isBack ? image.withHorizontallyFlippedOrientation() : image
        case .spread: image.half(right: side.isSecond)
        }
    }
}

private extension UIImage {
    /// The left or right half, cut down the middle where the spine is.
    func half(right: Bool) -> UIImage {
        guard let cgImage else { return self }
        let width = cgImage.width / 2
        let rect = CGRect(
            x: right ? cgImage.width - width : 0, y: 0, width: width, height: cgImage.height
        )
        guard let half = cgImage.cropping(to: rect) else { return self }
        return UIImage(cgImage: half, scale: scale, orientation: imageOrientation)
    }
}
