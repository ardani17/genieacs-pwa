# GenieACS engine image, built from this fork's source on the pinned Node
# image. One artifact, four commands (cwmp/fs/ui/nbi) selected by the
# compose service command.
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
# The build pipeline enumerates static assets with git ls-files.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --no-audit --no-fund
COPY bin bin
COPY lib lib
COPY build build
COPY ui ui
COPY public public
COPY test test
COPY tsconfig.json LICENSE README.md CHANGELOG.md ./
RUN npm run build

FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime
ENV NODE_ENV=production
WORKDIR /opt/genieacs
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && rm -rf /root/.npm
COPY --from=build /repo/dist ./dist
COPY --from=build /repo/public ./public
COPY docker/health.mjs docker/health.mjs
RUN groupadd -g 10001 genieacs \
    && useradd -u 10001 -g 10001 -d /opt/genieacs genieacs \
    && chown -R 10001:10001 /opt/genieacs
USER 10001:10001
# Labels are filled by build args in compose (app/upstream/commit).
ARG APP_VERSION=dev
ARG SOURCE_COMMIT=unknown
LABEL org.opencontainers.image.title="genieacs-pwa-engine" \
    org.opencontainers.image.version="${APP_VERSION}" \
    org.opencontainers.image.source="https://github.com/ardani17/genieacs-pwa" \
    org.opencontainers.image.revision="${SOURCE_COMMIT}"
CMD ["node", "dist/bin/genieacs-ui"]
