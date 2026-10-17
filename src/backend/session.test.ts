import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import { createSessionMiddleware } from "./session";

const servers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
  servers.clear();
});

async function requestSessionCookie(production: boolean): Promise<string> {
  const app = express();
  app.use(
    createSessionMiddleware("test-secret-that-is-at-least-thirty-two-characters", production),
  );
  app.get("/", (_request, response) => response.sendStatus(204));

  const server = createServer(app);
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/`);
  return response.headers.get("set-cookie") ?? "";
}

describe("anonymous session cookie", () => {
  it("uses Secure and SameSite=None in production for the Android WebView", async () => {
    const cookie = await requestSessionCookie(true);

    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("HttpOnly");
  });

  it("keeps local development cookies compatible with HTTP localhost", async () => {
    const cookie = await requestSessionCookie(false);

    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });
});
