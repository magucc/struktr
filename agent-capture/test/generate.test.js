import { describe, expect, it, vi } from "vitest";
import { generateFlow } from "../src/generate.js";

function mockClient(responseBody, stopReason = "end_turn") {
  return {
    messages: {
      create: vi.fn(async () => ({
        stop_reason: stopReason,
        content: [{ type: "text", text: JSON.stringify(responseBody) }],
      })),
    },
  };
}

const CTX = {
  title: "Add checkout flow",
  body: "New payment screen",
  changedFiles: ["src/screens/Checkout.tsx"],
};

describe("generateFlow", () => {
  it("returns serialized YAML from structured model output", async () => {
    const client = mockClient({
      focus_reasoning: "PR touches checkout, capture cart and payment.",
      steps: [
        { command: "assertVisible", value: "Cart" },
        { command: "takeScreenshot", value: "cart" },
        { command: "tapOn_text", value: "Checkout" },
        { command: "takeScreenshot", value: "payment" },
      ],
    });
    const { yaml, reasoning } = await generateFlow(CTX, { client, appId: "ai.kju.app" });
    expect(yaml).toContain("appId: ai.kju.app");
    expect(yaml).toContain("screenshots/01-cart");
    expect(yaml).toContain("screenshots/02-payment");
    expect(reasoning).toMatch(/checkout/);

    const call = client.messages.create.mock.calls[0][0];
    expect(call.model).toBe("claude-sonnet-5");
    expect(call.fallbacks).toBeUndefined();
    expect(call.output_config.format.type).toBe("json_schema");
    expect(call.messages[0].content).toContain("Add checkout flow");
  });

  it("throws on refusal so the caller falls back", async () => {
    const client = mockClient({}, "refusal");
    await expect(generateFlow(CTX, { client, appId: "x" })).rejects.toThrow(/declined/);
  });

  it("throws when the model emits invalid steps", async () => {
    const client = mockClient({
      focus_reasoning: "bad",
      steps: [{ command: "runScript", value: "rm -rf /" }],
    });
    await expect(generateFlow(CTX, { client, appId: "x" })).rejects.toThrow(/Unknown command/);
  });
});
