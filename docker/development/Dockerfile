FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
# Bake the root toolchain into the image: a FRESH verify_modules volume
# then self-populates from here on first mount (Docker copies image
# content into empty named volumes), so the check harness works on any
# runner without a manual priming install.
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --no-audit --no-fund && rm -rf /root/.npm
