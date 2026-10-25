# KOReader image: the pinned release under Xvfb, driven by the lane's user patch
# or shown in a browser by `just koreader`. The version is pinned in one file,
# koreader.sha256: one line per arch, all the same version, and the URL derives from it.
FROM debian:trixie-slim

COPY koreader.sha256 /tmp/koreader.sha256

# The .deb's own Depends: is KOReader's runtime, so none of it is hand-listed here.
# sha256sum -c gates this arch's pin line before anything is installed; no pin fails the build.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    arch="$(dpkg --print-architecture)"; \
    grep -E " koreader_.*_${arch}\.deb\$" /tmp/koreader.sha256 >/tmp/koreader.pin || \
        { echo "no KOReader pin for architecture $arch in koreader.sha256" >&2; exit 1; }; \
    deb="$(awk '{print $2}' /tmp/koreader.pin)"; \
    ver="${deb#koreader_}"; \
    ver="${ver%%-*}"; \
    curl -fsSL --proto '=https' --tlsv1.2 \
        -o "/tmp/$deb" \
        "https://github.com/koreader/koreader/releases/download/v$ver/$deb"; \
    (cd /tmp && sha256sum -c koreader.pin); \
    apt-get install -y --no-install-recommends "/tmp/$deb" xvfb xauth x11vnc novnc websockify; \
    rm -rf /var/lib/apt/lists/* /tmp/koreader.sha256 /tmp/koreader.pin "/tmp/$deb"

# KO_HOME is KOReader's data dir, its patches dir, and — as the CMD's
# argument — the directory it opens. World-writable: the container runs as
# the invoking uid (--user $(id -u):$(id -g)).
ENV KO_HOME=/ko-home
RUN mkdir -p /ko-home && chmod 777 /ko-home

# The interactive entry for `just koreader` (scripts/koreader-dev.sh); the lane
# runs the CMD below and never this.
COPY koreader-vnc.sh /usr/local/bin/koreader-vnc

CMD ["xvfb-run", "-a", "koreader", "/ko-home"]
