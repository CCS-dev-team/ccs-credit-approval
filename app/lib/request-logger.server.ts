import { randomUUID } from "crypto";
import { logger } from "./logger.server";

export function createRequestLogger(request: Request) {
  const requestId = request.headers.get("x-request-id") || randomUUID();

  return logger.child({
    requestId,
    method: request.method,
    url: request.url,
  });
}