FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

# The test target runs without network and read-only, so its toolchain is
# baked in at build time from the pinned manifest/shrinkwrap (auditable,
# reproducible) instead of being installed at test time.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tools
COPY package.json npm-shrinkwrap.json /tools/
RUN npm ci --no-audit --no-fund \
    && rm -rf /root/.npm /tools/.npm
