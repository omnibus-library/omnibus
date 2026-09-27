/**
 * A three-chapter EPUB whose nav doc lives in a subfolder of the OPF's own
 * directory, so its TOC hrefs are relative to the nav doc, not the package.
 *
 * Served by intercepting a real book's `/file` route rather than seeded, so
 * it doesn't ripple through `FIXTURE_BOOKS` and every exact-count assertion
 * (see `jpx_pdf.ts` for the same rationale).
 */
import JSZip from "jszip";

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

// The OPF sits at the ZIP ROOT, so every manifest href below is
// "OEBPS/…" — relative to the OPF's own directory (the root).
const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:omnibus-test:subfolder-nav</dc:identifier>
    <dc:title>Subfolder Nav Fixture</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="OEBPS/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="OEBPS/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="OEBPS/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="OEBPS/ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
  </spine>
</package>
`;

// The nav doc's own TOC hrefs are relative to ITSELF (OEBPS/), not to the
// package root — "ch1.xhtml", not "OEBPS/ch1.xhtml". This is the mismatch
// #2450 exists to resolve: a bare spine lookup against these hrefs misses.
const NAV_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Nav</title></head>
<body>
<nav epub:type="toc"><ol>
<li><a href="ch1.xhtml">Chapter One</a></li>
<li><a href="ch2.xhtml">Chapter Two</a></li>
<li><a href="ch3.xhtml">Chapter Three</a></li>
</ol></nav>
</body>
</html>
`;

function buildChapter(heading: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${heading}</title></head>
<body>
<h1>${heading}</h1>
<p>The first paragraph of ${heading}, written out long enough to give the
section some visible content once the reader renders it.</p>
<p>A second paragraph, so the chapter is more than a single line of text.</p>
</body>
</html>
`;
}

const FIXED_DATE = new Date("2024-01-01T00:00:00Z");

/** Assemble the fixture EPUB described above. */
export function buildSubfolderNavEpub(): Promise<Buffer> {
  const zip = new JSZip();
  // The mimetype file MUST be the first entry and stored without
  // compression for the EPUB to validate.
  zip.file("mimetype", "application/epub+zip", {
    compression: "STORE",
    date: FIXED_DATE,
  });
  zip.file("META-INF/container.xml", CONTAINER_XML, { date: FIXED_DATE });
  zip.file("content.opf", CONTENT_OPF, { date: FIXED_DATE });
  zip.file("OEBPS/nav.xhtml", NAV_XHTML, { date: FIXED_DATE });
  zip.file("OEBPS/ch1.xhtml", buildChapter("Chapter One"), {
    date: FIXED_DATE,
  });
  zip.file("OEBPS/ch2.xhtml", buildChapter("Chapter Two"), {
    date: FIXED_DATE,
  });
  zip.file("OEBPS/ch3.xhtml", buildChapter("Chapter Three"), {
    date: FIXED_DATE,
  });
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}
