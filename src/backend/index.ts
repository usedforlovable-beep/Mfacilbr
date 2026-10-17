import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../../drizzle/schema.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { waitForDatabase } from "./database-readiness.js";
import { runMigrations } from "./migration-runner.js";
import { PostgresStore } from "./postgres-store.js";
import { createBackendServices } from "./services/index.js";

async function main() {
  const config = loadConfig();
  const client = postgres(config.databaseUrl, {
    max: 10,
    connect_timeout: 3,
    idle_timeout: 20,
  });
  const db = drizzle(client, { schema });
  const store = new PostgresStore(db);

  console.info(
    JSON.stringify({
      event: "database_wait_started",
      host: new URL(config.databaseUrl).host,
    }),
  );
  try {
    await waitForDatabase(() => client`SELECT 1`, {
      onRetry(attempt, delayMs, error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "connection_error";
        console.warn(
          JSON.stringify({
            event: "database_not_ready",
            attempt,
            retryInMs: delayMs,
            code,
          }),
        );
      },
    });
  } catch (error) {
    await client.end({ timeout: 1 }).catch(() => {});
    throw new Error(
      `Could not connect to PostgreSQL at ${new URL(config.databaseUrl).host} after readiness retries. Check that PostgreSQL is running, DATABASE_URL is correct, and the database accepts connections.`,
      { cause: error },
    );
  }

  await runMigrations(client);
  await store.ping();
  console.info(JSON.stringify({ event: "database_migrations_complete" }));

  const app = createApp({
    config,
    store,
    services: createBackendServices(config, store),
  });
  const server = app.listen(config.port, () => {
    console.info(
      JSON.stringify({
        event: "api_started",
        port: config.port,
        environment: config.nodeEnv,
        database: "connected",
      }),
    );
  });

  const shutdown = (signal: string) => {
    console.info(JSON.stringify({ event: "api_shutdown", signal }));
    server.close(() => {
      void client
        .end()
        .then(() => {
          process.exitCode = 0;
        })
        .catch((error: unknown) => {
          console.error("Failed to close the database pool", error);
          process.exitCode = 1;
        });
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

void main().catch((error: unknown) => {
  console.error("API startup failed", error);
  process.exitCode = 1;
});
