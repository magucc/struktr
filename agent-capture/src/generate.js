import { createMessage, makeClient, resolveModel, resolveProvider } from "./provider.js";
import { serializeFlow, validateSteps } from "./serialize.js";

const STEP_SCHEMA = {
  type: "object",
  properties: {
    focus_reasoning: {
      type: "string",
      description: "One or two sentences: what this PR changes and which screens the flow should therefore capture",
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          command: {
            type: "string",
            enum: [
              "tapOn_text", "tapOn_id", "inputText", "assertVisible",
              "takeScreenshot", "scroll", "back", "hideKeyboard", "waitForAnimationToEnd",
            ],
          },
          value: {
            type: "string",
            description: "Visible text / resource id / input text / screenshot label. Empty string for commands without a value.",
          },
        },
        required: ["command", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["focus_reasoning", "steps"],
  additionalProperties: false,
};

function buildPrompt(context) {
  const parts = [
    "You write Maestro UI test flows that capture preview screenshots of a mobile app for PR review.",
    "Given the PR context below, produce a short flow (5-20 steps) through the app that showcases",
    "the screens this PR touches. Screenshots are the deliverable — capture the state a reviewer",
    "needs to see, with an assertVisible before each takeScreenshot so the screen has settled.",
    "The app launches with a mock session already signed in unless the PR is about auth.",
    "",
    `## PR title\n${context.title ?? "(none)"}`,
    `## PR description\n${context.body ?? "(none)"}`,
    `## Changed files\n${(context.changedFiles ?? []).join("\n") || "(unknown)"}`,
  ];
  if (context.screens) {
    parts.push(`## App screen map (from .struktr.yml)\n${context.screens}`);
  }
  return parts.join("\n");
}

/** Generate a Maestro flow YAML from PR context. Throws on refusal or invalid
 * output — callers treat any throw as "fall back to committed flows". */
export async function generateFlow(context, { client, model, appId, provider } = {}) {
  const prov = provider ?? resolveProvider();
  const resolvedModel = model ?? resolveModel(prov);
  const anthropic = client ?? (await makeClient(prov));
  const response = await createMessage(anthropic, prov, resolvedModel, {
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: STEP_SCHEMA } },
    messages: [{ role: "user", content: buildPrompt(context) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Model declined to generate a flow");
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("No text block in model response");
  const parsed = JSON.parse(text);
  validateSteps(parsed.steps);
  return {
    yaml: serializeFlow(appId, parsed.steps, { name: `agent flow: ${context.title ?? "PR preview"}` }),
    reasoning: parsed.focus_reasoning,
  };
}
