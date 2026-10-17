type DatabaseError = {
  code?: unknown;
  cause?: unknown;
  errors?: unknown;
};

const transientConnectionCodes = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "57P03",
]);

function isTransientConnectionError(error: unknown, seen = new Set<unknown>()): boolean {
  if (error === null || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);

  const databaseError = error as DatabaseError;
  if (typeof databaseError.code === "string" && transientConnectionCodes.has(databaseError.code)) {
    return true;
  }

  const nested = [
    databaseError.cause,
    ...(Array.isArray(databaseError.errors) ? databaseError.errors : []),
  ];
  return nested.some((child) => isTransientConnectionError(child, seen));
}

export type DatabaseReadinessOptions = {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  sleep?: (delayMs: number) => Promise<void>;
};

export async function waitForDatabase(
  probe: () => Promise<unknown>,
  {
    attempts = 15,
    initialDelayMs = 500,
    maxDelayMs = 5_000,
    onRetry = () => {},
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  }: DatabaseReadinessOptions = {},
): Promise<void> {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Database readiness attempts must be a positive integer.");
  }

  let delayMs = initialDelayMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await probe();
      return;
    } catch (error) {
      if (!isTransientConnectionError(error) || attempt >= attempts) {
        throw error;
      }
      onRetry(attempt, delayMs, error);
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }
}
