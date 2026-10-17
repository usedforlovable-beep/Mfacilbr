export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const apiBase = (import.meta.env["VITE_API_BASE_URL"] || "/api").replace(/\/+$/, "");

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined && { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(
      "Não foi possível conectar à API. Verifique se o servidor está ativo e tente novamente.",
      0,
      "network_error",
    );
  }

  let payload: unknown;
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "desconhecido";
  const responseText = await response.text();
  try {
    if (!responseText) throw new SyntaxError("A resposta está vazia.");
    payload = JSON.parse(responseText);
  } catch {
    if (!response.ok && [502, 503, 504].includes(response.status)) {
      throw new ApiError(
        `A API está temporariamente indisponível (HTTP ${response.status}). Tente novamente em instantes.`,
        response.status,
        "service_unavailable",
      );
    }
    throw new ApiError(
      response.ok
        ? `A API respondeu com conteúdo inválido (HTTP ${response.status}, ${contentType}). Verifique a URL e o formato da resposta do servidor.`
        : `A API respondeu com erro HTTP ${response.status} em formato não JSON (${contentType}). Verifique a URL e o servidor.`,
      response.status,
      "invalid_response",
    );
  }

  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload ? payload.error : null;
    const message =
      error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : `A solicitação falhou (${response.status}).`;
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "request_failed";
    throw new ApiError(message, response.status, code);
  }

  return payload as T;
}
