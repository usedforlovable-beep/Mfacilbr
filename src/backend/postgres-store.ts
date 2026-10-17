import { asc, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../drizzle/schema.js";
import {
  anonymousSessions,
  prices,
  products,
  scans,
  shoppingCartItems,
  stores,
  syncRuns,
} from "../../drizzle/schema.js";
import type {
  CartItem,
  CartItemInput,
  ProductInfo,
  PublicPrice,
  StoredScan,
} from "../shared/api-types.js";
import type { DataStore, PriceInput, ScanInput, StoreInfo } from "./store.js";

type Db = PostgresJsDatabase<typeof schema>;

export class PostgresStore implements DataStore {
  constructor(private readonly db: Db) {}

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  async getCart(sessionId: string): Promise<{ items: CartItem[]; legacyImported: boolean }> {
    await this.ensureSession(sessionId);
    const rows = await this.db
      .select()
      .from(shoppingCartItems)
      .where(eq(shoppingCartItems.sessionId, sessionId))
      .orderBy(asc(shoppingCartItems.position));

    const [session] = await this.db
      .select({ legacyImportedAt: anonymousSessions.legacyCartImported })
      .from(anonymousSessions)
      .where(eq(anonymousSessions.id, sessionId))
      .limit(1);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        ...(row.size && { size: row.size }),
        price: Number(row.price),
        qty: row.quantity,
      })),
      legacyImported: Boolean(session?.legacyImportedAt),
    };
  }

  async replaceCart(sessionId: string, items: CartItemInput[]): Promise<CartItem[]> {
    await this.ensureSession(sessionId);
    await this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);
      await transaction.delete(shoppingCartItems).where(eq(shoppingCartItems.sessionId, sessionId));
      if (items.length > 0) {
        await transaction.insert(shoppingCartItems).values(
          items.map((item, position) => ({
            sessionId,
            position,
            name: item.name,
            size: item.size ?? null,
            price: item.price.toFixed(2),
            quantity: item.qty,
          })),
        );
      }
    });

    return (await this.getCart(sessionId)).items;
  }

  async importLegacyCart(
    sessionId: string,
    items: CartItemInput[],
  ): Promise<{ items: CartItem[]; legacyImported: boolean }> {
    await this.ensureSession(sessionId);
    await this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);
      const [session] = await transaction
        .select({ legacyImportedAt: anonymousSessions.legacyCartImported })
        .from(anonymousSessions)
        .where(eq(anonymousSessions.id, sessionId))
        .limit(1);
      if (session && session.legacyImportedAt !== null) return;

      const existingItems = await transaction
        .select({ id: shoppingCartItems.id })
        .from(shoppingCartItems)
        .where(eq(shoppingCartItems.sessionId, sessionId))
        .limit(1);
      if (existingItems.length === 0 && items.length > 0) {
        await transaction.insert(shoppingCartItems).values(
          items.map((item, position) => ({
            sessionId,
            position,
            name: item.name,
            size: item.size ?? null,
            price: item.price.toFixed(2),
            quantity: item.qty,
          })),
        );
      }
      await transaction
        .update(anonymousSessions)
        .set({ legacyCartImported: new Date(), lastSeenAt: new Date() })
        .where(eq(anonymousSessions.id, sessionId));
    });

    return this.getCart(sessionId);
  }

  async createScan(sessionId: string, scan: ScanInput): Promise<StoredScan> {
    await this.ensureSession(sessionId);
    const common = {
      sessionId,
      kind: scan.kind,
      details: scan.result,
    };
    const values =
      scan.kind === "ticket"
        ? {
            ...common,
            productName: scan.result.product_name,
            size: scan.result.size,
            unit: scan.result.unit,
            barcode: scan.result.code,
            price: scan.result.price?.toFixed(2) ?? null,
            promoPrice: scan.result.promo_price?.toFixed(2) ?? null,
            memberPrice: scan.result.member_price?.toFixed(2) ?? null,
            rawText: scan.result.raw_text,
            priceUncertain: scan.result.price_uncertain,
            recognized: scan.result.readable,
          }
        : {
            ...common,
            productName: scan.result.product_name,
            brand: scan.result.brand,
            variant: scan.result.variant,
            size: scan.result.size,
            barcode: scan.result.barcode,
            recognized: scan.result.recognized,
          };

    const [row] = await this.db.insert(scans).values(values).returning();
    if (!row) throw new Error("The scan could not be persisted.");
    return this.toStoredScan(row);
  }

  async listScans(sessionId: string, limit: number): Promise<StoredScan[]> {
    await this.ensureSession(sessionId);
    const rows = await this.db
      .select()
      .from(scans)
      .where(eq(scans.sessionId, sessionId))
      .orderBy(desc(scans.createdAt))
      .limit(limit);
    return rows.map((row) => this.toStoredScan(row));
  }

  async getProduct(code: string): Promise<ProductInfo | null> {
    const [row] = await this.db.select().from(products).where(eq(products.code, code)).limit(1);
    if (!row) return null;
    return {
      code: row.code,
      name: row.name,
      brand: row.brand,
      quantity: row.quantity,
      image_url: row.imageUrl,
      category: row.category,
    };
  }

  async saveProduct(product: ProductInfo): Promise<void> {
    await this.db
      .insert(products)
      .values({
        code: product.code,
        name: product.name,
        brand: product.brand,
        quantity: product.quantity,
        imageUrl: product.image_url,
        category: product.category,
        source: "open_food_facts",
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: products.code,
        set: {
          name: product.name,
          brand: product.brand,
          quantity: product.quantity,
          imageUrl: product.image_url,
          category: product.category,
          source: "open_food_facts",
          fetchedAt: new Date(),
        },
      });
  }

  async listPrices(productCode: string): Promise<PublicPrice[]> {
    const rows = await this.db
      .select({
        id: prices.id,
        productCode: prices.productCode,
        productName: prices.productName,
        price: prices.price,
        currency: prices.currency,
        observedAt: prices.observedAt,
        verification: prices.verification,
        storeName: stores.name,
        storeCity: stores.city,
      })
      .from(prices)
      .innerJoin(stores, eq(prices.storeId, stores.id))
      .where(eq(prices.productCode, productCode))
      .orderBy(desc(prices.observedAt))
      .limit(100);

    return rows.map((row) => ({
      id: row.id,
      product_code: row.productCode,
      product_name: row.productName,
      price: Number(row.price),
      currency: row.currency,
      observed_at: row.observedAt.toISOString(),
      store: { name: row.storeName, city: row.storeCity },
      verification: row.verification,
    }));
  }

  async startSyncRun(source: string): Promise<string> {
    const [run] = await this.db.insert(syncRuns).values({ source }).returning({ id: syncRuns.id });
    if (!run) throw new Error("Could not create the price sync record.");
    return run.id;
  }

  async upsertStore(store: StoreInfo): Promise<string> {
    const [row] = await this.db
      .insert(stores)
      .values({
        ...store,
        lat: store.lat === null ? null : String(store.lat),
        lon: store.lon === null ? null : String(store.lon),
      })
      .onConflictDoUpdate({
        target: [stores.source, stores.externalId],
        set: {
          name: store.name,
          city: store.city,
          countryCode: store.countryCode,
          lat: store.lat === null ? null : String(store.lat),
          lon: store.lon === null ? null : String(store.lon),
        },
      })
      .returning({ id: stores.id });
    if (!row) throw new Error("Could not save a store from the price feed.");
    return row.id;
  }

  async upsertPrice(price: PriceInput): Promise<void> {
    await this.db
      .insert(prices)
      .values({
        source: price.source,
        externalId: price.externalId,
        productCode: price.productCode,
        productName: price.productName,
        storeId: price.storeId,
        price: price.price.toFixed(2),
        currency: price.currency,
        observedAt: price.observedAt,
        verification: price.verification,
      })
      .onConflictDoUpdate({
        target: [prices.source, prices.externalId],
        set: {
          productCode: price.productCode,
          productName: price.productName,
          storeId: price.storeId,
          price: price.price.toFixed(2),
          currency: price.currency,
          observedAt: price.observedAt,
          verification: price.verification,
        },
      });
  }

  async finishSyncRun(
    id: string,
    status: "success" | "error",
    records: number,
    message?: string,
  ): Promise<void> {
    await this.db
      .update(syncRuns)
      .set({
        status,
        records,
        finishedAt: new Date(),
        ...(message !== undefined && { message }),
      })
      .where(eq(syncRuns.id, id));
  }

  private async ensureSession(sessionId: string): Promise<void> {
    await this.db
      .insert(anonymousSessions)
      .values({ id: sessionId })
      .onConflictDoUpdate({
        target: anonymousSessions.id,
        set: { lastSeenAt: new Date() },
      });
  }

  private toStoredScan(row: typeof scans.$inferSelect): StoredScan {
    return {
      id: row.id,
      kind: row.kind as StoredScan["kind"],
      product_name: row.productName,
      brand: row.brand,
      variant: row.variant,
      size: row.size,
      unit: row.unit,
      barcode: row.barcode,
      price: row.price === null ? null : Number(row.price),
      promo_price: row.promoPrice === null ? null : Number(row.promoPrice),
      member_price: row.memberPrice === null ? null : Number(row.memberPrice),
      raw_text: row.rawText,
      price_uncertain: row.priceUncertain,
      recognized: row.recognized,
      details: row.details,
      created_at: row.createdAt.toISOString(),
    };
  }
}
