# apps/web production image: multi-stage build on the pinned Node image,
# standalone runtime as untrusted uid 10001 with a read-only-friendly
# layout (cache/tmp are tmpfs in compose).
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
WORKDIR /repo
COPY package.json npm-shrinkwrap.json ./
COPY apps/web/package.json apps/web/package-lock.json apps/web/
COPY packages/app-contracts/package.json packages/app-contracts/
RUN npm ci --prefix apps/web --no-audit --no-fund
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
WORKDIR /app/apps/web
COPY --from=build --chown=10001:10001 /repo/apps/web/.next/standalone /app/
USER 10001:10001
EXPOSE 3000
CMD ["node", "server.js"]
