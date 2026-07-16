import pino from "pino";
import { config } from "./config.server";

export const logger = pino({
  level: config.LOG_LEVEL,
  base: {
    app: "ccs-credit-approval",
    env: config.APP_ENV,
  },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "authorization",
    "token",
    "secret",
    "apiKey",
  ],
  transport:
    config.APP_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});