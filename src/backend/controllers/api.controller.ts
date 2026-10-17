import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z, type ZodType } from "zod";

import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { createSessionMiddleware } from "../session.js";
import type { BackendServices, DataStore, ScanInput } from "../store.js";
import type { CartItemInput, PhotoProduct, TicketData } from "../../shared/api-types.js";

type ControllerDependencies = {
  config: AppConfig;
  store: DataStore;
  services: BackendServices;
};

const imageSchema = z
  .string()
  .max(4_000_000)
  .regex(/^data:image\/(jpeg|png|webp);base64,/, "A imagem precisa estar em JPEG, PNG ou WebP.");

const cartSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(160),
            size: z.string().trim().max(30).optional(),
            price: z.number().finite().positive().max(100_000),
            qty: z.number().int().min(1).max(999),
            id: z.union([z.string(), z.number()]).optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

const codeSchema = z.string().regex(/^\d{8,14}$/);

function parseBody<T>(schema: ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map(({ path, message }) => ({ path, message }));
    throw new AppError("Os dados enviados são inválidos.", 400, "validation_error", details);
  }
  return parsed.data;
}

function sessionId(response: Response): string {
  const value = (response.locals as { sessionId?: unknown }).sessionId;
  if (typeof value !== "string") throw new AppError("Sessão inválida.", 500, "session_unavailable");
  return value;
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}

function bearerTokenMatches(header: string | undefined, secret: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  const token = match?.[1];
  if (!token) return false;
  const expected = createHash("sha256").update(secret).digest();
  const provided = createHash("sha256").update(token).digest();
  return timingSafeEqual(expected, provided);
}

export function createApiController({ config, store, services }: ControllerDependencies): Router {
  const router = Router();

  router.get(
    "/health",
    asyncRoute(async (_request, response) => {
      await store.ping();
      response.json({ status: "ok", database: "connected" });
    }),
  );

  router.post(
    "/public/jobs/sync-prices",
    asyncRoute(async (request, response) => {
      if (!config.cronSecret) {
        throw new AppError(
          "A sincronização agendada não está configurada.",
          503,
          "job_unavailable",
        );
      }
      if (!bearerTokenMatches(request.headers.authorization, config.cronSecret)) {
        throw new AppError("Não autorizado.", 401, "unauthorized");
      }
      response.json(await services.syncOpenPrices());
    }),
  );

  router.use(createSessionMiddleware(config.sessionSecret, config.nodeEnv === "production"));
  router.get(
    "/cart",
    asyncRoute(async (_request, response) => {
      response.json(await store.getCart(sessionId(response)));
    }),
  );
  router.put(
    "/cart",
    asyncRoute(async (request, response) => {
      const body = parseBody(cartSchema, request.body);
      const items: CartItemInput[] = body.items.map(({ name, size, price, qty }) => ({
        name,
        ...(size !== undefined && { size }),
        price,
        qty,
      }));
      response.json({ items: await store.replaceCart(sessionId(response), items) });
    }),
  );
  router.post(
    "/cart/import-legacy",
    asyncRoute(async (request, response) => {
      const body = parseBody(cartSchema, request.body);
      const items: CartItemInput[] = body.items.map(({ name, size, price, qty }) => ({
        name,
        ...(size !== undefined && { size }),
        price,
        qty,
      }));
      response.json(await store.importLegacyCart(sessionId(response), items));
    }),
  );
  router.get(
    "/scans",
    asyncRoute(async (request, response) => {
      const rawLimit = request.query["limit"];
      const limit =
        rawLimit === undefined ? 25 : parseBody(z.coerce.number().int().min(1).max(100), rawLimit);
      response.json({ scans: await store.listScans(sessionId(response), limit) });
    }),
  );
  router.post(
    "/tickets/scan",
    asyncRoute(async (request, response) => {
      const body = parseBody(z.object({ image: imageSchema }).strict(), request.body);
      const result: TicketData = await services.readTicket(body.image);
      if (!result.readable) {
        response.status(200).json({ ticket: result });
        return;
      }
      const scan: ScanInput = { kind: "ticket", result };
      const saved = await store.createScan(sessionId(response), scan);
      response.status(201).json({ scanId: saved.id, ticket: result });
    }),
  );
  router.post(
    "/products/recognize",
    asyncRoute(async (request, response) => {
      const body = parseBody(z.object({ image: imageSchema }).strict(), request.body);
      const result: PhotoProduct = await services.recognizeProduct(body.image);
      const scan: ScanInput = { kind: "product", result };
      const saved = await store.createScan(sessionId(response), scan);
      response.status(201).json({ scanId: saved.id, product: result });
    }),
  );
  router.get(
    "/products/:code",
    asyncRoute(async (request, response) => {
      const code = parseBody(codeSchema, request.params["code"]);
      const cached = await store.getProduct(code);
      if (cached) {
        response.json({ product: cached, cached: true });
        return;
      }

      const product = await services.lookupProduct(code);
      if (!product) {
        response.status(404).json({
          error: { code: "product_not_found", message: "Produto não encontrado no catálogo." },
        });
        return;
      }
      await store.saveProduct(product);
      response.json({ product, cached: false });
    }),
  );
  router.get(
    "/catalog/camilo",
    asyncRoute(async (request, response) => {
      const query = parseBody(z.string().trim().min(2).max(120), request.query["q"]);
      response.json({ offers: await services.searchCamilo(query) });
    }),
  );
  router.get(
    "/prices",
    asyncRoute(async (request, response) => {
      const code = parseBody(codeSchema, request.query["code"]);
      response.json({ prices: await store.listPrices(code) });
    }),
  );

  return router;
}
