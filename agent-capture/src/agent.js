/** Agentic flow generation — a tool-using loop over the Messages API.
 *
 * The agent can read repo files for context, test-run candidate flows against
 * the live emulator, read the failures, and revise — then submit a final flow.
 * The tool surface is deliberately tiny and hard-confined: this runs
 * unattended in CI on PR-derived context, so no bash, no writes, and file
 * reads never escape the workspace.
 */
import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { serializeFlow, validateSteps } from "./serialize.js";

const STEPS_SCHEMA = {
  type: "array",
  description: "Ordered flow steps",
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
      value: { type: "string" },
    },
    required: ["command", "value"],
    additionalProperties: false,
  },
};

const TOOLS = [
  {
    name: "read_file",
    description:
      "Read a file from the repository workspace (screens, navigation code, existing .maestro flows). " +
      "Use this to learn the app's screen names, visible texts, and resource ids before writing the flow.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative file path" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_dir",
    description: "List a workspace directory. Start from the changed files' directories and any .maestro/ folder.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative directory path, '.' for root" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "run_flow",
    description:
      "Execute a candidate flow on the connected emulator (the PR build is already installed). " +
      "Returns pass/fail and the runner output. Use it to verify your flow works — and to read the " +
      "exact failure when it doesn't — before submitting. Not available when no emulator is attached.",
    input_schema: {
      type: "object",
      properties: { steps: STEPS_SCHEMA },
      required: ["steps"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_flow",
    description:
      "Submit the final flow. Only submit after run_flow passes (or when run_flow is unavailable). " +
      "Screenshots in this flow are the deliverable the PR reviewer sees.",
    input_schema: {
      type: "object",
      properties: {
        steps: STEPS_SCHEMA,
        reasoning: { type: "string", description: "One or two sentences: what this PR changes and what the flow shows" },
      },
      required: ["steps", "reasoning"],
      additionalProperties: false,
    },
  },
];

const MAX_TURNS = 12;
const READ_CAP = 20_000;

function confine(workspace, requested) {
  const resolved = path.resolve(workspace, requested);
  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) {
    throw new Error(`Path escapes the workspace: ${requested}`);
  }
  return resolved;
}

export function makeDefaultHandlers({ workspace, appId, maestroBin = "maestro", emulator = true }) {
  const exec = (cmd, args, opts) =>
    new Promise((resolve) => {
      execFile(cmd, args, { timeout: 240_000, ...opts }, (err, stdout, stderr) => {
        resolve({ ok: !err, output: `${stdout ?? ""}\n${stderr ?? ""}`.trim() });
      });
    });

  return {
    async read_file({ path: p }) {
      const full = confine(workspace, p);
      const body = readFileSync(full, "utf8");
      return body.length > READ_CAP ? body.slice(0, READ_CAP) + "\n…[truncated]" : body;
    },
    async list_dir({ path: p }) {
      const full = confine(workspace, p);
      return readdirSync(full)
        .slice(0, 200)
        .map((name) => (statSync(path.join(full, name)).isDirectory() ? `${name}/` : name))
        .join("\n");
    },
    async run_flow({ steps }) {
      if (!emulator) return "run_flow unavailable: no emulator attached. Submit your best flow.";
      const yaml = serializeFlow(appId, steps); // validates too
      const dir = mkdtempSync(path.join(os.tmpdir(), "struktr-flow-"));
      const flowFile = path.join(dir, "candidate.yaml");
      writeFileSync(flowFile, yaml);
      const { ok, output } = await exec(maestroBin, ["test", flowFile], { cwd: workspace });
      const tail = output.split("\n").slice(-40).join("\n");
      return ok ? `PASSED\n${tail}` : `FAILED\n${tail}`;
    },
  };
}

function buildPrompt(context) {
  return [
    "Produce a Maestro preview flow for this pull request. The flow's screenshots are what the",
    "reviewer sees — capture the screens this PR touches, in the state that shows the change.",
    "Add an assertVisible before each takeScreenshot so the screen has settled.",
    "The app launches signed in with a mock session unless the PR is about auth.",
    "",
    "Work method: skim the changed files (read_file/list_dir) to learn screen names and visible",
    "texts, draft a 5-20 step flow, verify it with run_flow, fix what fails, then submit_flow.",
    "Keep exploration brief — a handful of reads, not a full audit.",
    "",
    `## PR title\n${context.title ?? "(none)"}`,
    `## PR description\n${context.body ?? "(none)"}`,
    `## Changed files\n${(context.changedFiles ?? []).join("\n") || "(unknown)"}`,
    context.screens ? `## App screen map (from .struktr.yml)\n${context.screens}` : "",
  ].filter(Boolean).join("\n");
}

/** Run the agentic loop. Returns {yaml, reasoning, verified}. Throws when the
 * agent fails to produce a valid flow — callers fall back to committed flows. */
export async function runAgent(context, { client, appId, handlers, model } = {}) {
  const anthropic = client ?? new Anthropic();
  const submitted = { steps: null, reasoning: null, verified: false };

  const toolHandlers = {
    ...handlers,
    async submit_flow({ steps, reasoning }) {
      validateSteps(steps);
      submitted.steps = steps;
      submitted.reasoning = reasoning;
      return "accepted";
    },
  };

  const messages = [{ role: "user", content: buildPrompt(context) }];

  for (let turn = 0; turn < MAX_TURNS && !submitted.steps; turn++) {
    const response = await anthropic.beta.messages.create({
      model: model ?? process.env.STRUKTR_AGENT_MODEL ?? "claude-opus-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tools: TOOLS,
      messages,
    });
    if (response.stop_reason === "refusal") {
      throw new Error("Model declined to generate a flow");
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) break; // gave up without submitting

    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const use of toolUses) {
      let result;
      let isError = false;
      try {
        const handler = toolHandlers[use.name];
        if (!handler) throw new Error(`Unknown tool ${use.name}`);
        result = await handler(use.input);
        if (use.name === "run_flow" && String(result).startsWith("PASSED")) {
          submitted.verified = true;
        }
      } catch (err) {
        result = `Error: ${err.message}`;
        isError = true;
      }
      results.push({ type: "tool_result", tool_use_id: use.id, content: String(result), is_error: isError });
    }
    messages.push({ role: "user", content: results });
  }

  if (!submitted.steps) {
    throw new Error("Agent did not submit a flow");
  }
  return {
    yaml: serializeFlow(appId, submitted.steps, { name: `agent flow: ${context.title ?? "PR preview"}` }),
    reasoning: submitted.reasoning,
    verified: submitted.verified,
  };
}
