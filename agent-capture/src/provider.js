/** Provider selection for agent-capture.
 *
 * Supported: "anthropic" (default), "foundry" (Microsoft Foundry — Claude at
 * standard API rates, billed via Microsoft Marketplace), "bedrock" (Amazon
 * Bedrock — bills as native AWS spend, so AWS credits apply).
 *
 * All three SDKs expose the same messages surface; only construction and
 * model-id shape differ (Bedrock prefixes "anthropic.").
 */

export const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-5",
  foundry: "claude-sonnet-5",
  bedrock: "anthropic.claude-sonnet-5",
};

export function resolveProvider(env = process.env) {
  const provider = env.STRUKTR_AGENT_PROVIDER || "anthropic";
  if (!(provider in DEFAULT_MODELS)) {
    throw new Error(
      `Unknown STRUKTR_AGENT_PROVIDER "${provider}" (expected: ${Object.keys(DEFAULT_MODELS).join(", ")})`,
    );
  }
  return provider;
}

export function resolveModel(provider, env = process.env) {
  let model = env.STRUKTR_AGENT_MODEL || DEFAULT_MODELS[provider];
  if (provider === "bedrock" && !model.startsWith("anthropic.")) {
    model = `anthropic.${model}`;
  }
  return model;
}

/** Server-side refusal fallbacks: Claude-API-only, and only meaningful on the
 * Opus 5 / Fable 5 tier where safety classifiers can decline requests. */
export function requestExtras(provider, model) {
  if (provider === "anthropic" && /^claude-(opus-5|fable-5)/.test(model)) {
    return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
  }
  return {};
}

export async function makeClient(provider, env = process.env) {
  if (provider === "foundry") {
    const { default: AnthropicFoundry } = await import("@anthropic-ai/foundry-sdk");
    const opts = { apiKey: env.ANTHROPIC_FOUNDRY_API_KEY };
    if (env.ANTHROPIC_FOUNDRY_BASE_URL) opts.baseURL = env.ANTHROPIC_FOUNDRY_BASE_URL;
    else opts.resource = env.ANTHROPIC_FOUNDRY_RESOURCE;
    return new AnthropicFoundry(opts);
  }
  if (provider === "bedrock") {
    const { AnthropicBedrockMantle } = await import("@anthropic-ai/bedrock-sdk");
    return new AnthropicBedrockMantle({ awsRegion: env.AWS_REGION || "eu-west-1" });
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic();
}

/** Create a message on whichever surface fits: the beta path when fallback
 * extras apply (Claude API + Opus/Fable), the plain path otherwise. */
export async function createMessage(client, provider, model, params) {
  const extras = requestExtras(provider, model);
  if (Object.keys(extras).length > 0 && client.beta?.messages) {
    return client.beta.messages.create({ model, ...extras, ...params });
  }
  return client.messages.create({ model, ...params });
}
