import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { Route as HomeRoute } from "@/routes/index";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("App routing", () => {
  // Match routes without running loaders, which may need a server or network.
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("loads the saved cart on startup without saving it again or starting a scan", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ items: [], legacyImported: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const HomePage = HomeRoute.options.component;
    if (!HomePage) throw new Error("Home Page component is unavailable.");

    render(createElement(HomePage));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/cart");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it("opens saved scans and requests price history only when asked", async () => {
    const scans = [
      {
        id: "scan-1",
        kind: "ticket",
        product_name: "Arroz",
        brand: null,
        variant: null,
        size: "5 kg",
        unit: "kg",
        barcode: "7891234567890",
        price: 24.9,
        promo_price: null,
        member_price: null,
        raw_text: "Arroz 5 kg 24,90",
        price_uncertain: false,
        recognized: true,
        details: {},
        created_at: "2026-10-16T12:00:00.000Z",
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/cart") {
        return new Response(JSON.stringify({ items: [], legacyImported: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/scans?limit=100") {
        return new Response(JSON.stringify({ scans }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/prices?code=7891234567890") {
        return new Response(JSON.stringify({ prices: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const HomePage = HomeRoute.options.component;
    if (!HomePage) throw new Error("Home Page component is unavailable.");

    render(createElement(HomePage));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Histórico" }));

    expect(await screen.findByText("Arroz")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/scans?limit=100",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Consultar preços públicos" }));
    await screen.findByText("Não há registros públicos de preço para este código.");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/prices?code=7891234567890",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/tickets/scan"))).toBe(false);
  });

  it("checks API status only in settings and persists the selected theme", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/cart") {
        return new Response(JSON.stringify({ items: [], legacyImported: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(input) === "/api/health") {
        return new Response(JSON.stringify({ status: "ok", database: "connected" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected API request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const HomePage = HomeRoute.options.component;
    if (!HomePage) throw new Error("Home Page component is unavailable.");

    render(createElement(HomePage));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));

    expect(await screen.findByText("API e banco de dados conectados.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ativar tema escuro" }));

    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("mf-theme")).toBe("dark");
  });
});
