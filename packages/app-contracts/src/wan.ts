// WAN operation DTO (M05-C). Type-only dependency on the device-profiles
// WanSettings keeps ONE definition across browser/engine — it is erased
// at compile time, so this module stays browser-safe.
import type { WanSettings } from "../../device-profiles/src/wan-types.ts";
import type { CommandOutcome } from "./commands.ts";
import { validOperationId } from "./commands.ts";

export interface WanOperationRequest {
  operationId: string;
  deviceId: string;
  // Full WAN collection path, e.g.
  // InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection
  collection: string;
  // Existing instance path, or null to AddObject a new one.
  instance: string | null;
  settings: WanSettings;
}

export interface WanOperationOutcome extends CommandOutcome {
  // Observed instance after AddObject when the created object could not
  // be fully confirmed (empty/disabled) — shown for manual recovery,
  // never auto-recreated.
  observedInstance?: string;
  // Non-fatal notes, e.g. superseded faults retained for lack of
  // permission. Never contains settings values or passwords.
  warnings: string[];
}

export function validateWanOperationRequest(
  body: unknown,
  deviceId: string,
): { ok: true; value: WanOperationRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object")
    return { ok: false, error: "body wajib objek" };
  const b = body as Record<string, unknown>;
  if (!validOperationId(b["operationId"]))
    return { ok: false, error: "operationId (UUID) wajib diisi" };
  if (typeof b["collection"] !== "string" || !b["collection"])
    return { ok: false, error: "collection wajib diisi" };
  if (b["instance"] != null && typeof b["instance"] !== "string")
    return { ok: false, error: "instance harus string atau null" };
  if (!b["settings"] || typeof b["settings"] !== "object")
    return { ok: false, error: "settings wajib objek" };
  if (b["deviceId"] != null && b["deviceId"] !== deviceId)
    return { ok: false, error: "deviceId body tidak cocok dengan target URL" };
  return {
    ok: true,
    value: {
      operationId: b["operationId"] as string,
      deviceId,
      collection: b["collection"] as string,
      instance: (b["instance"] as string | null) ?? null,
      settings: b["settings"] as unknown as WanSettings,
    },
  };
}
