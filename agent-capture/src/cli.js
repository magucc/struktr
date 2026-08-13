#!/usr/bin/env node
/** struktr-agent-capture — derive a Maestro preview flow from PR context.
 *
 * Modes:
 *   default   — single structured-output call (no emulator needed)
 *   --agentic — tool-using agent: reads repo context, test-runs candidate
 *               flows on the attached emulator, self-heals, then submits
 *
 * Usage:
 *   struktr-agent-capture --app-id com.example.app --context ctx.json --out flow.yaml [--agentic] [--workspace DIR]
 *
 * ctx.json: { "title": ..., "body": ..., "changedFiles": [...], "screens": "..." }
 * Exit codes: 0 = flow written · 2 = generation failed, use committed flows.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { generateFlow } from "./generate.js";
import { makeDefaultHandlers, runAgent } from "./agent.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

const appId = arg("app-id");
const contextFile = arg("context");
const out = arg("out");
const workspace = path.resolve(arg("workspace") ?? process.cwd());

if (!appId || !contextFile || !out) {
  console.error("Usage: struktr-agent-capture --app-id <id> --context <ctx.json> --out <flow.yaml> [--agentic]");
  process.exit(2);
}

try {
  const context = JSON.parse(readFileSync(contextFile, "utf8"));
  let result;
  if (flag("agentic")) {
    const handlers = makeDefaultHandlers({
      workspace,
      appId,
      maestroBin: process.env.MAESTRO_BIN ?? "maestro",
      emulator: !flag("no-emulator"),
    });
    result = await runAgent(context, { appId, handlers });
    console.log(`[agent-capture] agentic flow ${result.verified ? "verified on emulator" : "NOT verified"}`);
  } else {
    result = await generateFlow(context, { appId });
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, result.yaml);
  console.log(`[agent-capture] flow written to ${out}`);
  console.log(`[agent-capture] focus: ${result.reasoning}`);
} catch (err) {
  console.error(`[agent-capture] generation failed, falling back to committed flows: ${err.message}`);
  process.exit(2);
}
