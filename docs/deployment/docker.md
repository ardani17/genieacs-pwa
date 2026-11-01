# Docker deployment

The deployment stack splits the dashboard from the CPE tunnel:

- `app` bridge — Mongo, engine UI/NBI, and the Next.js web app. Nothing here
  gets host ports except the web app (loopback by default).
- `vpn` namespace — `cwmp` and `fs` share the VPN container's network namespace,
  so CPE sessions originate from the L2TP tunnel. Ports 7547/7567 are published
  on the `vpn` service only.
- The web app never depends on VPN health: with the tunnel stopped the dashboard
  stays up and `/api/app/health` reports `backendReachable` (and later VPN
  state) as data.

## Preflight (run on the docker host)

```sh
node scripts/preflight.mjs
```

Checks: Linux + rootful daemon, `/dev/ppp` + PPP kernel support, bridge subnet
overlap, the MongoDB-warned kernel range (6.19–7.0.13), and WSL2 caveats.
`supported:false` means `host_unsupported` — fix the listed items on the host
(the script never loads modules or rewrites routes itself). PPP on real hardware
is validated in the lab gate, not by the simulator.

## Configure

```sh
cp .env.example .env   # fill placeholders; .env is git-ignored
```

`PUBLIC_ORIGIN` is the scheme://host the browser uses. When HTTPS is enabled it
must match the certificate.

## Start

```sh
docker compose build
docker compose up -d mongo
docker compose up -d
docker compose ps
curl -s http://127.0.0.1:3000/api/app/health
```

The engine image is built from this fork's source (multi-stage, Node
digest-pinned, runtime deps only, uid 10001) with `app/upstream/commit` labels
from `APP_VERSION`/`SOURCE_COMMIT`.

### VPN (stage 1)

Without `VPN_PROFILE` the vpn container idles in `not-configured` and its
healthcheck reports that reason — it never claims the ONT network is reachable.
Mount a bootstrap profile read-only and set `VPN_PROFILE` to its name;
persistent profile management arrives with M07-A. The vpn image pins
`xl2tpd`/`ppp`/`iproute2` versions recorded in `docker/runtime-images.json`.

## HTTPS overlay

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d
```

Caddy (digest-pinned) terminates TLS with operator-provided certificates mounted
read-only; automatic issuance is disabled and client forwarding headers are not
trusted (Caddy is the edge; if you put another trusted proxy in front, adjust
the boundary explicitly). The overlay sets `TRUSTED_PROXY_HOPS=1` on the web
service so the login rate limiter keys on the client address Caddy appends to
`X-Forwarded-For`; without a trusted proxy in front the default `0` discards
the header entirely (rotating it cannot open new rate-limit buckets). The task
proxy timeout is 310s to stay above the engine's 300s task horizon. This
package never issues real domains/certificates.

## Image digest policy

Every image is referenced `tag@digest` (see `docker/runtime-images.json` for
verified digests). Re-verify with `docker buildx imagetools inspect` before any
tag bump; tag changes go through a plan revision.

## Test topology (separate)

`compose.test.yaml` (project `genieacs-pwa-check`) is NOT this stack: it binds
web on loopback 5300, uses the throwaway `genieacs_plan_test` database, and
simulates VPN state without NET_ADMIN. Hardware PPP checks are a separate lab
gate.
