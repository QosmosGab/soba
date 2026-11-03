import { describe, it, expect } from "vitest";
import { parseRepReplyFast, parseRepReply } from "./reply";
import { hasLlmCredentials } from "./llm";

describe("rep reply fast path (offline)", () => {
  it("buttons and plain yes/no", () => {
    expect(parseRepReplyFast("Approve")?.action).toBe("approve");
    expect(parseRepReplyFast("yes")?.action).toBe("approve");
    expect(parseRepReplyFast("dale")?.action).toBe("approve");
    expect(parseRepReplyFast("No.")?.action).toBe("reject");
    expect(parseRepReplyFast("take")?.action).toBe("take_over");
    expect(parseRepReplyFast("Take over")?.action).toBe("take_over");
    expect(parseRepReplyFast("UNDO")?.action).toBe("undo");
    expect(parseRepReplyFast("let me think")?.action).toBe("acknowledged");
  });
  it("counters and partial approvals", () => {
    expect(parseRepReplyFast("8.50")).toMatchObject({ action: "counter", price: 8.5, cases: null });
    expect(parseRepReplyFast("8.50 max 200")).toMatchObject({ action: "counter", price: 8.5, cases: 200 });
    expect(parseRepReplyFast("$9 up to 150 cs")).toMatchObject({ action: "counter", price: 9, cases: 150 });
    expect(parseRepReplyFast("yes but only 200")).toMatchObject({ action: "approve", cases: 200 });
    expect(parseRepReplyFast("sí, solo 250")).toMatchObject({ action: "approve", cases: 250 });
  });
  it("hands the rest to the model", () => {
    expect(parseRepReplyFast("tell him 8.75")).toBeNull();
    expect(parseRepReplyFast("no, we're short")).toBeNull();
    expect(parseRepReplyFast("hmm what did he pay last time")).toBeNull();
  });
});

describe.skipIf(!hasLlmCredentials())("rep reply via the model (live)", () => {
  const ctx = { buyerFirst: "Mike", cases: 300, priceOffered: 8.25 };
  it("tell him 8.75 → counter", async () => {
    expect(await parseRepReply("tell him 8.75", ctx)).toMatchObject({ action: "counter", price: 8.75 });
  });
  it("no, we're short → reject with reason", async () => {
    const r = await parseRepReply("no, we're short this week", ctx);
    expect(r.action).toBe("reject");
    expect(r.reason).toMatch(/short/i);
  });
  it("yo le hablo → take over", async () => {
    expect((await parseRepReply("yo le hablo", ctx)).action).toBe("take_over");
  });
  it("an off-topic question → unclear with a question back", async () => {
    const r = await parseRepReply("hmm what did he pay last time", ctx);
    expect(r.action).toBe("unclear");
    expect(r.clarify).toBeTruthy();
  });
});
