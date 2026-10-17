import { z } from "zod";

import { AppError } from "../errors.js";
import type { DataStore } from "../store.js";

const USER_AGENT = "MercadoFacil/1.0 (price comparison; contact via app)";
const OPEN_PRICES_API = "https://prices.openfoodfacts.org/api/v1/prices";

const locationSchema = z
  .object({
    id: z.number().int(),
    osm_name: z.string().nullable().optional(),
    osm_address_city: z.string().nullable().optional(),
    osm_address_country_code: z.string().nullable().optional(),
    osm_lat: z.number().nullable().optional(),
    osm_lon: z.number().nullable().optional(),
  })
  .passthrough();

const productSchema = z
  .object({
    code: z.string().optional(),
    product_name: z.string().nullable().optional(),
    brands: z.string().nullable().optional(),
    quantity: z.string().nullable().optional(),
    image_url: z.string().url().nullable().optional(),
  })
  .passthrough();

const priceSchema = z
  .object({
    id: z.number().int(),
    product_code: z.string().nullable(),
    product_name: z.string().nullable(),
    price: z.number().positive(),
    currency: z.string().length(3),
    date: z.string(),
    location: locationSchema.nullable(),
    product: productSchema.nullable(),
  })
  .passthrough();

const pageSchema = z
  .object({
    items: z.array(priceSchema),
    pages: z.number().int().positive(),
  })
  .passthrough();

export function createOpenPricesSync(store: DataStore) {
  return async function syncOpenPrices(): Promise<{ records: number }> {
    const runId = await store.startSyncRun("open_prices");
    let records = 0;

    try {
      for (let page = 1; page <= 10; page++) {
        const response = await fetch(
          `${OPEN_PRICES_API}?currency=BRL&type=PRODUCT&order_by=-date&size=100&page=${page}`,
          {
            headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
            signal: AbortSignal.timeout(20_000),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new AppError(
            `Open Prices respondeu ${response.status}.`,
            502,
            "price_feed_unavailable",
          );
        }

        const parsedPage = pageSchema.safeParse(await response.json());
        if (!parsedPage.success) {
          throw new AppError("Open Prices retornou dados inválidos.", 502, "invalid_price_feed");
        }

        for (const item of parsedPage.data.items) {
          const location = item.location;
          if (!location || !item.product_code || !/^\d{8,14}$/.test(item.product_code)) continue;

          const storeId = await store.upsertStore({
            source: "open_prices",
            externalId: String(location.id),
            name: location.osm_name || "Loja sem nome",
            city: location.osm_address_city ?? null,
            countryCode: location.osm_address_country_code ?? null,
            lat: location.osm_lat ?? null,
            lon: location.osm_lon ?? null,
          });
          const product = item.product;
          if (product?.code && /^\d{8,14}$/.test(product.code)) {
            await store.saveProduct({
              code: product.code,
              name: product.product_name ?? null,
              brand: product.brands ?? null,
              quantity: product.quantity ?? null,
              image_url: product.image_url ?? null,
              category: null,
            });
          }
          await store.upsertPrice({
            source: "open_prices",
            externalId: String(item.id),
            productCode: item.product_code,
            productName: product?.product_name ?? item.product_name,
            storeId,
            price: item.price,
            currency: item.currency,
            observedAt: new Date(item.date),
            verification: "source_contributed",
          });
          records++;
        }

        if (page >= parsedPage.data.pages) break;
      }

      await store.finishSyncRun(runId, "success", records);
      return { records };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro desconhecido durante a sincronização.";
      await store.finishSyncRun(runId, "error", records, message);
      throw error;
    }
  };
}
