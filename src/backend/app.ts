import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import type { AppConfig } from "./config.js";
import { createApiController } from "./controllers/api.controller.js";
import { AppError } from "./errors.js";
import type { BackendServices, DataStore } from "./store.js";

type AppDependencies = {
  config: AppConfig;
  store: DataStore;
  services: BackendServices;
};

export function createApp({ config, store, services }: AppDependencies) {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use((request, response, next) => {
    const requestId = randomUUID();
    response.locals["requestId"] = requestId;
    response.setHeader("X-Request-Id", requestId);
    const startedAt = performance.now();
    response.on("finish", () => {
      console.info(
        JSON.stringify({
          event: "http_request",
          requestId,
          method: request.method,
          path: request.path,
          status: response.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        }),
      );
    });
    next();
  });

  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || config.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AppError("Origem não permitida.", 403, "origin_not_allowed"));
      },
    }),
  );
  app.use(express.json({ limit: "6mb", strict: true }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_request, response) => {
        response.status(429).json({
          error: {
            code: "rate_limited",
            message: "Muitas solicitações. Tente novamente em instantes.",
          },
        });
      },
    }),
  );
  app.use(
    "/api/tickets/scan",
    rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_request, response) => {
        response.status(429).json({
          error: {
            code: "scan_rate_limited",
            message: "Muitos escaneamentos seguidos. Aguarde um pouco.",
          },
        });
      },
    }),
  );
  app.use(
    "/api/products/recognize",
    rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_request, response) => {
        response.status(429).json({
          error: {
            code: "scan_rate_limited",
            message: "Muitas fotos seguidas. Aguarde um pouco.",
          },
        });
      },
    }),
  );
  app.use("/api", createApiController({ config, store, services }));
  app.use("/api", (_request, response) => {
    response
      .status(404)
      .json({ error: { code: "not_found", message: "Endpoint não encontrado." } });
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const requestId = (response.locals as { requestId?: string }).requestId;
    if (error instanceof AppError) {
      if (error.statusCode >= 500)
        console.error("API request failed", {
          requestId,
          code: error.code,
          message: error.message,
        });
      response.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined && { details: error.details }),
          ...(requestId && { requestId }),
        },
      });
      return;
    }

    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: "validation_error",
          message: "Os dados enviados são inválidos.",
          details: error.issues.map(({ path, message }) => ({ path, message })),
        },
      });
      return;
    }

    if (
      error &&
      typeof error === "object" &&
      "type" in error &&
      error.type === "entity.parse.failed"
    ) {
      response.status(400).json({
        error: {
          code: "invalid_json",
          message: "O corpo da solicitação não contém JSON válido.",
        },
      });
      return;
    }

    console.error("Unhandled API error", { requestId, error });
    response.status(500).json({
      error: {
        code: "internal_error",
        message: "Ocorreu um erro interno.",
        ...(requestId && { requestId }),
      },
    });
  };
  app.use(errorHandler);

  return app;
}
