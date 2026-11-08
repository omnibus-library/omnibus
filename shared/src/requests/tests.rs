use super::*;

mod download_client_kind_protocol {
    use crate::book_requests::ReleaseProtocol;

    use super::*;

    #[test]
    fn qbittorrent_fetches_torrents() {
        assert_eq!(
            DownloadClientKind::Qbittorrent.protocol(),
            ReleaseProtocol::Torrent
        );
    }
}
