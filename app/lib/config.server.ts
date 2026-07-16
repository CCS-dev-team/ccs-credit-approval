import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("debug"),
  FALLBACK_APPROVER_EMAIL: z
    .string()
    .email()
    .default("sales@centralcleaning.com.au"),
  FLOW_SHARED_SECRET: z.string().min(1),
  BUDGET_PRECEDENCE: z
    .enum(["user_first", "company_first"])
    .default("user_first"),
  ALLOW_CONFIG_REJECT: z
    .preprocess((value) => {
      if (value === undefined || value === null || value === "") return "true";
      return String(value);
    }, z.enum(["true", "false"]))
    .transform((value) => value === "true"),
  SENDGRID_API_KEY: z.string().min(1),
  SENDGRID_FROM_EMAIL: z.string().email(),
  SENDGRID_FROM_NAME: z.string().min(1),
  SENDGRID_REPLY_TO_EMAIL: z.string().email(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment configuration",
    parsed.error.flatten().fieldErrors,
  );
}

export const config = parsed.success
  ? parsed.data
  : {
      NODE_ENV: "development" as const,
      APP_ENV: "development" as const,
      LOG_LEVEL: "debug" as const,
      FALLBACK_APPROVER_EMAIL: "sales@centralcleaning.com.au",
      FLOW_SHARED_SECRET: "dev_fallback_secret",
      BUDGET_PRECEDENCE: "user_first" as const,
      ALLOW_CONFIG_REJECT: true,
      SENDGRID_API_KEY: "dev_sendgrid_key",
      SENDGRID_FROM_EMAIL: "approvals@example.com",
      SENDGRID_FROM_NAME: "Central Cleaning Supplies",
      SENDGRID_REPLY_TO_EMAIL: "sales@centralcleaning.com.au",
    };

export type AppConfig = typeof config;
