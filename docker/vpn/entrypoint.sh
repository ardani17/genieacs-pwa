#!/bin/sh
set -eu
if [ "${1:-}" = "--health" ]; then
  exec node /app/controller.cjs --health
fi
exec node /app/controller.cjs
