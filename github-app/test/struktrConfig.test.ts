import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  parseStruktrConfig,
  substituteBackendUrl,
} from "../src/struktrConfig.js";

describe("parseStruktrConfig", () => {
  it("returns defaults when the file is missing", () => {
    expect(parseStruktrConfig(null)).toEqual(DEFAULTS);
  });

  it("parses a full config", () => {
    const cfg = parseStruktrConfig(`
app_id: ai.kju.app
label: app-preview
artifact: kju-preview-apk
devices: [samsung-a16, pixel-7]
backend_url: "https://pr-{number}.preview.kju.ai"
flows: .maestro/preview
agent_capture: true
`);
    expect(cfg.appId).toBe("ai.kju.app");
    expect(cfg.devices).toEqual(["samsung-a16", "pixel-7"]);
    expect(cfg.backendUrl).toBe("https://pr-{number}.preview.kju.ai");
    expect(cfg.agentCapture).toBe(true);
  });

  it("fills defaults for partial configs", () => {
    const cfg = parseStruktrConfig("app_id: app.struktr.example\n");
    expect(cfg.label).toBe("app-preview");
    expect(cfg.devices).toEqual(["pixel-7"]);
    expect(cfg.agentCapture).toBe(false);
  });
});

describe("substituteBackendUrl", () => {
  it("substitutes number and short sha", () => {
    expect(
      substituteBackendUrl("https://pr-{number}.x.dev/{sha}", {
        number: 42,
        sha: "abcdef1234567",
      }),
    ).toBe("https://pr-42.x.dev/abcdef1");
  });

  it("passes through undefined", () => {
    expect(substituteBackendUrl(undefined, { number: 1, sha: "x" })).toBeUndefined();
  });
});
