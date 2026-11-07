#!/bin/sh
# L2TP stage-1 entrypoint: starts xl2tpd with the bootstrap profile when
# the operator provides one; otherwise it idles in "not-configured" state
# and the healthcheck reports that reason — never claiming the ONT
# network is reachable. Persistent profile management is M07-A.

set -eu

VPN_PROFILE="${VPN_PROFILE:-}"

report_state() {
  # Reason strings only; no credentials, no secrets.
  if [ -n "${VPN_PROFILE}" ] && [ -e "/etc/xl2tpd/${VPN_PROFILE}.conf" ]; then
    if [ -d /sys/class/net ] && ls /sys/class/net | grep -q '^ppp'; then
      echo ppp-up
      return 0
    fi
    echo "ppp-down: profile loaded, no ppp interface"
    return 1
  fi
  echo "not-configured: no bootstrap profile"
  return 1
}

# Docker invokes the entrypoint without arguments by default: `$1`
# must be safe under `set -u` (an unbound $1 used to abort startup
# before the not-configured state could even be reported).
if [ "${1:-}" = "--health" ]; then
  report_state
  exit $?
fi

mkdir -p /var/run/xl2tpd /var/log/xl2tpd

if [ -n "${VPN_PROFILE}" ] && [ -e "/etc/xl2tpd/${VPN_PROFILE}.conf" ]; then
  echo "starting xl2tpd with bootstrap profile (state reported by healthcheck)"
  exec /usr/sbin/xl2tpd -D -c "/etc/xl2tpd/${VPN_PROFILE}.conf"
fi

echo "vpn: no bootstrap profile; staying in not-configured state"
exec tail -f /dev/null
