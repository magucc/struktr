import { parse } from "yaml";

/** Repo-side static config, read from .struktr.yml on the PR's head ref. */
export interface StruktrConfig {
  /** Android applicationId, used to launch the app in interactive sessions. */
  appId?: string;
  /** PR label that triggers pickup. */
  label: string;
  /** Name of the CI artifact containing the debug/release APK. */
  artifact: string;
  /** Devices to boot for interactive previews. */
  devices: string[];
  /** Per-PR backend URL template; {number} and {sha} are substituted. */
  backendUrl?: string;
  /** Maestro flow path for the static screenshot leg (informational here). */
  flows: string;
  /** Phase D: let an agent derive the capture flow from the PR context. */
  agentCapture: boolean;
}

export const DEFAULTS: StruktrConfig = {
  label: "app-preview",
  artifact: "preview-apk",
  devices: ["pixel-7"],
  flows: ".maestro/preview",
  agentCapture: false,
};

export function parseStruktrConfig(raw: string | null): StruktrConfig {
  if (!raw) return { ...DEFAULTS };
  const doc = (parse(raw) ?? {}) as Record<string, unknown>;
  const cfg: StruktrConfig = {
    ...DEFAULTS,
    appId: typeof doc.app_id === "string" ? doc.app_id : undefined,
    label: typeof doc.label === "string" ? doc.label : DEFAULTS.label,
    artifact: typeof doc.artifact === "string" ? doc.artifact : DEFAULTS.artifact,
    devices: Array.isArray(doc.devices) && doc.devices.length
      ? doc.devices.map(String)
      : [...DEFAULTS.devices],
    backendUrl: typeof doc.backend_url === "string" ? doc.backend_url : undefined,
    flows: typeof doc.flows === "string" ? doc.flows : DEFAULTS.flows,
    agentCapture: doc.agent_capture === true,
  };
  return cfg;
}

export function substituteBackendUrl(
  template: string | undefined,
  pr: { number: number; sha: string },
): string | undefined {
  if (!template) return undefined;
  return template
    .replaceAll("{number}", String(pr.number))
    .replaceAll("{sha}", pr.sha.slice(0, 7));
}
