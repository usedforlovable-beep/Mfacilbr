import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { AppConfig } from "./config";
import type { BackendServices, DataStore, ScanInput } from "./store";
import type {
  CartItem,
  CartItemInput,
  ProductInfo,
  PublicPrice,
  StoredScan,
} from "../shared/api-types";

class MemoryStore implements DataStore {
  private readonly carts = new Map<string, CartItem[]>();
  private readonly legacyImports = new Set<string>();
  readonly scans: StoredScan[] = [];

  async ping() {}

  async getCart(sessionId: string) {
    return {
      items: this.carts.get(sessionId) ?? [],
      legacyImported: this.legacyImports.has(sessionId),
    };
  }

  async replaceCart(sessionId: string, items: CartItemInput[]) {
    const saved = items.map((item) => ({ ...item, id: crypto.randomUUID() }));
    this.carts.set(sessionId, saved);
    return saved;
  }

  async importLegacyCart(sessionId: string, items: CartItemInput[]) {
    if (!this.legacyImports.has(sessionId)) {
      if (!this.carts.get(sessionId)?.length) await this.replaceCart(sessionId, items);
      this.legacyImports.add(sessionId);
    }
    return this.getCart(sessionId);
  }

  async createScan(sessionId: string, scan: ScanInput): Promise<StoredScan> {
    const saved: StoredScan = {
      id: crypto.randomUUID(),
      kind: scan.kind,
      product_name: scan.result.product_name,
      brand: scan.kind === "ticket" ? null : scan.result.brand,
      variant: scan.kind === "ticket" ? null : scan.result.variant,
      size: scan.result.size,
      unit: scan.kind === "ticket" ? scan.result.unit : null,
      barcode: scan.kind === "ticket" ? scan.result.code : scan.result.barcode,
      price: scan.kind === "ticket" ? scan.result.price : null,
      promo_price: scan.kind === "ticket" ? scan.result.promo_price : null,
      member_price: scan.kind === "ticket" ? scan.result.member_price : null,
      raw_text: scan.kind === "ticket" ? scan.result.raw_text : scan.result.visible_text,
      price_uncertain: scan.kind === "ticket" ? scan.result.price_uncertain : false,
      recognized: scan.kind === "ticket" ? scan.result.readable : scan.result.recognized,
      details: { ...scan.result, sessionId },
      created_at: new Date().toISOString(),
    };
    this.scans.push(saved);
    return saved;
  }

  async listScans(sessionId: string, limit: number) {
    return this.scans.filter((scan) => scan.details["sessionId"] === sessionId).slice(0, limit);
  }

  async getProduct(_code: string): Promise<ProductInfo | null> {
    return null;
  }
  async saveProduct(_product: ProductInfo) {}
  async listPrices(_productCode: string): Promise<PublicPrice[]> {
    return [];
  }
  async startSyncRun(_source: string) {
    return crypto.randomUUID();
  }
  async upsertStore(_store: Parameters<DataStore["upsertStore"]>[0]) {
    return crypto.randomUUID();
  }
  async upsertPrice(_price: Parameters<DataStore["upsertPrice"]>[0]) {}
  async finishSyncRun(
    _id: string,
    _status: "success" | "error",
    _records: number,
    _message?: string,
  ) {}
}

const config: AppConfig = {
  databaseUrl: "postgres://unused:test@localhost:5432/unused",
  sessionSecret: "test-only-secret-with-at-least-thirty-two-characters",
  port: 0,
  nodeEnv: "test",
  allowedOrigins: ["http://localhost:8080"],
  openAiModel: "gpt-4.1-mini",
};

const ticket = {
  readable: true,
  product_name: "Arroz",
  size: "5",
  unit: "kg" as const,
  price: 24.9,
  promo_price: null,
  member_price: null,
  code: "7891234567890",
  raw_text: "Arroz 5kg R$ 24,90",
  price_uncertain: false,
};

describe("Self-hosted REST API", () => {
  let server: Server;
  let baseUrl: string;
  let store: MemoryStore;
  let nextTicket: typeof ticket;

  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    store = new MemoryStore();
    nextTicket = ticket;
    const services: BackendServices = {
      readTicket: vi.fn(async () => nextTicket),
      recognizeProduct: vi.fn(async () => ({
        recognized: false,
        brand: null,
        product_name: null,
        variant: null,
        size: null,
        barcode: null,
        visible_text: null,
        search_query: null,
        confidence: "low" as const,
      })),
      lookupProduct: vi.fn(async () => null),
      searchCamilo: vi.fn(async () => []),
      syncOpenPrices: vi.fn(async () => ({ records: 0 })),
    };
    server = createServer(createApp({ config, store, services }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    vi.restoreAllMocks();
  });

  it("reports database-backed health", async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", database: "connected" });
  });

  it("isolates and persists shopping carts by signed session cookie", async () => {
    const first = await fetch(`${baseUrl}/api/cart`);
    const cookie = first.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toMatch(/^mf_session=/);

    const saved = await fetch(`${baseUrl}/api/cart`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie ?? "" },
      body: JSON.stringify({ items: [{ name: "Leite", size: "1 l", price: 5.5, qty: 2 }] }),
    });
    expect(saved.status).toBe(200);

    const restored = await fetch(`${baseUrl}/api/cart`, { headers: { Cookie: cookie ?? "" } });
    const restoredBody = (await restored.json()) as { items: CartItem[]; legacyImported: boolean };
    expect(restoredBody.items).toHaveLength(1);
    expect(restoredBody.items[0]).toMatchObject({ name: "Leite", size: "1 l", price: 5.5, qty: 2 });

    const otherSession = await fetch(`${baseUrl}/api/cart`);
    await expect(otherSession.json()).resolves.toMatchObject({ items: [], legacyImported: false });
  });

  it("rejects invalid cart data without saving it", async () => {
    const response = await fetch(`${baseUrl}/api/cart`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ name: "", price: -1, qty: 0 }] }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error" },
    });
  });

  it("imports the old cart once without replacing later database changes", async () => {
    const first = await fetch(`${baseUrl}/api/cart`);
    const cookie = first.headers.get("set-cookie")?.split(";")[0] ?? "";
    const importResponse = await fetch(`${baseUrl}/api/cart/import-legacy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ items: [{ name: "Arroz", price: 12.5, qty: 1 }] }),
    });
    expect(importResponse.status).toBe(200);

    await fetch(`${baseUrl}/api/cart`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ items: [{ name: "Feijão", price: 9.9, qty: 1 }] }),
    });
    await fetch(`${baseUrl}/api/cart/import-legacy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ items: [{ name: "Item antigo", price: 1, qty: 1 }] }),
    });

    const restored = await fetch(`${baseUrl}/api/cart`, { headers: { Cookie: cookie } });
    await expect(restored.json()).resolves.toMatchObject({
      items: [{ name: "Feijão" }],
      legacyImported: true,
    });
  });

  it("stores the ticket scan result in the caller session", async () => {
    const response = await fetch(`${baseUrl}/api/tickets/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "data:image/jpeg;base64,AA==" }),
    });
    const body = (await response.json()) as { scanId: string; ticket: typeof ticket };

    expect(response.status).toBe(201);
    expect(body.ticket).toEqual(ticket);
    expect(store.scans).toHaveLength(1);
    expect(store.scans[0]).toMatchObject({
      id: body.scanId,
      kind: "ticket",
      product_name: "Arroz",
    });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");

    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    const ownedScans = await fetch(`${baseUrl}/api/scans`, { headers: { Cookie: cookie } });
    await expect(ownedScans.json()).resolves.toMatchObject({
      scans: [{ id: body.scanId, kind: "ticket" }],
    });
    const otherSessionScans = await fetch(`${baseUrl}/api/scans`);
    await expect(otherSessionScans.json()).resolves.toMatchObject({ scans: [] });
  });

  it("does not persist unreadable camera frames", async () => {
    nextTicket = { ...ticket, readable: false };
    const response = await fetch(`${baseUrl}/api/tickets/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "data:image/jpeg;base64,AA==" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ticket: { readable: false },
    });
    expect(store.scans).toHaveLength(0);
  });

  it("rejects cross-origin browser requests outside the configured allowlist", async () => {
    const response = await fetch(`${baseUrl}/api/cart`, {
      headers: { Origin: "https://untrusted.example" },
    });

    expect(response.status).toBe(403);
  });
});
