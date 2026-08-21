import { describe, expect, it } from "vitest";
import { runSessionRebindTransaction, SessionRebindTransactionError } from "./session-rebind-transaction";

describe("runSessionRebindTransaction", () => {
  it("rolls back committed steps and the pre-applied ACP runtime in reverse order", async () => {
    const calls: string[] = [];
    await expect(runSessionRebindTransaction([
      { name: "assignment", apply: () => { calls.push("apply assignment"); }, rollback: () => { calls.push("rollback assignment"); } },
      { name: "projection", apply: () => { calls.push("apply projection"); throw new Error("disk full"); }, rollback: () => { calls.push("rollback projection"); } },
    ], [{ name: "runtime", rollback: () => { calls.push("rollback runtime"); } }])).rejects.toMatchObject({
      name: "SessionRebindTransactionError",
      rollbackErrors: [],
    });
    expect(calls).toEqual(["apply assignment", "apply projection", "rollback assignment", "rollback runtime"]);
  });

  it("preserves the primary error and reports rollback failures", async () => {
    const failure = await runSessionRebindTransaction([
      { name: "assignment", apply: () => undefined, rollback: () => { throw new Error("vault locked"); } },
      { name: "runtime", apply: () => { throw new Error("write failed"); }, rollback: () => undefined },
    ]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SessionRebindTransactionError);
    expect((failure as SessionRebindTransactionError).message).toContain("write failed");
    expect((failure as SessionRebindTransactionError).rollbackErrors).toEqual(["assignment: vault locked"]);
  });
});
