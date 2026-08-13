import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { makeDefaultHandlers, runAgent } from "../src/agent.js";

const CTX = { title: "Add checkout", body: "", changedFiles: ["src/Checkout.tsx"] };

const GOOD_STEPS = [
  { command: "assertVisible", value: "Cart" },
  { command: "takeScreenshot", value: "cart" },
];

/** Scripted client: each call pops the next canned response. */
function scriptedClient(responses) {
  let i = 0;
  return {
    beta: {
      messages: {
        create: vi.fn(async ({ messages }) => {
          const r = responses[Math.min(i, responses.length - 1)];
          i += 1;
          return typeof r === "function" ? r(messages) : r;
        }),
      },
    },
  };
}

const toolUse = (name, input, id = `t-${name}-${Math.random().toString(36).slice(2, 6)}`) => ({
  type: "tool_use", id, name, input,
});
const turn = (...blocks) => ({ stop_reason: "tool_use", content: blocks });

describe("runAgent", () => {
  it("explores, runs the flow, and submits — happy path", async () => {
    const handlers = {
      read_file: vi.fn(async () => "export const Cart = () => <Text>Cart</Text>"),
      run_flow: vi.fn(async () => "PASSED\nall good"),
    };
    const client = scriptedClient([
      turn(toolUse("read_file", { path: "src/Checkout.tsx" })),
      turn(toolUse("run_flow", { steps: GOOD_STEPS })),
      turn(toolUse("submit_flow", { steps: GOOD_STEPS, reasoning: "Shows the cart." })),
    ]);

    const result = await runAgent(CTX, { client, appId: "ai.kju.app", handlers });
    expect(result.yaml).toContain("appId: ai.kju.app");
    expect(result.yaml).toContain("screenshots/01-cart");
    expect(result.verified).toBe(true);
    expect(handlers.read_file).toHaveBeenCalledOnce();

    // Tool results flow back as user messages
    const lastCall = client.beta.messages.create.mock.calls.at(-1)[0];
    const toolResultMsgs = lastCall.messages.filter(
      (m) => m.role === "user" && Array.isArray(m.content) && m.content[0]?.type === "tool_result",
    );
    expect(toolResultMsgs.length).toBeGreaterThanOrEqual(2);
  });

  it("feeds run_flow failures back so the agent can revise", async () => {
    const handlers = {
      run_flow: vi
        .fn()
        .mockResolvedValueOnce("FAILED\nElement not found: Chekout")
        .mockResolvedValueOnce("PASSED\nok"),
    };
    const client = scriptedClient([
      turn(toolUse("run_flow", { steps: [{ command: "tapOn_text", value: "Chekout" }, ...GOOD_STEPS] })),
      (messages) => {
        // The failure text must be visible to the model on the next turn
        const flat = JSON.stringify(messages);
        expect(flat).toContain("Element not found: Chekout");
        return turn(toolUse("run_flow", { steps: GOOD_STEPS }));
      },
      turn(toolUse("submit_flow", { steps: GOOD_STEPS, reasoning: "fixed" })),
    ]);

    const result = await runAgent(CTX, { client, appId: "x", handlers });
    expect(result.verified).toBe(true);
    expect(handlers.run_flow).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid submissions and lets the agent retry", async () => {
    const client = scriptedClient([
      turn(toolUse("submit_flow", { steps: [{ command: "runScript", value: "evil" }], reasoning: "bad" })),
      (messages) => {
        expect(JSON.stringify(messages)).toContain("Unknown command");
        return turn(toolUse("submit_flow", { steps: GOOD_STEPS, reasoning: "ok now" }));
      },
    ]);
    const result = await runAgent(CTX, { client, appId: "x", handlers: {} });
    expect(result.yaml).toContain("screenshots/01-cart");
  });

  it("throws when the agent never submits", async () => {
    const client = scriptedClient([{ stop_reason: "end_turn", content: [{ type: "text", text: "dunno" }] }]);
    await expect(runAgent(CTX, { client, appId: "x", handlers: {} })).rejects.toThrow(/did not submit/);
  });

  it("throws on refusal", async () => {
    const client = scriptedClient([{ stop_reason: "refusal", content: [] }]);
    await expect(runAgent(CTX, { client, appId: "x", handlers: {} })).rejects.toThrow(/declined/);
  });
});

describe("makeDefaultHandlers", () => {
  it("confines read_file to the workspace", async () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "struktr-ws-"));
    mkdirSync(path.join(ws, "src"));
    writeFileSync(path.join(ws, "src", "a.txt"), "hello");
    const h = makeDefaultHandlers({ workspace: ws, appId: "x", emulator: false });

    await expect(h.read_file({ path: "src/a.txt" })).resolves.toBe("hello");
    await expect(h.read_file({ path: "../../etc/passwd" })).rejects.toThrow(/escapes/);
    await expect(h.read_file({ path: "/etc/passwd" })).rejects.toThrow(/escapes/);
  });

  it("reports run_flow unavailable without an emulator", async () => {
    const h = makeDefaultHandlers({ workspace: "/tmp", appId: "x", emulator: false });
    await expect(h.run_flow({ steps: GOOD_STEPS })).resolves.toMatch(/unavailable/);
  });
});
