# KOReader test lane image: the pinned KOReader release under Xvfb, driven by
# the user patch scripts/koreader-e2e.sh mounts at /ko-home/patches.
#
# The KOReader version lives in ONE place: the koreader.sha256 pin, one line
# per architecture. A file name carries the version (koreader_<ver>-1_<arch>.deb),
# so the release URL is derived from it and nothing else fetches KOReader.
# Bumping is a one-line edit per arch of koreader.sha256 (hash and file name
# from the release page).
FROM debian:trixie-slim

COPY koreader.sha256 /tmp/koreader.sha256

# The .deb's own Depends: is the runtime KOReader declares, so apt pulls
# exactly that and none of it is hand-listed here. sha256sum -c gates the
# download before anything from it is installed, and only the line for this
# build's own architecture is read, so a missing pin fails closed.
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
    apt-get install -y --no-install-recommends "/tmp/$deb" xvfb xauth; \
    rm -rf /var/lib/apt/lists/* /tmp/koreader.sha256 /tmp/koreader.pin "/tmp/$deb"

# KO_HOME is KOReader's data dir, its patches dir, and — as the CMD's
# argument — the directory it opens. World-writable: the container runs as
# the invoking uid (--user $(id -u):$(id -g)).
ENV KO_HOME=/ko-home
RUN mkdir -p /ko-home && chmod 777 /ko-home

CMD ["xvfb-run", "-a", "koreader", "/ko-home"]
