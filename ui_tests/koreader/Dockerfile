# KOReader test lane image: the pinned KOReader release under Xvfb, driven by
# the user patch scripts/koreader-e2e.sh mounts at /ko-home/patches.
#
# The KOReader version lives in ONE place: the koreader.sha256 pin. Its file
# name carries the version (koreader_<ver>-1_amd64.deb), so the release URL is
# derived from it and nothing else fetches KOReader. Bumping is a one-line
# edit of koreader.sha256 (hash and file name from the release page).
FROM debian:trixie-slim

COPY koreader.sha256 /tmp/koreader.sha256

# The .deb's own Depends: is the runtime KOReader declares (the X11/Wayland/DRM
# libs SDL loads; SDL itself is bundled), so apt pulls exactly that and none of
# it is hand-listed here. sha256sum -c gates the download before anything from
# it is installed.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    deb="$(awk '{print $2}' /tmp/koreader.sha256)"; \
    ver="${deb#koreader_}"; \
    ver="${ver%%-*}"; \
    curl -fsSL --proto '=https' --tlsv1.2 \
        -o "/tmp/$deb" \
        "https://github.com/koreader/koreader/releases/download/v$ver/$deb"; \
    (cd /tmp && sha256sum -c koreader.sha256); \
    apt-get install -y --no-install-recommends "/tmp/$deb" xvfb xauth; \
    rm -rf /var/lib/apt/lists/* /tmp/koreader.sha256 "/tmp/$deb"

# KO_HOME is KOReader's data dir (settings) and where userpatch looks for
# patches. World-writable so the container runs as the invoking uid
# (--user $(id -u):$(id -g)); the lane mounts its patches read-only at
# /ko-home/patches.
ENV KO_HOME=/ko-home
RUN mkdir -p /ko-home && chmod 777 /ko-home

CMD ["xvfb-run", "-a", "koreader", "/ko-home"]
