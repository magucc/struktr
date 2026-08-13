#!/usr/bin/env node
/** struktr-agent-capture — generate a Maestro preview flow from PR context.
 *
 * Usage:
 *   struktr-agent-capture --app-id com.example.app --context ctx.json --out flow.yaml
 *
 * ctx.json: { "title": ..., "body": ..., "changedFiles": [...], "screens": "..." }
 * Exit codes: 0 = flow written · 2 = generation failed, use committed flows.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { generateFlow } from "./generate.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const appId = arg("app-id");
const contextFile = arg("context");
const out = arg("out");

if (!appId || !contextFile || !out) {
  console.error("Usage: struktr-agent-capture --app-id <id> --context <ctx.json> --out <flow.yaml>");
  process.exit(2);
}

try {
  const context = JSON.parse(readFileSync(contextFile, "utf8"));
  const { yaml, reasoning } = await generateFlow(context, { appId });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, yaml);
  console.log(`[agent-capture] flow written to ${out}`);
  console.log(`[agent-capture] focus: ${reasoning}`);
} catch (err) {
  console.error(`[agent-capture] generation failed, falling back to committed flows: ${err.message}`);
  process.exit(2);
}
