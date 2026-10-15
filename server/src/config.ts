import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/incidentroom"),
  // Optional: when set, live updates fan out through Redis so several server
  // instances can run behind a load balancer.
  REDIS_URL: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().default("dev-github-secret"),
  SENTRY_WEBHOOK_SECRET: z.string().default("dev-sentry-secret"),
  // Bearer token for the generic ingest endpoint (uptime checks, scripts, etc.)
  INGEST_TOKEN: z.string().default("dev-ingest-token"),
  // Optional: without it, postmortems fall back to a template-based draft.
  ANTHROPIC_API_KEY: z.string().optional(),
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

export const config: Config = EnvSchema.parse(process.env);
