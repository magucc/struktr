/** Deterministic serialization of validated step objects into Maestro YAML.
 * The model never writes YAML directly — it emits structured steps, we build
 * the flow. That removes YAML-injection and formatting drift entirely. */

export const ALLOWED_COMMANDS = new Set([
  "tapOn_text",
  "tapOn_id",
  "inputText",
  "assertVisible",
  "takeScreenshot",
  "scroll",
  "back",
  "hideKeyboard",
  "waitForAnimationToEnd",
]);

const MAX_STEPS = 30;

export class FlowValidationError extends Error {}

/** Validate the structured steps the model produced. Throws FlowValidationError. */
export function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new FlowValidationError("Flow has no steps");
  }
  if (steps.length > MAX_STEPS) {
    throw new FlowValidationError(`Flow has ${steps.length} steps (max ${MAX_STEPS})`);
  }
  let screenshots = 0;
  for (const step of steps) {
    if (!ALLOWED_COMMANDS.has(step.command)) {
      throw new FlowValidationError(`Unknown command "${step.command}"`);
    }
    const needsValue = ["tapOn_text", "tapOn_id", "inputText", "assertVisible", "takeScreenshot"];
    if (needsValue.includes(step.command) && typeof step.value !== "string") {
      throw new FlowValidationError(`Command "${step.command}" requires a string value`);
    }
    if (step.command === "takeScreenshot") screenshots += 1;
  }
  if (screenshots === 0) {
    throw new FlowValidationError("Flow captures no screenshots");
  }
  return steps;
}

function yamlQuote(value) {
  return JSON.stringify(String(value));
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "step";
}

/** Serialize validated steps to a Maestro flow YAML string. */
export function serializeFlow(appId, steps, { name = "agent-generated preview flow" } = {}) {
  validateSteps(steps);
  const lines = [`appId: ${appId}`, `name: ${yamlQuote(name)}`, "---", "- launchApp:", "    clearState: true"];
  let shot = 0;
  for (const step of steps) {
    switch (step.command) {
      case "tapOn_text":
        lines.push(`- tapOn: ${yamlQuote(step.value)}`);
        break;
      case "tapOn_id":
        lines.push("- tapOn:", `    id: ${yamlQuote(step.value)}`);
        break;
      case "inputText":
        lines.push(`- inputText: ${yamlQuote(step.value)}`);
        break;
      case "assertVisible":
        lines.push(`- assertVisible: ${yamlQuote(step.value)}`);
        break;
      case "takeScreenshot":
        shot += 1;
        lines.push(`- takeScreenshot: screenshots/${String(shot).padStart(2, "0")}-${slug(step.value)}`);
        break;
      case "scroll":
        lines.push("- scroll");
        break;
      case "back":
        lines.push("- back");
        break;
      case "hideKeyboard":
        lines.push("- hideKeyboard");
        break;
      case "waitForAnimationToEnd":
        lines.push("- waitForAnimationToEnd:", "    timeout: 3000");
        break;
    }
  }
  return lines.join("\n") + "\n";
}
