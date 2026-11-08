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

    #[test]
    fn transmission_fetches_torrents() {
        assert_eq!(
            DownloadClientKind::Transmission.protocol(),
            ReleaseProtocol::Torrent
        );
    }

    #[test]
    fn sabnzbd_fetches_usenet() {
        assert_eq!(
            DownloadClientKind::Sabnzbd.protocol(),
            ReleaseProtocol::Usenet
        );
    }
}
