//  CarPlayGlyph.swift
//  One-colour bitmaps for Now Playing's buttons, drawn from an SF Symbol or a short label.
//
//  CarPlay retints a Now Playing button's image itself, so it wants a plain
//  one-colour bitmap no larger than `CPNowPlayingButtonMaximumImageSize`. A
//  symbol image handed over as-is has been reported to render as a solid block,
//  and the speed button's "1.2x" has no symbol at all — so both are drawn here.

#if canImport(CarPlay)
import CarPlay
import UIKit

enum CarPlayGlyph {
    /// `name` drawn white, centred, at the button's size.
    static func symbol(_ name: String) -> UIImage {
        let size = CPNowPlayingButtonMaximumImageSize
        let config = UIImage.SymbolConfiguration(pointSize: size.height * 0.75, weight: .medium)
        guard let symbol = UIImage(systemName: name, withConfiguration: config)?
            .withTintColor(.white, renderingMode: .alwaysOriginal)
        else { return UIImage() }
        return UIGraphicsImageRenderer(size: size).image { _ in
            symbol.draw(in: centred(symbol.size, in: size))
        }
    }

    /// `label` drawn white, shrunk until it fits the button.
    static func text(_ label: String) -> UIImage {
        let size = CPNowPlayingButtonMaximumImageSize
        var font = UIFont.systemFont(ofSize: size.height * 0.7, weight: .semibold)
        var attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white]
        while (label as NSString).size(withAttributes: attributes).width > size.width, font.pointSize > 6 {
            font = font.withSize(font.pointSize - 1)
            attributes[.font] = font
        }
        let measured = (label as NSString).size(withAttributes: attributes)
        return UIGraphicsImageRenderer(size: size).image { _ in
            (label as NSString).draw(in: centred(measured, in: size), withAttributes: attributes)
        }
    }

    /// `content` scaled to fit `bounds`, centred.
    private static func centred(_ content: CGSize, in bounds: CGSize) -> CGRect {
        let scale = min(1, bounds.width / max(content.width, 1), bounds.height / max(content.height, 1))
        let fitted = CGSize(width: content.width * scale, height: content.height * scale)
        return CGRect(
            x: (bounds.width - fitted.width) / 2, y: (bounds.height - fitted.height) / 2,
            width: fitted.width, height: fitted.height
        )
    }
}
#endif
