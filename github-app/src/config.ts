import { readFileSync } from "node:fs";

export interface AppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  port: number;
  orchestratorUrl: string;
  orchestratorApiToken: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export function loadAppConfig(): AppConfig {
  // PRIVATE_KEY may be the PEM itself, base64 of it, or a file path.
  let privateKey = process.env.GITHUB_APP_PRIVATE_KEY ?? "";
  if (!privateKey && process.env.GITHUB_APP_PRIVATE_KEY_PATH) {
    privateKey = readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8");
  }
  if (privateKey && !privateKey.includes("BEGIN")) {
    privateKey = Buffer.from(privateKey, "base64").toString("utf8");
  }
  if (!privateKey) throw new Error("Set GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH");

  return {
    appId: required("GITHUB_APP_ID"),
    privateKey,
    webhookSecret: required("GITHUB_APP_WEBHOOK_SECRET"),
    port: Number(process.env.PORT ?? 3000),
    orchestratorUrl: required("ORCHESTRATOR_URL"),
    orchestratorApiToken: required("ORCHESTRATOR_API_TOKEN"),
  };
}
