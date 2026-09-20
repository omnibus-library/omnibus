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

## Adding Omnibus to a compose file you already have

Copy the `omnibus:` block from the snippet above into your own `services:`
section and make the same edits. Two things to watch:

- `./config` and `./cache` are relative to *your* compose file. Point them at a
  folder you are happy to keep, such as `/srv/omnibus/config`.
- If port 3000 is already taken on the host, change the left side of the
  `ports` line, and change `OMNIBUS_PUBLIC_ORIGIN` to match.

## What the settings mean

| Setting | What it does |
|---|---|
| `./config:/config` | Where the database, cover images and journal images live. This is the only folder you need to back up. |
| `./cache:/cache` | Thumbnails and transcoded audio. Omnibus rebuilds these as needed, so the folder can be deleted at any time. |
| `/books`, `/audiobooks` | Your libraries. Mounted read-write so that books uploaded through the app land next to the rest. Mount them read-only (`:ro`) if you never want Omnibus to write there. |
| `PUID`, `PGID` | The user and group the server runs as. Same convention as the linuxserver.io images. |
| `OMNIBUS_PUBLIC_ORIGIN` | The address(es) you open the app from. Requests that do not come from one of these are rejected. |
| `OMNIBUS_SECURE_COOKIES` | `0` while you use plain `http://`. Set it to `1`, or remove it, once you are behind HTTPS. |
| `EBOOK_LIBRARY_PATH`, `AUDIOBOOK_LIBRARY_PATH` | The two library folders as seen inside the container. Leave them as they are unless you rename the mounts. Remove **both** to set the libraries from the in-app Settings page instead. |

The full list of optional settings, such as cache size caps, is in
[`.env.example`](../.env.example).

## Backups

Back up the `config` folder. That is the database, the cover art and the images
attached to journal entries, none of which can be rebuilt from your library
files. The `cache` folder is not worth backing up. Your library folders are
your own files and Omnibus never moves or renames them.

## Behind a reverse proxy (HTTPS)

Terminate TLS in nginx, Caddy or Traefik and proxy to the container's port
3000. Then:

- set `OMNIBUS_PUBLIC_ORIGIN` to your public `https://` address,
- set `OMNIBUS_SECURE_COOKIES` to `1` or remove the line,
- optionally set `OMNIBUS_TRUST_FORWARDED_FOR: "1"` so rate limiting sees real
  client addresses. Only do this if the proxy strips the incoming
  `X-Forwarded-For` header, otherwise clients can forge it.

## Updating

```bash
docker compose pull
docker compose up -d
```

`latest` follows the newest release. To stay on a specific version, use a
tag like `sesloan/omnibus:0.37.4` instead. Database migrations run automatically
on start.

## If you lock yourself out

Add `OMNIBUS_INITIAL_ADMIN: "yourusername"` to the `environment` block, naming
an account that already exists, and restart once. That account is now an admin.
**Remove the line afterwards.** It re-promotes the account on every start while
it is set.

## Building from source

If you would rather build the image yourself, clone the repository and replace
the `image:` line in `docker-compose.yml` with `build: .`, then run
`docker compose up -d --build`. The first build compiles the whole workspace
and takes a while.

## Troubleshooting

- **Login does nothing, or a 403 appears** — `OMNIBUS_PUBLIC_ORIGIN` does not
  match the address in your browser, or `OMNIBUS_SECURE_COOKIES` is not `0`
  while you are on plain http.
- **The page will not load at all** — check that the host port in `ports` is
  free, and that you are using the host side of that mapping in the browser.
- **The library is empty** — the paths on the left of the `/books` and
  `/audiobooks` lines must exist on the host, and the container must be able to
  read them as the `PUID` user.
- **Audiobooks will not play** — check `docker compose logs omnibus` for
  transcode errors and confirm the audiobook folder is not empty.
- **Files are owned by root** — set `PUID` and `PGID` to your own IDs. The
  entrypoint only fixes ownership of the `config` and `cache` folders
  themselves, so `chown` anything that was created before you changed them.

## Note for people upgrading from an early release

Journal images used to be written under `/cache`. The first start after
upgrading moves them into `/config/journal-images` and logs `relocated journal
images out of the data dir default` with `moved` and `found` counts. If the two
numbers match there is nothing to do. If `moved` is lower, a `failed to relocate
journal image` warning names each file left behind, so fix that before deleting
the cache folder. If the cache was already cleared on an affected release those
images are gone and the entries that used them show a broken image.
