use super::*;

const PIECES: [u8; 20] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
];
/// The SHA-1 of `v1_info()`.
const V1_HASH: &str = "c17d23830376ac1478f394337fefbc169a9959ce";
const V1_BASE32: &str = "YF6SHAYDO2WBI6HTSQZX7354C2NJSWOO";

fn v1_info() -> Vec<u8> {
    let mut info = b"d6:lengthi3e4:name1:a12:piece lengthi16384e6:pieces20:".to_vec();
    info.extend_from_slice(&PIECES);
    info.push(b'e');
    info
}

/// A `.torrent` file around `info`, with a key before it and one after.
fn torrent_around(info: &[u8]) -> Vec<u8> {
    let mut file = b"d8:announce9:http://x/4:info".to_vec();
    file.extend_from_slice(info);
    file.extend_from_slice(b"7:comment2:hie");
    file
}

mod from_magnet {
    use super::*;

    #[test]
    fn reads_a_hex_hash_and_lowercases_it() {
        let magnet = format!("magnet:?xt=urn:btih:{}&dn=Dune", V1_HASH.to_uppercase());

        assert_eq!(from_magnet(&magnet).unwrap(), V1_HASH);
    }

    #[test]
    fn decodes_a_base32_hash_to_hex() {
        let magnet = format!("magnet:?dn=Dune&xt=urn:btih:{V1_BASE32}");

        assert_eq!(from_magnet(&magnet).unwrap(), V1_HASH);
    }

    #[test]
    fn refuses_a_magnet_with_only_a_v2_hash() {
        let magnet = format!("magnet:?xt=urn:btmh:1220{}", "ab".repeat(32));

        assert_eq!(from_magnet(&magnet), Err(InfohashError(NO_V1)));
    }

    #[test]
    fn refuses_a_hash_that_is_neither_hex_nor_base32() {
        for hash in ["abc", &"z".repeat(40), &"1".repeat(32)] {
            let magnet = format!("magnet:?xt=urn:btih:{hash}");

            assert!(from_magnet(&magnet).is_err(), "{hash}");
        }
    }
}

mod from_torrent {
    use super::*;

    #[test]
    fn hashes_the_raw_info_dictionary_whatever_surrounds_it() {
        assert_eq!(from_torrent(&torrent_around(&v1_info())).unwrap(), V1_HASH);
    }

    #[test]
    fn refuses_a_v2_only_torrent_that_has_no_pieces() {
        let info = b"d9:file treed1:ad0:d6:lengthi3eeee12:meta versioni2e4:name1:ae";

        assert_eq!(
            from_torrent(&torrent_around(info)),
            Err(InfohashError(NO_V1))
        );
    }

    #[test]
    fn refuses_input_that_is_not_a_torrent_without_guessing() {
        let cut = &torrent_around(&v1_info())[..30];
        let no_info = b"d8:announce9:http://x/e".as_slice();
        let deep = [
            b"d4:info".to_vec(),
            b"l".repeat(10_000),
            b"e".repeat(10_000),
        ]
        .concat();
        for input in [b"".as_slice(), b"hello", b"i3e", cut, no_info, &deep] {
            assert!(from_torrent(input).is_err(), "{input:?}");
        }
    }
}
