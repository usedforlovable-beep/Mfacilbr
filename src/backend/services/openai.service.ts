import { z } from "zod";

import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { PhotoProduct, TicketData } from "../../shared/api-types.js";

const ticketResultSchema = z
  .object({
    readable: z.boolean(),
    product_name: z.string().nullable(),
    size: z.string().nullable(),
    unit: z.enum(["ml", "l", "g", "kg", "un"]).nullable(),
    price: z.number().positive().nullable(),
    promo_price: z.number().positive().nullable(),
    member_price: z.number().positive().nullable(),
    code: z.string().nullable(),
    raw_text: z.string(),
    price_uncertain: z.boolean(),
  })
  .strict();

const productResultSchema = z
  .object({
    recognized: z.boolean(),
    brand: z.string().nullable(),
    product_name: z.string().nullable(),
    variant: z.string().nullable(),
    size: z.string().nullable(),
    barcode: z.string().nullable(),
    visible_text: z.string().nullable(),
    search_query: z.string().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

const ticketJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    readable: { type: "boolean" },
    product_name: { type: ["string", "null"] },
    size: { type: ["string", "null"] },
    unit: { type: ["string", "null"], enum: ["ml", "l", "g", "kg", "un", null] },
    price: { type: ["number", "null"] },
    promo_price: { type: ["number", "null"] },
    member_price: { type: ["number", "null"] },
    code: { type: ["string", "null"] },
    raw_text: { type: "string" },
    price_uncertain: { type: "boolean" },
  },
  required: [
    "readable",
    "product_name",
    "size",
    "unit",
    "price",
    "promo_price",
    "member_price",
    "code",
    "raw_text",
    "price_uncertain",
  ],
};

const productJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    recognized: { type: "boolean" },
    brand: { type: ["string", "null"] },
    product_name: { type: ["string", "null"] },
    variant: { type: ["string", "null"] },
    size: { type: ["string", "null"] },
    barcode: { type: ["string", "null"] },
    visible_text: { type: ["string", "null"] },
    search_query: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: [
    "recognized",
    "brand",
    "product_name",
    "variant",
    "size",
    "barcode",
    "visible_text",
    "search_query",
    "confidence",
  ],
};

const ticketPrompt = `Você lê etiquetas de preço de prateleira de supermercado brasileiro (OCR).
Não confunda preço com códigos, datas, pesos, porcentagens ou preço por litro/kg. Extraia somente o que está impresso e legível: descrição do produto, tamanho, preço principal (o número grande, em R$) e código.
Vírgula é separador decimal: "99,99" => 99.99. Nunca invente valores; se algo não estiver legível use null. Se não houver etiqueta legível, readable=false.`;

const productPrompt = `Você identifica produtos de supermercado brasileiro a partir de uma foto. Leia (OCR) somente o que está realmente visível na embalagem.
Nunca invente marca, sabor ou tamanho: se não estiver legível, use null. Se a foto estiver borrada, não for um produto, ou houver dúvida sobre qual produto é, retorne recognized=false e confidence="low".
Para hortifrúti a granel (frutas, legumes), use product_name com o nome do item (ex.: "Banana Nanica") e brand null.`;

type ResponseBody = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: unknown }> }>;
};

async function requestStructured<T>(
  config: AppConfig,
  name: string,
  schema: Record<string, unknown>,
  image: string,
  instruction: string,
  validate: (value: unknown) => T,
): Promise<T> {
  if (!config.openAiApiKey) {
    throw new AppError(
      "Leitura por foto indisponível: configure OPENAI_API_KEY.",
      503,
      "provider_unavailable",
    );
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openAiApiKey}`,
      },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: config.openAiModel,
        store: false,
        instructions: instruction,
        text: {
          format: { type: "json_schema", name, strict: true, schema },
        },
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  name === "ticket"
                    ? "Leia esta etiqueta de preço."
                    : "Identifique o produto desta foto.",
              },
              { type: "input_image", image_url: image },
            ],
          },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AppError(
        "O serviço de leitura demorou demais para responder.",
        504,
        "provider_timeout",
      );
    }
    throw new AppError(
      "Não foi possível conectar ao serviço de leitura.",
      502,
      "provider_connection_failed",
    );
  }

  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel();
    if (status === 401 || status === 403) {
      throw new AppError(
        "A chave do serviço de leitura está inválida ou sem permissão.",
        503,
        "provider_auth_failed",
      );
    }
    if (status === 429) {
      throw new AppError(
        "O serviço de leitura está temporariamente limitado. Tente novamente em instantes.",
        429,
        "provider_rate_limited",
      );
    }
    throw new AppError(
      `O serviço de leitura respondeu com erro (${status}).`,
      502,
      "provider_request_failed",
    );
  }

  const payload = (await response.json()) as ResponseBody;
  const text =
    typeof payload.output_text === "string"
      ? payload.output_text
      : payload.output
          ?.flatMap((item) => item.content ?? [])
          .map((item) => item.text)
          .find((value): value is string => typeof value === "string");

  if (!text) {
    throw new AppError(
      "O serviço de leitura não retornou dados reconhecíveis.",
      502,
      "invalid_provider_response",
    );
  }

  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    throw new AppError(
      "O serviço de leitura retornou dados inválidos.",
      502,
      "invalid_provider_response",
    );
  }

  return validate(result);
}

export function createOpenAiService(config: AppConfig) {
  return {
    readTicket(image: string): Promise<TicketData> {
      return requestStructured(config, "ticket", ticketJsonSchema, image, ticketPrompt, (value) => {
        const parsed = ticketResultSchema.safeParse(value);
        if (!parsed.success) {
          throw new AppError(
            "A resposta de leitura da etiqueta não passou pela validação.",
            502,
            "invalid_provider_response",
          );
        }
        if (parsed.data.code && !/^\d{4,14}$/.test(parsed.data.code)) parsed.data.code = null;
        return parsed.data;
      });
    },
    recognizeProduct(image: string): Promise<PhotoProduct> {
      return requestStructured(
        config,
        "product",
        productJsonSchema,
        image,
        productPrompt,
        (value) => {
          const parsed = productResultSchema.safeParse(value);
          if (!parsed.success) {
            throw new AppError(
              "A resposta de reconhecimento não passou pela validação.",
              502,
              "invalid_provider_response",
            );
          }
          if (parsed.data.barcode && !/^\d{8,14}$/.test(parsed.data.barcode))
            parsed.data.barcode = null;
          return parsed.data;
        },
      );
    },
  };
}
