use super::*;

const ALL: [DownloadClientKind; 4] = [
    DownloadClientKind::Qbittorrent,
    DownloadClientKind::Transmission,
    DownloadClientKind::Sabnzbd,
    DownloadClientKind::Nzbget,
];

mod download_client_kind_tokens {
    use super::*;

    #[test]
    fn round_trip_through_the_stored_token_for_every_kind() {
        for kind in ALL {
            assert_eq!(DownloadClientKind::from_str_or_default(kind.as_str()), kind);
        }
    }

    #[test]
    fn use_the_lowercase_names_the_settings_table_stores() {
        let tokens: Vec<&str> = ALL.iter().map(|k| k.as_str()).collect();
        assert_eq!(tokens, ["qbittorrent", "transmission", "sabnzbd", "nzbget"]);
    }

    #[test]
    fn fall_back_to_qbittorrent_for_an_unknown_token() {
        assert_eq!(
            DownloadClientKind::from_str_or_default("deluge"),
            DownloadClientKind::Qbittorrent
        );
    }
}

mod download_client_kind_protocol {
    use crate::book_requests::ReleaseProtocol;

    use super::*;

    #[test]
    fn torrent_clients_fetch_torrents() {
        assert_eq!(
            DownloadClientKind::Qbittorrent.protocol(),
            ReleaseProtocol::Torrent
        );
        assert_eq!(
            DownloadClientKind::Transmission.protocol(),
            ReleaseProtocol::Torrent
        );
    }

    #[test]
    fn usenet_clients_fetch_usenet() {
        assert_eq!(
            DownloadClientKind::Sabnzbd.protocol(),
            ReleaseProtocol::Usenet
        );
        assert_eq!(
            DownloadClientKind::Nzbget.protocol(),
            ReleaseProtocol::Usenet
        );
    }
}
