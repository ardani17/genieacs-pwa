// Persist only bounded public status fields, even if a lab peer sends extra data.
import { isIPv4 } from "node:net";

export function statusEvidence(raw) {
  const states = [
    "unconfigured",
    "connecting",
    "connected",
    "retry_wait",
    "auth_failed",
    "route_error",
    "host_unsupported",
    "stopped",
  ];
  const counter = (value) => Number.isSafeInteger(value) && value >= 0;
  const timestamp = (value) =>
    typeof value === "string" &&
    value.length <= 32 &&
    Number.isFinite(Date.parse(value));
  if (
    !raw ||
    !states.includes(raw.state) ||
    !counter(raw.desiredRevision) ||
    !(raw.appliedRevision === null || counter(raw.appliedRevision)) ||
    !counter(raw.attempt) ||
    !(
      raw.interfaceName === null ||
      (typeof raw.interfaceName === "string" &&
        /^ppp\d{1,5}$/.test(raw.interfaceName))
    ) ||
    !(
      raw.localIp === null ||
      (typeof raw.localIp === "string" && isIPv4(raw.localIp))
    ) ||
    !(
      raw.peerIp === null ||
      (typeof raw.peerIp === "string" && isIPv4(raw.peerIp))
    ) ||
    !(raw.nextAttemptAt === null || timestamp(raw.nextAttemptAt)) ||
    !(
      raw.lastErrorCode === null ||
      (typeof raw.lastErrorCode === "string" &&
        /^[A-Z][A-Z0-9_]{0,63}$/.test(raw.lastErrorCode))
    ) ||
    !timestamp(raw.observedAt) ||
    !Array.isArray(raw.routes) ||
    raw.routes.length > 32 ||
    raw.routes.some((route) => {
      if (
        !route ||
        typeof route.cidr !== "string" ||
        typeof route.installed !== "boolean"
      )
        return true;
      const [ip, prefix, extra] = route.cidr.split("/");
      return (
        extra !== undefined ||
        !isIPv4(ip) ||
        !/^(?:[1-9]|[12]\d|3[0-2])$/.test(prefix)
      );
    })
  )
    throw new Error("INVALID_STATUS_EVIDENCE");
  return {
    state: raw.state,
    desiredRevision: raw.desiredRevision,
    appliedRevision: raw.appliedRevision,
    interfaceName: raw.interfaceName,
    localIp: raw.localIp,
    peerIp: raw.peerIp,
    attempt: raw.attempt,
    nextAttemptAt: raw.nextAttemptAt,
    lastErrorCode: raw.lastErrorCode,
    observedAt: raw.observedAt,
    routes: raw.routes.map((route) => ({
      cidr: route.cidr,
      installed: route.installed,
    })),
  };
}
