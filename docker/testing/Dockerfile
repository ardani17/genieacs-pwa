# Browser-test toolchain image: pinned Node, frontend toolchain and
# Chromium installed at BUILD time (isolated, auditable), never at test
# time. Used by the browser-tests service which shares the web network
# namespace.
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/apps/web
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci --no-audit --no-fund \
    && npx playwright install --with-deps chromium \
    && rm -rf /root/.npm
