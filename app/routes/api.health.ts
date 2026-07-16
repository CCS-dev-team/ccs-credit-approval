import { config } from "../lib/config.server";
import { logger } from "../lib/logger.server";

export async function loader() {
  logger.info({ event: "healthcheck" }, "Healthcheck called");

  return Response.json({
    ok: true,
    appEnv: config.APP_ENV,
    nodeEnv: config.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
}