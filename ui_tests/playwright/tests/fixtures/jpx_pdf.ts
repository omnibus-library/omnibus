/**
 * A two-page PDF whose only content is one JPEG 2000 (`JPXDecode`) image,
 * built in memory so the PDF reader spec can prove the vendored OpenJPEG
 * decoder is fetched and actually decodes — PDF.js 6 drops every JPX image
 * silently when its `wasmUrl` is unset, and the public-domain PDF fixtures
 * carry no JPX at all, so nothing else in the suite would notice.
 *
 * It is served by intercepting a real book's `/file` route rather than
 * seeded into the library: a new fixture file would ripple through
 * `FIXTURE_BOOKS`, the Rust mirror, and every exact-count assertion.
 *
 * Two pages, not one, so opening lands on page 1 *of 2* and the reader's
 * auto read-status never sees the book's end (that write is reserved for
 * the write-path tests).
 */

/** The image's solid fill, `[r, g, b]` — what the canvas must paint. */
export const JPX_FILL: readonly [number, number, number] = [220, 90, 30];

// A 16×16 solid `JPX_FILL` image as a JP2 file (250 bytes), encoded once
// with Pillow's OpenJPEG backend, lossless:
//   Image.new("RGB", (16, 16), (220, 90, 30)).save(buf, format="JPEG2000",
//       irreversible=False, quality_mode="rates", quality_layers=[1])
// There is no JPEG 2000 encoder in the Node toolchain, hence the constant.
const JP2_BASE64 =
  "AAAADGpQICANCocKAAAAFGZ0eXBqcDIgAAAAAGpwMiAAAAAtanAyaAAAABZpaGRyAAAAEAAAABAAAwcHAAAAAAAPY29scgEAAAAAABAAAACtanAyY/9P/1EALwAAAAAAEAAAABAAAAAAAAAAAAAAABAAAAAQAAAAAAAAAAAAAwcBAQcBAQcBAf9SAAwAAAABAAQEBAAB/1wAEEBASEhQSEhQSEhQSEhQ/2QAJQABQ3JlYXRlZCBieSBPcGVuSlBFRyB2ZXJzaW9uIDIuNS40/5AACgAAAAAAKQAB/5PPtAgDM8fUBAa/z7QICJ+AgICAgICAgICAgID/2Q==";

const PAGE_SIZE = 200;

/** Assemble the PDF: catalog, pages, two pages sharing one image XObject. */
export function buildJpxPdf(): Buffer {
  const jp2 = Buffer.from(JP2_BASE64, "base64");
  const content = Buffer.from(
    `q ${PAGE_SIZE} 0 0 ${PAGE_SIZE} 0 0 cm /Im0 Do Q`,
    "latin1",
  );
  const page = () =>
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_SIZE} ${PAGE_SIZE}] ` +
        `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 6 0 R >>`,
      "latin1",
    );
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>", "latin1"),
    page(),
    page(),
    Buffer.concat([
      Buffer.from(
        "<< /Type /XObject /Subtype /Image /Width 16 /Height 16 " +
          "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode " +
          `/Length ${jp2.length} >>\nstream\n`,
        "latin1",
      ),
      jp2,
      Buffer.from("\nendstream", "latin1"),
    ]),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "latin1"),
      content,
      Buffer.from("\nendstream", "latin1"),
    ]),
  ];

  const parts: Buffer[] = [
    Buffer.from("%PDF-1.5\n%\xe2\xe3\xcf\xd3\n", "latin1"),
  ];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const obj = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    parts.push(obj);
    length += obj.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}
