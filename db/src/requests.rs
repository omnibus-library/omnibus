//! The book-request pipeline's links to the outside world: the download client the server
//! hands links to, and the folder mapping that turns its finished files into local ones.
//! The URLs here are the admin's own LAN services (`http://qbittorrent:8080`), so this
//! module deliberately does not use the author-photo SSRF guard that refuses private
//! addresses; its calls go out only to the connections an admin saved.

pub mod paths;
