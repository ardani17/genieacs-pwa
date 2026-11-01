# L2TP VPN runtime (stage 1 of the VPN work; persistent profile
# management arrives with M07-A). Debian packages are pinned to the
# versions recorded in docker/runtime-images.json from scanned bookworm
# repository metadata.
FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        xl2tpd=1.3.18-1 \
        ppp=2.4.9-1+1.1+b1 \
        iproute2=6.1.0-3 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/vpn/entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

# NET_ADMIN and /dev/ppp are granted by compose; the entrypoint never
# requires more.
ENTRYPOINT ["/entrypoint.sh"]
