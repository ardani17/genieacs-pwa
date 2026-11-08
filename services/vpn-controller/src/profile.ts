import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateVpnProfileInput } from "../../../packages/app-contracts/src/settings.ts";
import type { DesiredVpnProfile } from "../../../packages/app-contracts/src/vpn.ts";

export function validateDesiredProfile(raw: unknown): DesiredVpnProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("INVALID_PROFILE");
  const r = raw as Record<string, unknown>;
  const keys = [
    "revision",
    "installationId",
    "server",
    "username",
    "password",
    "routes",
    "mtu",
  ];
  if (
    Object.keys(r).some((k) => !keys.includes(k)) ||
    typeof r.installationId !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(r.installationId) ||
    typeof r.revision !== "number" ||
    r.revision < 1
  )
    throw new Error("INVALID_PROFILE");
  const checked = validateVpnProfileInput({
    revision: r.revision,
    server: r.server,
    username: r.username,
    passwordAction: "replace",
    password: r.password,
    routes: r.routes,
    mtu: r.mtu,
    acs: {
      mode: "auto-ppp",
      scheme: "http",
      host: null,
      port: 7547,
      path: "/",
    },
  });
  if (checked.ok === false) throw new Error("INVALID_PROFILE");
  return {
    revision: checked.value.revision,
    installationId: r.installationId,
    server: checked.value.server,
    username: checked.value.username,
    password: checked.value.password!,
    routes: checked.value.routes,
    mtu: checked.value.mtu,
  };
}

export async function atomicPrivateFile(
  path: string,
  text: string,
): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, text, { mode: 0o600, flag: "wx" });
    await fs.rename(temp, path);
    await fs.chmod(path, 0o600);
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
}

const quoted = (text: string): string =>
  `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export async function writeProfile(
  dir: string,
  profile: DesiredVpnProfile,
  endpoint: string,
  generation: string,
): Promise<void> {
  validateDesiredProfile(profile);
  if (
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(endpoint) ||
    !/^[0-9a-f-]{36}$/.test(generation)
  )
    throw new Error("INVALID_RUNTIME_PROFILE");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  const options = [
    "noauth",
    "refuse-eap",
    "noipdefault",
    "nodefaultroute",
    "noccp",
    "hide-password",
    "logfd 2",
    `mtu ${profile.mtu}`,
    `mru ${profile.mtu}`,
    `name ${quoted(profile.username)}`,
    `password ${quoted(profile.password)}`,
    `ipparam ${generation}`,
    "ip-up-script /usr/local/bin/vpn-ip-up",
    "ip-down-script /usr/local/bin/vpn-ip-down",
    "lcp-echo-interval 10",
    "lcp-echo-failure 3",
    "",
  ];
  await atomicPrivateFile(join(dir, "ppp-options"), options.join("\n"));
  await atomicPrivateFile(
    join(dir, "xl2tpd.conf"),
    `[global]\naccess control = yes\n[lac vpn]\nlns = ${endpoint}\npppoptfile = ${join(dir, "ppp-options")}\npass peer = no\nautodial = yes\nredial = no\nlength bit = yes\n`,
  );
}
