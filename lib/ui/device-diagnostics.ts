// Read-only device diagnostics: the TARGET is derived server-side from
// the device's ConnectionRequestURL — never from a request argument —
// and only after the caller is authorized for that specific device.
// Probes are fixed checks (TCP connect to the CR port). Without a
// controller, the result is "unavailable", never a free host scan.

const CR_URL_PATH =
  "InternetGatewayDevice.ManagementServer.ConnectionRequestURL";

export interface DiagnosticTarget {
  host: string;
  port: number;
}

export class DiagnosticValidationError extends Error {
  code = "VALIDATION";

  constructor(message: string) {
    super(`VALIDATION ${message}`);
    this.name = "Error";
  }
}

export function diagnosticTarget(
  device: Record<string, unknown>,
): DiagnosticTarget {
  const entry = device[CR_URL_PATH] as
    { value?: [unknown, string] } | undefined;
  const raw = entry?.value?.[0];
  if (typeof raw !== "string" || !raw)
    throw new DiagnosticValidationError("device has no connection request URL");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DiagnosticValidationError("connection request URL is malformed");
  }

  const host = url.hostname.replace(/^\[|\]$/g, ""); // IPv6 literal
  if (!host)
    throw new DiagnosticValidationError("connection request URL has no host");

  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new DiagnosticValidationError(
      "connection request URL has no valid port",
    );

  return { host, port };
}

export interface DiagnosticCheck {
  name: string;
  source: "device";
  target: string | null;
  status: "ok" | "unreachable" | "timeout" | "unavailable";
  observedAt: string;
  durationMs: number | null;
  evidence: string | null;
}

// Probe: TCP connect with a 3s budget. ICMP needs the controller (M07);
// without it we report unavailable rather than scanning anything.
export async function runDeviceDiagnostics(
  device: Record<string, unknown>,
  controllerAvailable = false,
): Promise<{ checks: DiagnosticCheck[] }> {
  let target: DiagnosticTarget;
  try {
    target = diagnosticTarget(device);
  } catch (err) {
    return {
      checks: [
        {
          name: "tcp-connect",
          source: "device",
          target: null,
          status: "unavailable",
          observedAt: new Date().toISOString(),
          durationMs: null,
          evidence: err instanceof Error ? err.message : "no diagnostic target",
        },
      ],
    };
  }

  if (!controllerAvailable) {
    return {
      checks: [
        {
          name: "tcp-connect",
          source: "device",
          target: `${target.host}:${target.port}`,
          status: "unavailable",
          observedAt: new Date().toISOString(),
          durationMs: null,
          evidence:
            "probe controller not deployed (ICMP/TCP probes arrive with the controller)",
        },
      ],
    };
  }

  const started = Date.now();
  const net = await import("node:net");
  const status = await new Promise<"ok" | "unreachable" | "timeout">(
    (resolve) => {
      const socket = new net.Socket();
      const finish = (result: "ok" | "unreachable" | "timeout"): void => {
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(3000);
      socket.once("connect", () => finish("ok"));
      socket.once("timeout", () => finish("timeout"));
      socket.once("error", () => finish("unreachable"));
      socket.connect(target.port, target.host);
    },
  );

  return {
    checks: [
      {
        name: "tcp-connect",
        source: "device",
        target: `${target.host}:${target.port}`,
        status,
        observedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        evidence: null,
      },
    ],
  };
}
