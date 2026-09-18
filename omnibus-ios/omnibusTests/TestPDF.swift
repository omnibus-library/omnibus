//  TestPDF.swift
//  A hand-assembled, byte-deterministic PDF for the PDF reader's tests — a
//  port of `db::test_support::build_test_pdf`, so a fixture pinned on the
//  server side is the same bytes here. One content stream per page in
//  base-14 Helvetica, an optional outline, and an optional `/Rotate` on every
//  page: enough for PDFKit to extract text, place a selection, and walk the
//  outline, with no fixture on disk.

import Foundation

struct TestPDF {
    /// One entry per page; `\n` separates that page's lines.
    var pages: [String] = []
    var title: String?
    var author: String?
    var outline: [(title: String, page: Int)] = []
    var rotate: Int?

    func build() -> Data {
        func escape(_ text: String) -> String {
            var out = ""
            for ch in text {
                switch ch {
                case "(", ")", "\\":
                    out.append("\\")
                    out.append(ch)
                case "\n", "\r":
                    break
                default:
                    out.append(ch.isASCII ? ch : "?")
                }
            }
            return out
        }
        func utf16String(_ text: String) -> String {
            "<FEFF" + text.utf16.map { String(format: "%04X", $0) }.joined() + ">"
        }

        let pageCount = max(pages.count, 1)
        let firstPageObj = 4
        func objForPage(_ i: Int) -> Int { firstPageObj + i * 2 }
        let infoObj = firstPageObj + pageCount * 2
        let outlinesObj = infoObj + 1
        func itemObj(_ i: Int) -> Int { outlinesObj + 1 + i }
        let totalObjs = outline.isEmpty ? infoObj : outlinesObj + outline.count

        var objects: [(Int, String)] = []
        let outlinesRef = outline.isEmpty ? "" : " /Outlines \(outlinesObj) 0 R"
        objects.append((1, "<< /Type /Catalog /Pages 2 0 R\(outlinesRef) >>"))
        let kids = (0..<pageCount).map { "\(objForPage($0)) 0 R" }.joined(separator: " ")
        objects.append((2, "<< /Type /Pages /Kids [\(kids)] /Count \(pageCount) >>"))
        objects.append((3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"))
        for i in 0..<pageCount {
            let text = i < pages.count ? pages[i] : ""
            var content = "BT /F1 12 Tf 14 TL 72 720 Td "
            for (n, line) in text.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
                if n > 0 { content += "T* " }
                content += "(\(escape(String(line)))) Tj "
            }
            content += "ET"
            let rotation = rotate.map { " /Rotate \($0)" } ?? ""
            objects.append((
                objForPage(i),
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\(rotation) "
                    + "/Resources << /Font << /F1 3 0 R >> >> /Contents \(objForPage(i) + 1) 0 R >>"
            ))
            objects.append((
                objForPage(i) + 1,
                "<< /Length \(content.utf8.count) >>\nstream\n\(content)\nendstream"
            ))
        }
        var info = "<<"
        if let title { info += " /Title \(utf16String(title))" }
        if let author { info += " /Author \(utf16String(author))" }
        info += " /Producer (omnibus test_support) >>"
        objects.append((infoObj, info))
        if !outline.isEmpty {
            let last = outline.count - 1
            objects.append((
                outlinesObj,
                "<< /Type /Outlines /First \(itemObj(0)) 0 R /Last \(itemObj(last)) 0 R /Count \(outline.count) >>"
            ))
            for (i, entry) in outline.enumerated() {
                let page = min(entry.page, pageCount - 1)
                var item = "<< /Title \(utf16String(entry.title)) /Parent \(outlinesObj) 0 R "
                    + "/Dest [\(objForPage(page)) 0 R /XYZ 0 792 0]"
                if i > 0 { item += " /Prev \(itemObj(i - 1)) 0 R" }
                if i < last { item += " /Next \(itemObj(i + 1)) 0 R" }
                item += " >>"
                objects.append((itemObj(i), item))
            }
        }
        objects.sort { $0.0 < $1.0 }

        var out = Data()
        out.append(contentsOf: Array("%PDF-1.4\n".utf8))
        out.append(contentsOf: [0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])
        var offsets = [Int](repeating: 0, count: totalObjs + 1)
        for (num, body) in objects {
            offsets[num] = out.count
            out.append(contentsOf: Array("\(num) 0 obj\n\(body)\nendobj\n".utf8))
        }
        let xrefAt = out.count
        out.append(contentsOf: Array("xref\n0 \(totalObjs + 1)\n".utf8))
        out.append(contentsOf: Array("0000000000 65535 f \n".utf8))
        for offset in offsets.dropFirst() {
            out.append(contentsOf: Array(String(format: "%010d 00000 n \n", offset).utf8))
        }
        let trailer = "trailer\n<< /Size \(totalObjs + 1) /Root 1 0 R /Info \(infoObj) 0 R >>\n"
            + "startxref\n\(xrefAt)\n%%EOF\n"
        out.append(contentsOf: Array(trailer.utf8))
        return out
    }

    /// Write the bytes somewhere PDFKit can open them by URL.
    func write(named name: String = UUID().uuidString) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).pdf")
        try build().write(to: url)
        return url
    }
}
