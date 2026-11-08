// VPN-controller service logger stub (service skeleton arrives with
// M07-B): same shared bounded/redacting logger, vpn service identity,
// and the same fatal-handler contract as the web process.
import { createAppLogger, type AppLogger } from "../../../lib/app-logger.ts";

let vpnLogger: AppLogger | null = null;

export function getVpnLogger(installationId?: string): AppLogger {
  if (!vpnLogger) {
    vpnLogger = createAppLogger({
      service: "vpn-controller",
      appVersion: process.env.APP_VERSION ?? "dev",
      installationId:
        installationId ??
        process.env.INSTALLATION_ID ??
        "00000000-0000-0000-0000-000000000000",
      environment:
        process.env.NODE_ENV === "production" ? "production" : "test",
      filePath: process.env.APP_LOG_FILE ?? "/tmp/app-vpn.log",
    });
  }
  return vpnLogger;
}

export async function handleFatal(err: unknown): Promise<never> {
  const logger = getVpnLogger();
  logger.emit({
    event: "vpn.fatal",
    level: "error",
    message: "unrecoverable error",
    error: {
      code: "INTERNAL",
      name: err instanceof Error ? err.name : "Error",
      stack: err instanceof Error ? err.stack : undefined,
    },
    outcome: "failure",
  });
  await logger.flush(2000);
  process.exit(1);
}
