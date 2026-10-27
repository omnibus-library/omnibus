//  StoredZip.swift
//  A minimal stored (uncompressed) zip writer for test fixtures — CBZs and
//  EPUBs built in memory, entry by entry, with each entry's CRC recorded so a
//  test can corrupt a byte and know the checksum no longer matches.

import Foundation

/// CRC-32 (IEEE), the checksum zip records per entry.
private func crc32(_ data: Data) -> UInt32 {
    var crc: UInt32 = 0xFFFF_FFFF
    for byte in data {
        crc ^= UInt32(byte)
        for _ in 0..<8 {
            crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB8_8320 : crc >> 1
        }
    }
    return ~crc
}

/// Minimal stored (uncompressed) zip: local headers, data, central
/// directory, EOCD. Port of `db::test_support::build_stored_zip`.
func buildStoredZip(_ entries: [(String, Data)]) -> Data {
    var out = Data()
    var central = Data()

    func append<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
        withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
    }

    for (name, bytes) in entries {
        let offset = UInt32(out.count)
        let crc = crc32(bytes)
        let nameBytes = Data(name.utf8)
        let size = UInt32(bytes.count)

        append(UInt32(0x0403_4B50), to: &out)
        append(UInt16(20), to: &out) // version needed
        append(UInt16(0), to: &out) // flags
        append(UInt16(0), to: &out) // method: stored
        append(UInt16(0), to: &out) // mod time
        append(UInt16(0), to: &out) // mod date
        append(crc, to: &out)
        append(size, to: &out) // compressed size
        append(size, to: &out) // uncompressed size
        append(UInt16(nameBytes.count), to: &out)
        append(UInt16(0), to: &out) // extra len
        out.append(nameBytes)
        out.append(bytes)

        append(UInt32(0x0201_4B50), to: &central)
        append(UInt16(20), to: &central) // version made by
        append(UInt16(20), to: &central) // version needed
        append(UInt16(0), to: &central) // flags
        append(UInt16(0), to: &central) // method
        append(UInt16(0), to: &central) // mod time
        append(UInt16(0), to: &central) // mod date
        append(crc, to: &central)
        append(size, to: &central)
        append(size, to: &central)
        append(UInt16(nameBytes.count), to: &central)
        append(UInt16(0), to: &central) // extra
        append(UInt16(0), to: &central) // comment
        append(UInt16(0), to: &central) // disk start
        append(UInt16(0), to: &central) // internal attrs
        append(UInt32(0), to: &central) // external attrs
        append(offset, to: &central)
        central.append(nameBytes)
    }

    let cdOffset = UInt32(out.count)
    out.append(central)
    append(UInt32(0x0605_4B50), to: &out)
    append(UInt16(0), to: &out) // this disk
    append(UInt16(0), to: &out) // cd start disk
    append(UInt16(entries.count), to: &out)
    append(UInt16(entries.count), to: &out)
    append(UInt32(central.count), to: &out)
    append(cdOffset, to: &out)
    append(UInt16(0), to: &out) // comment len
    return out
}
