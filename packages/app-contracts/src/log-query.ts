// Re-export the closed-schema log query builder for the web app.
export {
  buildLogQuery,
  LogQueryError,
  LOG_WINDOW_DEFAULT_MS,
  LOG_WINDOW_MAX_MS,
  LOG_LIMIT_DEFAULT,
  LOG_LIMIT_MAX,
  LOG_OFFSET_MAX,
} from "../../../lib/ui/log-query.ts";
export type { LogFilters } from "../../../lib/ui/log-query.ts";
