import { describe, expect, it, vi } from "vitest";

import { waitForDatabase } from "./database-readiness";

describe("waitForDatabase", () => {
  it("retries transient startup connection errors until the database is ready", async () => {
    const probe = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce({ code: "ECONNREFUSED" })
      .mockRejectedValueOnce({
        errors: [{ code: "ECONNREFUSED" }, { code: "ECONNREFUSED" }],
      })
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn(async (_delayMs: number) => {});

    await expect(
      waitForDatabase(probe, { sleep, initialDelayMs: 10, maxDelayMs: 20 }),
    ).resolves.toBeUndefined();

    expect(probe).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it("does not retry authentication or configuration errors", async () => {
    const error = Object.assign(new Error("password authentication failed"), { code: "28P01" });
    const probe = vi.fn<() => Promise<unknown>>().mockRejectedValue(error);
    const sleep = vi.fn(async (_delayMs: number) => {});

    await expect(waitForDatabase(probe, { sleep })).rejects.toBe(error);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("fails after the configured number of transient connection attempts", async () => {
    const error = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    const probe = vi.fn<() => Promise<unknown>>().mockRejectedValue(error);
    const sleep = vi.fn(async (_delayMs: number) => {});

    await expect(waitForDatabase(probe, { attempts: 3, sleep })).rejects.toBe(error);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
