import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  loadEngineSettingsSecrets,
  getDecryptedProfile,
  getAcsAddress,
  type AppSettingsDeps,
  type UpdateSettingsResult,
} from "./app-settings.ts";
import type { VpnStatus } from "../../packages/app-contracts/src/vpn.ts";
import { internalServiceUrl } from "../common/internal-url.ts";

export class ControllerError extends Error {
  constructor(
    readonly status = 503,
    readonly code = "VPN_UNAVAILABLE",
  ) {
    super(code);
  }
}
export async function controllerRequest<T>(
  path:
    | "/status"
    | "/profile"
    | "/reconnect"
    | "/diagnose"
    | "/probe"
    | "/health",
  requestId: string = randomUUID(),
  body?: unknown,
  timeoutMs = 7000,
): Promise<T> {
  const base = process.env.VPN_CONTROLLER_URL;
  const token = loadEngineSettingsSecrets().controllerToken;
  if (!base || !token) throw new ControllerError();
  try {
    const response = await fetch(internalServiceUrl(base, path), {
      method:
        path === "/status" || path === "/health"
          ? "GET"
          : path === "/profile"
            ? "PUT"
            : "POST",
      headers: {
        Authorization: `Bearer ${token.toString("utf8")}`,
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
      ...(path === "/status" || path === "/health"
        ? {}
        : { body: JSON.stringify(body ?? {}) }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok)
      throw new ControllerError(
        response.status === 409 ? 409 : 503,
        response.status === 409 ? "CONFLICT" : "VPN_UNAVAILABLE",
      );
    const envelope = (await response.json()) as { ok: boolean; data: T };
    if (!envelope.ok) throw new ControllerError();
    return envelope.data;
  } catch (err) {
    if (err instanceof ControllerError) throw err;
    throw new ControllerError();
  }
}
export async function applySavedSettings(
  deps: AppSettingsDeps,
  result: UpdateSettingsResult,
  requestId: string,
): Promise<{
  applyState: UpdateSettingsResult["applyState"];
  applyError: string | null;
}> {
  try {
    const profile = await getDecryptedProfile(deps);
    if (profile.revision !== result.desiredRevision)
      return { applyState: "pending", applyError: null };
    const status = await controllerRequest<VpnStatus>(
      "/profile",
      requestId,
      profile,
    );
    const failed = [
      "auth_failed",
      "route_error",
      "host_unsupported",
      "retry_wait",
      "stopped",
    ].includes(status.state);
    return {
      applyState: failed
        ? "failed"
        : status.appliedRevision === result.desiredRevision &&
            status.state === "connected"
          ? "applied"
          : "applying",
      applyError: status.lastErrorCode,
    };
  } catch {
    return { applyState: "failed", applyError: "VPN_CONTROLLER_UNAVAILABLE" };
  }
}
export async function diagnoseVpn(
  deps: AppSettingsDeps,
  requestId: string,
): Promise<object> {
  const [controller, address] = await Promise.all([
    controllerRequest<object>("/diagnose", requestId),
    getAcsAddress(deps),
  ]);
  if (address.status !== "configured")
    return { ...controller, acs: { status: "unconfigured" } };
  const status = await controllerRequest<VpnStatus>("/status", requestId);
  const acs = address.acs;
  const host = acs.mode === "auto-ppp" ? status.localIp : acs.host;
  if (!host)
    return {
      ...controller,
      acs: { status: "VPN_UNAVAILABLE", observedAt: new Date().toISOString() },
    };
  const url = new URL(`${acs.scheme}://localhost`);
  url.hostname = host.includes(":") ? `[${host}]` : host;
  url.port = String(acs.port);
  url.pathname = acs.path;
  let resolvedIp: string | null = null;
  try {
    resolvedIp = (
      await Promise.race([
        lookup(host),
        new Promise<never>((_, reject) => {
          const t = setTimeout(() => reject(new Error("DNS_TIMEOUT")), 2000);
          t.unref();
        }),
      ])
    ).address;
  } catch {
    /* report evidence, not a guessed address */
  }
  return {
    ...controller,
    acs: {
      url: url.toString(),
      resolvedIp,
      pppIp: status.localIp,
      status: resolvedIp ? "ok" : "unresolved",
      observedAt: new Date().toISOString(),
    },
  };
}
