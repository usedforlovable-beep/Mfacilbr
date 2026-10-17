export type AppConfig = {
  databaseUrl: string;
  sessionSecret: string;
  port: number;
  nodeEnv: string;
  allowedOrigins: string[];
  openAiApiKey?: string;
  openAiModel: string;
  firecrawlApiKey?: string;
  cronSecret?: string;
};

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env["DATABASE_URL"]?.trim();
  if (!value)
    throw new Error("DATABASE_URL is required to connect to the self-managed PostgreSQL database.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }
  if (env["NODE_ENV"] === "production") {
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isLoopback =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname === "0.0.0.0" ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname);
    if (isLoopback) {
      throw new Error("DATABASE_URL must point to a reachable production PostgreSQL host.");
    }
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const sessionSecret = env["SESSION_SECRET"]?.trim();
  if (
    !sessionSecret ||
    sessionSecret.length < 32 ||
    /replace_with|change_this|example/i.test(sessionSecret)
  ) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }

  const port = Number(env["PORT"] ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port.");
  }

  const origins = env["CORS_ORIGIN"]
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (env["NODE_ENV"] === "production" && !origins?.length) {
    throw new Error("CORS_ORIGIN must be configured explicitly in production.");
  }
  return {
    databaseUrl: requireDatabaseUrl(env),
    sessionSecret,
    port,
    nodeEnv: env["NODE_ENV"] ?? "development",
    allowedOrigins: origins?.length
      ? origins
      : [
          "http://localhost:8080",
          "http://127.0.0.1:8080",
          "http://10.0.2.2:8080",
          "https://localhost",
          "http://localhost",
          "capacitor://localhost",
        ],
    ...(env["OPENAI_API_KEY"]?.trim() && { openAiApiKey: env["OPENAI_API_KEY"].trim() }),
    openAiModel: env["OPENAI_MODEL"]?.trim() || "gpt-4.1-mini",
    ...(env["FIRECRAWL_API_KEY"]?.trim() && { firecrawlApiKey: env["FIRECRAWL_API_KEY"].trim() }),
    ...(env["CRON_SECRET"]?.trim() && { cronSecret: env["CRON_SECRET"].trim() }),
  };
}
