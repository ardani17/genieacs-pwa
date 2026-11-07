# apps/web production image: multi-stage build on the pinned Node image,
# standalone runtime as untrusted uid 10001 with a read-only-friendly
# layout (cache/tmp are tmpfs in compose).
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
WORKDIR /repo
COPY package.json npm-shrinkwrap.json ./
COPY apps/web/package.json apps/web/package-lock.json apps/web/
COPY packages/app-contracts/package.json packages/app-contracts/
RUN npm ci --prefix apps/web --no-audit --no-fund
# Engine modules under lib/ resolve their dependencies (parsimmon for
# the expression parser) by walking up to the repository root: expose
# the web app's node_modules there instead of installing a second copy.
RUN ln -s apps/web/node_modules node_modules
# The web app imports engine modules (lib/app-logger.ts and the
# log-query re-export) and engine types via relative paths — copy lib/.
COPY lib lib
COPY apps/web apps/web
COPY packages/app-contracts packages/app-contracts
RUN npm run build --prefix apps/web

FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && chown -R 10001:10001 /usr/local/share/doc 2>/dev/null || true
# The app log volume mounts at /logs: prepare /logs/web for uid 10001 in
# the image so a FRESH named volume inherits writable ownership (Docker
# copies the mount point's content and permissions on first use).
RUN mkdir -p /logs/web && chown -R 10001:10001 /logs
WORKDIR /app/apps/web
# Standalone server plus the browser assets Next's tracing does not
# embed: .next/static (and public/ when present).
COPY --from=build --chown=10001:10001 /repo/apps/web/.next/standalone /app/
COPY --from=build --chown=10001:10001 /repo/apps/web/.next/static /app/apps/web/.next/static
USER 10001:10001
EXPOSE 3000
CMD ["node", "server.js"]
