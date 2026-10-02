//  PageCurl.swift
//  What the page curl is made of: snapshots of the page in front of the reader
//  and its neighbours, the order UIKit turns through them, and the view each
//  side of a page shows. `PageCurlHost` drives these over the web view.

import UIKit

/// How the reader lays its pages out, as far as the curl is concerned.
///
/// Only a single column curls. A spread — two columns on a landscape phone, or
/// one per screen on a two-screen device — keeps the slide until it has a curl
/// of its own, which turns two-page sheets about a spine at `.mid`.
enum CurlLayout: Equatable {
    case single
    case spread

    init(columns: Int?) {
        self = columns == 1 ? .single : .spread
    }
}

/// One side of one page in the curl, by offset from the page in front.
struct CurlSide: Equatable {
    let offset: Int
    let isBack: Bool
}

/// UIKit's double-sided reading order over the pages it has: each page's
/// front, then its back, then the next page's front.
struct CurlSequence {
    let offsets: Set<Int>

    func after(_ side: CurlSide) -> CurlSide? {
        side.isBack ? self.side(side.offset + 1, back: false) : self.side(side.offset, back: true)
    }

    func before(_ side: CurlSide) -> CurlSide? {
        side.isBack ? self.side(side.offset, back: false) : self.side(side.offset - 1, back: true)
    }

    private func side(_ offset: Int, back: Bool) -> CurlSide? {
        offsets.contains(offset) ? CurlSide(offset: offset, isBack: back) : nil
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

/// One side of a page in the curl. The front is the snapshot; the back is
/// the paper, with the print showing through mirrored as it does on a page.
final class CurlPageController: UIViewController {
    /// How much of the front shows through the back.
    static let showThrough: CGFloat = 0.14

    let side: CurlSide
    private let image: UIImage
    private let paper: UIColor

    init(image: UIImage, side: CurlSide, paper: UIColor) {
        self.image = image
        self.side = side
        self.paper = paper
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func loadView() {
        let view = UIView()
        view.backgroundColor = paper
        let print = UIImageView(
            image: side.isBack ? image.withHorizontallyFlippedOrientation() : image
        )
        print.contentMode = .scaleToFill
        // `init(image:)` sizes the view to the image; autoresizing grows it
        // from the superview's frame, so both have to start at the same size.
        print.frame = view.bounds
        print.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        print.alpha = side.isBack ? Self.showThrough : 1
        view.addSubview(print)
        self.view = view
    }
}
