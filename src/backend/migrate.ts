import postgres from "postgres";

import { requireDatabaseUrl } from "./config.js";
import { waitForDatabase } from "./database-readiness.js";
import { runMigrations } from "./migration-runner.js";

async function main() {
  const databaseUrl = requireDatabaseUrl();
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 3 });
  try {
    console.info(
      JSON.stringify({
        event: "database_wait_started",
        host: new URL(databaseUrl).host,
      }),
    );
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
    const migrations = await runMigrations(client);
    console.info(JSON.stringify({ event: "database_migrations_complete", migrations }));
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error("Database migration failed", error);
  process.exitCode = 1;
});
