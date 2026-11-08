# L2TP VPN runtime (stage 1 of the VPN work; persistent profile
# management arrives with M07-A). Debian packages are pinned to the
# versions recorded in docker/runtime-images.json from scanned bookworm
# repository metadata.
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
WORKDIR /repo
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --no-audit --no-fund
COPY services/vpn-controller services/vpn-controller
COPY packages/app-contracts packages/app-contracts
COPY lib/app-logger.ts lib/app-logger.ts
RUN npx esbuild services/vpn-controller/src/main.ts --bundle --platform=node --target=node24 --outfile=/controller.cjs

FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        xl2tpd=1.3.18-1 \
        ppp=2.4.9-1+1.1+b1 \
        iproute2=6.1.0-3 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/vpn/entrypoint.sh /entrypoint.sh
COPY docker/vpn/ip-up /usr/local/bin/vpn-ip-up
COPY docker/vpn/ip-down /usr/local/bin/vpn-ip-down
COPY --from=build /controller.cjs /app/controller.cjs
RUN chmod 0755 /entrypoint.sh /usr/local/bin/vpn-ip-up /usr/local/bin/vpn-ip-down \
    && mkdir -p /vpn-private /var/run/xl2tpd /var/log/xl2tpd \
    && chmod 0700 /vpn-private
RUN mkdir -p /logs/vpn && chown -R 10001:10001 /logs

# NET_ADMIN and /dev/ppp are granted by compose; the entrypoint never
# requires more.
ENTRYPOINT ["/entrypoint.sh"]
