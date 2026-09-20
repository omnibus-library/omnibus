# Running Omnibus with Docker

Omnibus is published as a ready-to-run image on Docker Hub:
[`sesloan/omnibus`](https://hub.docker.com/r/sesloan/omnibus/tags). It runs on
amd64 and arm64 and already contains everything the server needs, including
ffmpeg for audiobook streaming and kepubify for Kobo downloads. You do not need
a copy of this repository to run it. A folder and a compose file are enough.

## Quick start

1. Make a folder for Omnibus and open a terminal in it:

   ```bash
   mkdir omnibus && cd omnibus
   ```

2. Save the following as `docker-compose.yml` in that folder:

   ```yaml
   services:
     omnibus:
       image: sesloan/omnibus:latest
       container_name: omnibus
       restart: unless-stopped

       ports:
         - "3000:3000"                            # host:container — change the left side if 3000 is taken

       volumes:
         - ./config:/config                       # database, covers, journal images — back this up
         - ./cache:/cache                         # thumbnails and audio transcodes — safe to delete
         - /path/to/your/ebooks:/books            # EDIT: your ebook folder
         - /path/to/your/audiobooks:/audiobooks   # EDIT: your audiobook folder

       environment:
         PUID: "1000"                             # EDIT if `id -u` is not 1000 — files are written as this user
         PGID: "1000"                             # EDIT if `id -g` is not 1000
         OMNIBUS_PUBLIC_ORIGIN: "http://localhost:3000"   # EDIT: the exact address you open in the browser
         OMNIBUS_SECURE_COOKIES: "0"              # 0 over plain http; set to 1 (or remove) behind HTTPS
         EBOOK_LIBRARY_PATH: "/books"
         AUDIOBOOK_LIBRARY_PATH: "/audiobooks"
   ```

3. Change the lines marked `EDIT`:

   - **The two library paths.** Replace `/path/to/your/ebooks` and
     `/path/to/your/audiobooks` with the folders on your machine. Leave the
     right-hand side (`/books`, `/audiobooks`) alone. If you only have one kind
     of library, point both at real folders anyway. An empty one is fine.
   - **`OMNIBUS_PUBLIC_ORIGIN`.** The address you will actually type into the
     browser. `http://localhost:3000` is right if you open it on the same
     machine. If you will open it from another device on your network, use that
     address instead, for example `http://192.168.1.10:3000`. You can list
     several, separated by commas. If this does not match, logging in fails
     with a 403.
   - **`PUID` and `PGID`**, if your user is not `1000`. Run `id -u` and `id -g`
     to check. Omnibus writes its database and cache as this user, so the files
     end up owned by you rather than root.

4. Start it:

   ```bash
   docker compose up -d
   ```

5. Open the address you set in a browser and register. **The first account
   created is the admin.** Omnibus scans both libraries on every start.

## Already have a compose file?

- Copy the `omnibus:` block into your `services:` section.
- Make the same `EDIT` changes.
- `./config` and `./cache` are relative to your compose file. Use an absolute path if you prefer, e.g. `/srv/omnibus/config:/config`.
- Port 3000 taken? Change the left side of `ports`, and change `OMNIBUS_PUBLIC_ORIGIN` to match.

## Settings

| Setting | Meaning |
|---|---|
| `./config:/config` | Database, covers, journal images. **Back this up.** |
| `./cache:/cache` | Thumbnails and audio transcodes. Safe to delete. |
| `/books`, `/audiobooks` | Your libraries. Add `:ro` to make them read-only (disables in-app uploads). |
| `PUID`, `PGID` | Run as this user and group. Files land owned by you. |
| `OMNIBUS_PUBLIC_ORIGIN` | The address you open in the browser. Must match, or login fails. Comma-separate several. |
| `OMNIBUS_SECURE_COOKIES` | `0` on plain http. `1` or removed behind HTTPS. |
| `EBOOK_LIBRARY_PATH`, `AUDIOBOOK_LIBRARY_PATH` | Library folders inside the container. Leave as is. Remove **both** to set libraries in the app instead. |

More optional settings: [`.env.example`](../.env.example).

## Backups

- Back up `config`. It cannot be rebuilt.
- Skip `cache`. Omnibus rebuilds it.
- Your library folders are yours. Omnibus never moves or renames files in them.

## Behind a reverse proxy (HTTPS)

- Terminate TLS in nginx, Caddy or Traefik. Proxy to port 3000.
- Set `OMNIBUS_PUBLIC_ORIGIN` to your `https://` address.
- Set `OMNIBUS_SECURE_COOKIES` to `1`, or remove it.
- Optional: `OMNIBUS_TRUST_FORWARDED_FOR: "1"` so rate limiting sees real client IPs. Only if your proxy strips incoming `X-Forwarded-For`.

## Updating

```bash
docker compose pull
docker compose up -d
```

- `latest` is the newest release.
- Pin a version with a tag, e.g. `sesloan/omnibus:0.37.4`.
- Database migrations run on start.

## Locked out?

- Add `OMNIBUS_INITIAL_ADMIN: "yourusername"` to `environment`. Use an account that exists.
- Restart once. That account is now admin.
- **Remove the line.** It re-promotes on every start while set.

## Building from source

- Clone the repo.
- In `docker-compose.yml`, replace `image:` with `build: .`.
- Run `docker compose up -d --build`. The first build is slow.

## Troubleshooting

- **Login does nothing / 403.** `OMNIBUS_PUBLIC_ORIGIN` does not match your browser address, or `OMNIBUS_SECURE_COOKIES` is not `0` on plain http.
- **Page will not load.** The host port is taken, or you opened the container port instead of the host port.
- **Library is empty.** The host paths on the left of `/books` and `/audiobooks` do not exist, or the `PUID` user cannot read them.
- **Audiobooks will not play.** Check `docker compose logs omnibus` for transcode errors. Confirm the audiobook folder is not empty.
- **Files owned by root.** Set `PUID` and `PGID` to your IDs. Then `chown` anything created before the change.

## Upgrading from an early release

- Journal images used to live under `/cache`.
- First start after upgrading moves them to `/config/journal-images`.
- The log line `relocated journal images out of the data dir default` reports `moved` and `found`. Equal means done.
- `moved` lower than `found`? A `failed to relocate journal image` warning names each file. Fix those before deleting `cache`.
- Cache already cleared on an affected release? Those images are gone. Their entries show a broken image.
