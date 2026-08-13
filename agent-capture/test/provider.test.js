import { describe, expect, it, vi } from "vitest";
import {
  createMessage,
  DEFAULT_MODELS,
  requestExtras,
  resolveModel,
  resolveProvider,
} from "../src/provider.js";

describe("resolveProvider / resolveModel", () => {
  it("defaults to anthropic + claude-sonnet-5", () => {
    const provider = resolveProvider({});
    expect(provider).toBe("anthropic");
    expect(resolveModel(provider, {})).toBe("claude-sonnet-5");
  });

  it("honors env overrides", () => {
    const env = { STRUKTR_AGENT_PROVIDER: "foundry", STRUKTR_AGENT_MODEL: "claude-opus-5" };
    const provider = resolveProvider(env);
    expect(provider).toBe("foundry");
    expect(resolveModel(provider, env)).toBe("claude-opus-5");
  });

  it("prefixes bedrock model ids", () => {
    expect(resolveModel("bedrock", {})).toBe("anthropic.claude-sonnet-5");
    expect(resolveModel("bedrock", { STRUKTR_AGENT_MODEL: "claude-haiku-4-5" })).toBe(
      "anthropic.claude-haiku-4-5",
    );
    expect(resolveModel("bedrock", { STRUKTR_AGENT_MODEL: "anthropic.claude-sonnet-5" })).toBe(
      "anthropic.claude-sonnet-5",
    );
  });

  it("rejects unknown providers", () => {
    expect(() => resolveProvider({ STRUKTR_AGENT_PROVIDER: "openai" })).toThrow(/Unknown/);
  });

  it("has a default model per provider", () => {
    expect(Object.keys(DEFAULT_MODELS)).toEqual(["anthropic", "foundry", "bedrock"]);
  });
});

describe("requestExtras", () => {
  it("adds server-side fallbacks only on Claude API Opus/Fable", () => {
    expect(requestExtras("anthropic", "claude-opus-5")).toMatchObject({ fallbacks: "default" });
    expect(requestExtras("anthropic", "claude-fable-5")).toMatchObject({ fallbacks: "default" });
    expect(requestExtras("anthropic", "claude-sonnet-5")).toEqual({});
    expect(requestExtras("foundry", "claude-opus-5")).toEqual({});
    expect(requestExtras("bedrock", "anthropic.claude-opus-5")).toEqual({});
  });
});

describe("createMessage", () => {
  const params = { max_tokens: 100, messages: [] };

  it("uses the plain path for sonnet on any provider", async () => {
    const client = {
      messages: { create: vi.fn(async () => ({ ok: 1 })) },
      beta: { messages: { create: vi.fn() } },
    };
    await createMessage(client, "anthropic", "claude-sonnet-5", params);
    expect(client.messages.create).toHaveBeenCalledWith({ model: "claude-sonnet-5", ...params });
    expect(client.beta.messages.create).not.toHaveBeenCalled();
  });

  it("uses the beta path with fallbacks for opus on the Claude API", async () => {
    const client = {
      messages: { create: vi.fn() },
      beta: { messages: { create: vi.fn(async () => ({ ok: 1 })) } },
    };
    await createMessage(client, "anthropic", "claude-opus-5", params);
    const call = client.beta.messages.create.mock.calls[0][0];
    expect(call.fallbacks).toBe("default");
    expect(call.betas).toContain("server-side-fallback-2026-07-01");
  });
});
