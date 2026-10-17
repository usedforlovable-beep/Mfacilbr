import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const COOKIE_NAME = "mf_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function signature(sessionId: string, secret: string): string {
  return createHmac("sha256", secret).update(sessionId).digest("hex");
}

function validSession(cookieHeader: string | undefined, secret: string): string | null {
  const value = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!value) return null;

  const [sessionId, providedSignature] = value.split(".");
  if (
    !sessionId ||
    !providedSignature ||
    !/^[0-9a-f-]{36}$/i.test(sessionId) ||
    !/^[0-9a-f]{64}$/i.test(providedSignature)
  ) {
    return null;
  }

  const expected = Buffer.from(signature(sessionId, secret), "hex");
  const provided = Buffer.from(providedSignature, "hex");
  return timingSafeEqual(expected, provided) ? sessionId : null;
}

export function createSessionMiddleware(secret: string, production: boolean): RequestHandler {
  return (request, response, next) => {
    const existing = validSession(request.headers.cookie, secret);
    const sessionId = existing ?? randomUUID();
    response.locals["sessionId"] = sessionId;

    if (!existing) {
      const secure = production ? "; Secure" : "";
      const sameSite = production ? "None" : "Lax";
      response.append(
        "Set-Cookie",
        `${COOKIE_NAME}=${sessionId}.${signature(sessionId, secret)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${MAX_AGE_SECONDS}${secure}`,
      );
    }

    next();
  };
}
