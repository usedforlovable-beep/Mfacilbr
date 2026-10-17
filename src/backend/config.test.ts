import { describe, expect, it } from "vitest";

import { loadConfig, requireDatabaseUrl } from "./config";

describe("database configuration", () => {
  it("requires a PostgreSQL connection URL", () => {
    expect(() => requireDatabaseUrl({} as NodeJS.ProcessEnv)).toThrow("DATABASE_URL is required");
    expect(() =>
      requireDatabaseUrl({ DATABASE_URL: "https://db.example.com" } as NodeJS.ProcessEnv),
    ).toThrow("postgres or postgresql protocol");
    expect(() => requireDatabaseUrl({ DATABASE_URL: "not a url" } as NodeJS.ProcessEnv)).toThrow(
      "valid PostgreSQL connection URL",
    );
  });

  it("allows localhost PostgreSQL in development", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://app:secret@localhost:5432/market",
      SESSION_SECRET: "x".repeat(40),
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);

    expect(new URL(config.databaseUrl).hostname).toBe("localhost");
  });

  it("rejects localhost PostgreSQL in production", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://app:secret@localhost:5432/market",
        SESSION_SECRET: "x".repeat(40),
        NODE_ENV: "production",
        CORS_ORIGIN: "https://shop.example.com",
      } as NodeJS.ProcessEnv),
    ).toThrow("reachable production PostgreSQL host");
  });

  it("accepts a remote production PostgreSQL URL without embedding deployment credentials", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://render-managed-db.example.com/market",
      SESSION_SECRET: "x".repeat(40),
      NODE_ENV: "production",
      CORS_ORIGIN: "https://shop.example.com",
    } as NodeJS.ProcessEnv);

    expect(config.databaseUrl).toBe("postgres://render-managed-db.example.com/market");
  });
});
