// Web-side application logger: the shared bounded/redacting logger with
// the web service identity, plus the fatal handler contract (flush <=2s,
// then exit 1) and a safe request-error responder that never leaks raw
// error objects.
import { createAppLogger, type AppLogger } from "../../../../lib/app-logger.ts";

let webLogger: AppLogger | null = null;

export function getAppLogger(): AppLogger {
  if (!webLogger) {
    webLogger = createAppLogger({
      service: "web",
      appVersion: process.env.APP_VERSION ?? "dev",
      installationId:
        process.env.INSTALLATION_ID ?? "00000000-0000-0000-0000-000000000000",
      environment:
        process.env.NODE_ENV === "production" ? "production" : "test",
      filePath: process.env.APP_LOG_FILE ?? "/tmp/app-web.log",
    });
  }
  return webLogger;
}

// Fatal errors: bounded flush then a nonzero exit so the supervisor
// restarts the process — logging must never hold shutdown hostage.
export async function handleFatal(err: unknown): Promise<never> {
  const logger = getAppLogger();
  logger.emit({
    event: "app.fatal",
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
