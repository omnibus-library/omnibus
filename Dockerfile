# syntax=docker/dockerfile:1

###############################################################################
# Builder — compiles the `omnibus` server binary (`server/`). A plain Rust
# toolchain rather than the Nix dev shell keeps the image conventional and light.
###############################################################################
# Debian 13 (trixie): the runtime stage must share this glibc baseline, since
# the server binary is compiled here.
FROM rust:1-trixie AS builder

# `clang`/`pkg-config` cover the handful of -sys crates. sqlite is statically
# bundled by libsqlite3-sys and TLS is rustls, so no libsqlite3/openssl dev packages.
RUN apt-get update && apt-get install -y --no-install-recommends \
        clang pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .

RUN cargo build --release --locked -p omnibus --bin omnibus

###############################################################################
# React — the frontend-js client, the web UI the server serves at `/`. Each
# text asset gets a brotli and a gzip sibling, which the server sends to a
# browser that accepts that encoding (`backend::react_ui`).
###############################################################################
FROM node:22-trixie-slim AS react

RUN apt-get update && apt-get install -y --no-install-recommends brotli \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

WORKDIR /src
# orval generates the API client from the spec during `pnpm install`.
COPY openapi/openapi.json openapi/
COPY frontend-js/ frontend-js/

# Release tag (e.g. "v0.8.9") the client shows as its version; every merge to
# main cuts a release (.github/workflows/release.yml) but package.json never
# carries it.
ARG OMNIBUS_VERSION
ENV OMNIBUS_VERSION=${OMNIBUS_VERSION}

# Corepack picks pnpm from the working directory's package.json, not `--dir`.
WORKDIR /src/frontend-js
RUN pnpm install --frozen-lockfile && pnpm run build \
    && find dist -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.css' -o -name '*.html' \
        -o -name '*.svg' -o -name '*.json' -o -name '*.wasm' -o -name '*.txt' \) \
        -exec brotli --keep --best {} + -exec gzip --keep --best {} +

###############################################################################
# Runtime — slim image carrying just the bundle, ffmpeg (audiobook HLS
# transcode), kepubify (EPUB→KEPUB for the "Send to Kobo" download), CA certs
# (remote cover/author-photo fetches), curl (health probe), and gosu
# (privilege drop). Starts as root so the PUID/PGID entrypoint can remap the
# app user, then drops to it before serving.
###############################################################################
# Must match the builder's glibc (trixie) — the server binary is linked against it.
FROM debian:trixie-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg ca-certificates curl gosu \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --user-group --create-home --shell /usr/sbin/nologin omnibus

# kepubify is a single Go binary, not a Debian package — fetch the release
# matching the image architecture. `db::kepub` invokes it on PATH (or via
# OMNIBUS_KEPUBIFY_PATH). Absence is non-fatal (falls back to plain EPUB), but
# ship it so the "Send to Kobo" download serves optimized KEPUB by default.
ARG KEPUBIFY_VERSION=v4.0.4
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
        amd64) kbin=kepubify-linux-64bit ;; \
        arm64) kbin=kepubify-linux-arm64 ;; \
        *) echo "unsupported arch for kepubify: $arch" >&2; exit 1 ;; \
    esac; \
    curl -L --proto '=https' --tlsv1.2 -sSf \
        "https://github.com/pgaskin/kepubify/releases/download/${KEPUBIFY_VERSION}/${kbin}" \
        -o /usr/local/bin/kepubify; \
    chmod +x /usr/local/bin/kepubify; \
    kepubify --version

WORKDIR /app
COPY --from=builder /src/target/release/omnibus /app/server
# docker/entrypoint.sh points OMNIBUS_REACT_DIR here.
COPY --from=react /src/frontend-js/dist/ /app/react/
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Re-declared in this stage (ARG/ENV don't cross a `FROM` boundary) so the
# running server reads its own release tag at boot — `/api/_health` reports
# `std::env::var("OMNIBUS_VERSION")`.
ARG OMNIBUS_VERSION

# Bind on all interfaces (the server defaults to 127.0.0.1, unreachable from
# outside the container) and default the persistent paths into the /config
# and /cache volumes. Everything here is overridable in docker-compose.yml.
# The split is what a delete of /cache costs: only paths the server can
# rebuild belong there, so journal images sit in /config beside the covers.
ENV IP=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL="sqlite:///config/omnibus.db?mode=rwc" \
    OMNIBUS_COVERS_DIR=/config/covers \
    OMNIBUS_JOURNAL_IMAGES_DIR=/config/journal-images \
    OMNIBUS_THUMBS_DIR=/cache/thumbs \
    OMNIBUS_DATA_DIR=/cache/data \
    OMNIBUS_VERSION=${OMNIBUS_VERSION}

EXPOSE 3000
VOLUME ["/config", "/cache"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/api/_health" || exit 1

# Runs as root; the entrypoint applies PUID/PGID and drops to the omnibus user.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/app/server"]
