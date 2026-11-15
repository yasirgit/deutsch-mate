import { describe, expect, it } from "vitest";

import { setTransactionAppContext } from "./transaction-context.js";

describe("setTransactionAppContext validation", () => {
  it("rejects invalid userId before querying", async () => {
    const calls: unknown[] = [];
    const client = {
      query: async (...args: unknown[]) => {
        calls.push(args);
        return { rows: [] };
      },
    };

    await expect(
      setTransactionAppContext(client, {
        userId: "bad",
        roles: ["learner"],
        correlationId: "018f0000-0000-7000-8000-000000000001",
      }),
    ).rejects.toThrow(/Invalid userId/);
    expect(calls).toHaveLength(0);
  });

  it("rejects invalid role tokens", async () => {
    const client = {
      query: async () => ({ rows: [] }),
    };

    await expect(
      setTransactionAppContext(client, {
        userId: "018f0000-0000-7000-8000-000000000001",
        roles: ["Learner!"],
        correlationId: "018f0000-0000-7000-8000-000000000002",
      }),
    ).rejects.toThrow(/Invalid app role/);
  });

  it("applies set_config for valid context", async () => {
    const calls: unknown[][] = [];
    const client = {
      query: async (...args: unknown[]) => {
        calls.push(args);
        return { rows: [] };
      },
    };

    await setTransactionAppContext(client, {
      userId: "018f0000-0000-7000-8000-000000000001",
      roles: ["learner", "admin"],
      correlationId: "018f0000-0000-7000-8000-000000000002",
    });

    expect(calls).toHaveLength(3);
    expect(calls[0]?.[1]).toEqual(["018f0000-0000-7000-8000-000000000001"]);
    expect(calls[1]?.[1]).toEqual(["learner,admin"]);
    expect(calls[2]?.[1]).toEqual(["018f0000-0000-7000-8000-000000000002"]);
  });
});
