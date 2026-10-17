import { afterEach, describe, expect, it, vi } from "vitest";

import { apiRequest, ApiError } from "./api-client";

describe("apiRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("identifies a non-JSON gateway failure as a temporary API outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("", { status: 502, headers: { "Content-Type": "text/plain" } }),
      ),
    );

    const request = apiRequest("/cart");
    await expect(request).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      code: "service_unavailable",
      message: "A API está temporariamente indisponível (HTTP 502). Tente novamente em instantes.",
    });
  });

  it("reports network errors without hiding them as invalid responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
    );

    await expect(apiRequest("/cart")).rejects.toMatchObject({
      name: "ApiError",
      status: 0,
      code: "network_error",
    });
  });

  it("keeps structured JSON API errors intact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: "database_unavailable", message: "Banco indisponível." },
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const request = apiRequest("/cart");
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      status: 503,
      code: "database_unavailable",
      message: "Banco indisponível.",
    });
  });
});
