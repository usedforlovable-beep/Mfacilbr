import { z } from "zod";

import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { CamiloOffer, ProductInfo } from "../../shared/api-types.js";

const USER_AGENT = "MercadoFacil/1.0 (product catalog)";
const CAMILO_STORE = "https://www.mandaguari.camilosupermercados.com.br";
const FIRECRAWL_API = "https://api.firecrawl.dev/v2";

const offResponseSchema = z
  .object({
    status: z.number(),
    product: z
      .object({
        product_name: z.string().optional(),
        product_name_pt: z.string().optional(),
        brands: z.string().optional(),
        quantity: z.string().optional(),
        image_front_small_url: z.string().url().optional(),
        categories: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const mapResponseSchema = z
  .object({
    links: z
      .array(
        z.union([
          z.string(),
          z.object({ url: z.string().optional(), title: z.string().optional() }).passthrough(),
        ]),
      )
      .optional(),
  })
  .passthrough();

const camiloResultSchema = z
  .object({
    name: z.string().min(1),
    price: z.number().positive().nullable(),
    club_price: z.number().positive().nullable(),
    wholesale_price: z.number().positive().nullable(),
    wholesale_min_qty: z.number().int().positive().nullable(),
    unit: z.string().nullable(),
    image_url: z.string().url().nullable(),
  })
  .passthrough();

async function fetchFirecrawl(config: AppConfig, path: string, body: unknown): Promise<unknown> {
  if (!config.firecrawlApiKey) {
    throw new AppError(
      "Consulta ao catálogo Camilo indisponível: configure FIRECRAWL_API_KEY.",
      503,
      "provider_unavailable",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${FIRECRAWL_API}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.firecrawlApiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AppError(
      "Não foi possível conectar ao catálogo Camilo.",
      502,
      "provider_connection_failed",
    );
  }

  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel();
    if (status === 401 || status === 403) {
      throw new AppError(
        "A chave do Firecrawl está inválida ou sem permissão.",
        503,
        "provider_auth_failed",
      );
    }
    throw new AppError(
      `O catálogo Camilo respondeu com erro (${status}).`,
      502,
      "provider_request_failed",
    );
  }

  return response.json();
}

export async function lookupOpenFoodFacts(code: string): Promise<ProductInfo | null> {
  let response: Response;
  try {
    response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}?fields=product_name,product_name_pt,brands,quantity,image_front_small_url,categories`,
      {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    throw new AppError(
      "Falha de rede ao consultar o catálogo de produtos.",
      502,
      "catalog_unavailable",
    );
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      `O catálogo de produtos respondeu com erro (${response.status}).`,
      502,
      "catalog_unavailable",
    );
  }

  const parsed = offResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new AppError(
      "O catálogo de produtos retornou dados inválidos.",
      502,
      "invalid_catalog_response",
    );
  }
  if (parsed.data.status !== 1 || !parsed.data.product) return null;

  const product = parsed.data.product;
  return {
    code,
    name: product.product_name_pt?.trim() || product.product_name?.trim() || null,
    brand: product.brands?.split(",")[0]?.trim() || null,
    quantity: product.quantity?.trim() || null,
    image_url: product.image_front_small_url ?? null,
    category: product.categories?.split(",").pop()?.trim() || null,
  };
}

function normalizeTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(\d)\s*(l|lt|lts|litros?)\b/g, "$1l")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 1 && !["de", "da", "do", "com", "sem", "pet"].includes(word));
}

export function createCamiloCatalogService(config: AppConfig) {
  return async function searchCamilo(query: string): Promise<CamiloOffer[]> {
    const mapResult = mapResponseSchema.safeParse(
      await fetchFirecrawl(config, "/map", { url: CAMILO_STORE, search: query, limit: 20 }),
    );
    if (!mapResult.success) {
      throw new AppError(
        "O catálogo Camilo retornou um mapa inválido.",
        502,
        "invalid_catalog_response",
      );
    }

    const links = (mapResult.data.links ?? []).map((link) =>
      typeof link === "string" ? { url: link } : link,
    );
    const wanted = [...new Set(normalizeTokens(query))];
    const variants = [
      "acucar",
      "zero",
      "diet",
      "light",
      "limao",
      "laranja",
      "uva",
      "guarana",
      "cherry",
      "vanilla",
    ];
    const sizes = wanted.filter((word) => /^\d+(ml|l|g|kg)$/.test(word));
    const urls = links
      .filter((link) => link.url?.startsWith(`${CAMILO_STORE}/p/`))
      .map((link) => {
        const url = link.url!;
        const actual = new Set(normalizeTokens(`${link.title ?? ""} ${url.split("/p/")[1] ?? ""}`));
        const score = wanted.length
          ? wanted.filter((word) => actual.has(word)).length / wanted.length
          : 0;
        return { url, actual, score };
      })
      .filter(
        ({ actual, score }) =>
          score >= 0.7 &&
          sizes.every((size) => actual.has(size)) &&
          !variants.some((variant) => actual.has(variant) && !wanted.includes(variant)),
      )
      .sort((first, second) => second.score - first.score)
      .slice(0, 2);

    if (!urls.length) return [];

    const settled = await Promise.allSettled(
      urls.map(({ url }) =>
        fetchFirecrawl(config, "/scrape", {
          url,
          onlyMainContent: true,
          waitFor: 1500,
          formats: [
            {
              type: "json",
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  price: { type: ["number", "null"] },
                  club_price: { type: ["number", "null"] },
                  wholesale_price: { type: ["number", "null"] },
                  wholesale_min_qty: { type: ["integer", "null"] },
                  unit: { type: ["string", "null"] },
                  image_url: { type: ["string", "null"] },
                },
                required: [
                  "name",
                  "price",
                  "club_price",
                  "wholesale_price",
                  "wholesale_min_qty",
                  "unit",
                  "image_url",
                ],
              },
              prompt: "Extract only the main product on this page (not related products).",
            },
          ],
        }),
      ),
    );

    const offers: CamiloOffer[] = [];
    settled.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error("[catalog] Camilo product request failed", result.reason);
        return;
      }
      const payload = result.value as { data?: { json?: unknown }; json?: unknown };
      const parsed = camiloResultSchema.safeParse(payload.data?.json ?? payload.json);
      const url = urls[index]?.url;
      if (!parsed.success || !url) return;

      const product = parsed.data;
      offers.push({
        url,
        name: product.name,
        price: product.price,
        club_price: product.club_price === product.wholesale_price ? null : product.club_price,
        wholesale_price: product.wholesale_price,
        wholesale_min_qty: product.wholesale_min_qty,
        unit: product.unit,
        image_url: product.image_url,
        retrieved_at: new Date().toISOString(),
      });
    });

    if (!offers.length && settled.some((result) => result.status === "rejected")) {
      throw new AppError(
        "O catálogo não pôde consultar os produtos encontrados.",
        502,
        "catalog_unavailable",
      );
    }
    return offers;
  };
}
