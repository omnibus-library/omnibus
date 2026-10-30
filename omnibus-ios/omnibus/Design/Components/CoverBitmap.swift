//  CoverBitmap.swift
//  A book's cover as a finished bitmap: the generated plate with the art, if any, over it.
//
//  For the surfaces that take an image rather than a view — CarPlay's list rows
//  and the Now Playing artwork the lock screen and the car share. The plate goes
//  under every cover, as in `BookCover`: some covers are transparent PNGs, and a
//  book with no art still gets a picture rather than the system's blank note.

import SwiftUI

enum CoverBitmap {
    /// `identity`'s plate with `art` filled over it, `size` points drawn at `scale`.
    @MainActor
    static func render(
        _ identity: CoverIdentity, art: UIImage?, size: CGSize, cornerRadius: CGFloat = 0, scale: CGFloat
    ) -> UIImage? {
        let renderer = ImageRenderer(
            content: GeneratedCoverPlate(identity: identity)
                .frame(width: size.width, height: size.height)
                .overlay {
                    if let art { Image(uiImage: art).resizable().scaledToFill() }
                }
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        )
        renderer.scale = scale
        return renderer.uiImage
    }
}
