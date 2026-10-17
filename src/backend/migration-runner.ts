import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type postgres from "postgres";

export async function runMigrations(
  client: ReturnType<typeof postgres>,
  directory = resolve(process.cwd(), "drizzle", "migrations"),
): Promise<string[]> {
  await client`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const files = (await readdir(directory))
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort();
  const applied: string[] = [];

  for (const file of files) {
    const existing = await client`SELECT name FROM schema_migrations WHERE name = ${file}`;
    if (existing.length > 0) continue;

    const migration = await readFile(resolve(directory, file), "utf8");
    await client.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    applied.push(file);
  }

  return applied;
}
